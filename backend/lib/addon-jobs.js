'use strict';

// Async addon install/remove engine.
//
// - A single FIFO queue with concurrency 1 serializes all cluster/OS mutations.
// - Installing an addon expands its transitive dependency chain (deepest first)
//   into the queue; the requested addon ("root") runs last.
// - Each job runs setup_commands / teardown_commands sequentially via spawn,
//   streaming output line-by-line to SSE subscribers, then verifies health.
// - Events are buffered per stream key (ring buffer) so a (re)connecting client
//   can replay missed output via the Last-Event-ID header.
//
// State transitions are persisted to disk on every change so the read-only
// routes and a future restart stay consistent.

const { spawn } = require('child_process');
const { buildIndex, resolveInstallOrder, getDependents, detectArch } = require('./addons');
const { readState, writeState, setStatus, statusOf } = require('./addon-state');

const RING_SIZE = 500;        // events retained per stream key for SSE replay
const HEALTH_TIMEOUT_MS = 30000;

function substitute(cmd, vars) {
  return cmd.replace(/\$\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

function createJobEngine({ loadAddons, stateFile, binDir = '/data/addons/bin', baseEnv = process.env }) {
  let state = readState(stateFile);
  const queue = [];
  let running = false;

  const subscribers = new Map(); // streamKey -> Set<res>
  const buffers = new Map();     // streamKey -> { id, event, data }[]
  let eventSeq = 0;

  // ── env / persistence ──────────────────────────────────────────────────────
  function runEnv() {
    return {
      ...baseEnv,
      KUBECONFIG: baseEnv.KUBECONFIG || '/root/.kube/config',
      HOME: baseEnv.HOME || '/root',
      PATH: `${binDir}:${baseEnv.PATH || ''}`
    };
  }

  function persist() {
    try { writeState(stateFile, state); }
    catch (e) { console.error('addon state persist failed:', e.message); }
  }

  // ── SSE plumbing ───────────────────────────────────────────────────────────
  function pushBuffer(key, frame) {
    let buf = buffers.get(key);
    if (!buf) { buf = []; buffers.set(key, buf); }
    buf.push(frame);
    if (buf.length > RING_SIZE) buf.splice(0, buf.length - RING_SIZE);
  }

  function writeFrame(res, frame) {
    res.write(`id: ${frame.id}\n`);
    res.write(`event: ${frame.event}\n`);
    res.write(`data: ${JSON.stringify(frame.data)}\n\n`);
  }

  function broadcast(keys, event, data) {
    const frame = { id: ++eventSeq, event, data };
    for (const key of keys) {
      pushBuffer(key, frame);
      const subs = subscribers.get(key);
      if (subs) for (const res of subs) {
        try { writeFrame(res, frame); } catch { /* dropped on next close */ }
      }
    }
  }

  function broadcastLog(keys, addonId, line, stream) {
    broadcast(keys, 'log', { addon: addonId, line, stream, ts: new Date().toISOString() });
  }

  function setAddonStatus(id, patch, keys) {
    state = setStatus(state, id, patch);
    persist();
    broadcast(keys && keys.length ? keys : [id], 'status', {
      addon: id,
      status: patch.status,
      last_error: 'last_error' in patch ? patch.last_error : (state[id]?.last_error ?? null)
    });
  }

  // ── command execution ──────────────────────────────────────────────────────
  function runCmd(command, { keys, addonId, timeoutMs }) {
    return new Promise((resolve, reject) => {
      const child = spawn('bash', ['-lc', command], { env: runEnv() });
      let settled = false;
      const buffers = { stdout: '', stderr: '' };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGKILL');
        reject(new Error(`command timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);

      function onData(streamName) {
        return (chunk) => {
          buffers[streamName] += chunk.toString();
          const lines = buffers[streamName].split('\n');
          buffers[streamName] = lines.pop(); // keep partial line
          for (const line of lines) broadcastLog(keys, addonId, line, streamName);
        };
      }
      child.stdout.on('data', onData('stdout'));
      child.stderr.on('data', onData('stderr'));

      child.on('error', (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // flush any trailing partial lines
        for (const s of ['stdout', 'stderr']) {
          if (buffers[s]) broadcastLog(keys, addonId, buffers[s], s);
        }
        if (code === 0) resolve();
        else reject(new Error(`command exited with code ${code}`));
      });
    });
  }

  // ── job execution ──────────────────────────────────────────────────────────
  async function runJob(job) {
    const addon = buildIndex(loadAddons()).get(job.addonId);
    if (!addon) return;

    const keys = job.rootId && job.rootId !== job.addonId
      ? [job.addonId, job.rootId]
      : [job.addonId];
    const isInstall = job.action === 'install';

    // Idempotency: skip an install whose addon is already installed.
    if (isInstall && statusOf(state, job.addonId) === 'installed') return;

    setAddonStatus(job.addonId, { status: isInstall ? 'installing' : 'removing', last_error: null }, keys);

    const cmds = isInstall ? addon.setup_commands : addon.teardown_commands;
    const vars = { VERSION: addon.version, ARCH: detectArch(), ADDON_BIN: binDir };
    const timeoutMs = (addon.est_seconds || 60) * 3 * 1000;

    try {
      for (const c of cmds) {
        broadcastLog(keys, job.addonId, `$ ${c.label || c.command}`, 'meta');
        await runCmd(substitute(c.command, vars), { keys, addonId: job.addonId, timeoutMs });
      }

      if (isInstall) {
        broadcastLog(keys, job.addonId, '$ verifying health', 'meta');
        await runCmd(substitute(addon.health_command, vars), { keys, addonId: job.addonId, timeoutMs: HEALTH_TIMEOUT_MS });
        setAddonStatus(job.addonId, { status: 'installed', version: addon.version, last_error: null }, keys);
      } else {
        setAddonStatus(job.addonId, { status: 'available', version: null, last_error: null }, keys);
      }
    } catch (e) {
      const failStatus = isInstall ? 'install_failed' : 'remove_failed';
      setAddonStatus(job.addonId, { status: failStatus, last_error: e.message }, keys);
      broadcastLog(keys, job.addonId, `✗ ${e.message}`, 'meta');

      // A failed dependency aborts the rest of the chain and fails the root.
      if (isInstall && job.rootId && job.rootId !== job.addonId) {
        for (let i = queue.length - 1; i >= 0; i--) {
          if (queue[i].rootId === job.rootId) queue.splice(i, 1);
        }
        setAddonStatus(job.rootId, {
          status: 'install_failed',
          last_error: `dependency "${job.addonId}" failed: ${e.message}`
        }, [job.rootId]);
      }
    }
  }

  async function drain() {
    if (running) return;
    running = true;
    try {
      while (queue.length) {
        await runJob(queue.shift());
      }
    } finally {
      running = false;
    }
  }

  // ── public API ─────────────────────────────────────────────────────────────
  function enqueueInstall(rootId) {
    const addons = loadAddons();
    const index = buildIndex(addons);
    if (!index.has(rootId)) return { error: `addon "${rootId}" not found`, code: 404 };

    let order;
    try { order = resolveInstallOrder(rootId, index); }
    catch (e) { return { error: e.message, code: 400 }; }

    const pending = order.filter(id => statusOf(state, id) !== 'installed');
    if (pending.length === 0) {
      return { error: 'addon and all dependencies are already installed', code: 409 };
    }
    for (const id of pending) {
      queue.push({ addonId: id, action: 'install', rootId });
    }
    drain();
    return { accepted: true, jobId: rootId, plan: pending };
  }

  function enqueueRemove(id) {
    const addons = loadAddons();
    if (!buildIndex(addons).has(id)) return { error: `addon "${id}" not found`, code: 404 };

    const st = statusOf(state, id);
    if (st !== 'installed' && st !== 'remove_failed') {
      return { error: `addon "${id}" is not installed`, code: 409 };
    }
    const blockers = getDependents(id, addons).filter(d => {
      const ds = statusOf(state, d);
      return ds === 'installed' || ds === 'installing';
    });
    if (blockers.length > 0) {
      return { error: 'addon is required by other installed addons', code: 409, dependents: blockers };
    }
    queue.push({ addonId: id, action: 'remove', rootId: id });
    drain();
    return { accepted: true, jobId: id };
  }

  function subscribe(key, res, lastEventId = 0) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 3000\n\n');

    let subs = subscribers.get(key);
    if (!subs) { subs = new Set(); subscribers.set(key, subs); }
    subs.add(res);

    // Replay buffered events the client hasn't seen.
    const buf = buffers.get(key) || [];
    for (const frame of buf) {
      if (frame.id > lastEventId) writeFrame(res, frame);
    }

    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { /* closed */ }
    }, 15000);

    const cleanup = () => {
      clearInterval(heartbeat);
      const set = subscribers.get(key);
      if (set) { set.delete(res); if (set.size === 0) subscribers.delete(key); }
    };
    res.on('close', cleanup);
    return cleanup;
  }

  function getStatus(id) {
    return { status: statusOf(state, id), last_error: state[id]?.last_error ?? null };
  }

  // Best-effort: re-install addons marked installed whose health check now
  // fails (e.g. an OS binary lost when an ephemeral container restarted).
  // Runs in the background; never blocks startup.
  async function healthReconcile() {
    const addons = loadAddons();
    const index = buildIndex(addons);
    for (const [id, entry] of Object.entries(state)) {
      if (entry.status !== 'installed') continue;
      const addon = index.get(id);
      if (!addon) continue;
      const vars = { VERSION: addon.version, ARCH: detectArch(), ADDON_BIN: binDir };
      try {
        await runCmd(substitute(addon.health_command, vars), { keys: [id], addonId: id, timeoutMs: HEALTH_TIMEOUT_MS });
      } catch {
        console.log(`Addon "${id}" failed health check on boot — re-installing.`);
        state = setStatus(state, id, { status: 'available', version: null });
        persist();
        enqueueInstall(id);
      }
    }
  }

  return { enqueueInstall, enqueueRemove, subscribe, getStatus, healthReconcile };
}

module.exports = { createJobEngine, substitute };
