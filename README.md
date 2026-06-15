<div align="center">
  <img src="frontend/public/logo.svg" alt="KubeKosh Logo" width="100" />

  <h1>KubeKosh</h1>

  <p><strong>Self-hosted Kubernetes Lab for Hands-on Learning</strong></p>

  <p>
    <a href="https://hub.docker.com/r/zeborg/kubekosh"><img src="https://img.shields.io/docker/pulls/zeborg/kubekosh?style=flat-square&logo=docker&label=Docker%20Hub" alt="Docker Hub" /></a>
    <img src="https://img.shields.io/badge/license-Apache%202.0-blue?style=flat-square" alt="License" />
    <img src="https://img.shields.io/badge/platforms-amd64%20%7C%20arm64-lightgrey?style=flat-square" alt="Platforms" />
  </p>
</div>

---

KubeKosh runs a real [K3s](https://k3s.io/) Kubernetes cluster inside a single Docker container and pairs it with a browser-based terminal and automated scenario validation — no cloud account or local cluster required.

## Screenshots

| | |
|---|---|
| ![Scenario browser with live terminal](screenshots/1.png) | ![Task scenario with problem statement](screenshots/2.png) |
| ![Contextual hints with copy-ready commands](screenshots/3.png) | ![Automated validation — all checks passed](screenshots/4.png) |
| ![Exam mode — start with custom duration](screenshots/5.png) | ![Exam mode - live exam with timer](screenshots/6.png) |
| ![Multiple-choice question view](screenshots/7.png) | ![MCQ with correct answer and explanation](screenshots/8.png) |

---

## Quick Start

**Prerequisite:** [Docker](https://docs.docker.com/get-docker/)

```bash
docker run -itd --name kubekosh --privileged -p 7554:80 zeborg/kubekosh:latest
```

Open **http://localhost:7554** — wait ~30 seconds for the *Cluster Ready* indicator to turn green.

> `--privileged` is required — K3s needs access to kernel namespaces and cgroups.

> **Security Warning:** Do **not** expose this container publicly. Use it only on your local machine as it is meant for educational purposes only.

### Persist Progress

```bash
docker run -itd --name kubekosh --privileged -p 7554:80 \
  -v <your_custom_directory>:/data zeborg/kubekosh:latest
```

Progress is stored in SQLite at `/data/progress.db` inside the container. Mount a local directory to `/data` to keep progress across container restarts.

### Build From Source

```bash
docker build -t kubekosh .
# multi-platform
docker buildx build --platform linux/amd64,linux/arm64 -t kubekosh .
```

---

## What's Inside

| Bundle | Focus | Exam Mode |
|---|---|---|
| 🌱 Kubernetes Basics | Core concepts | 60 min |
| 🧑‍✈️ Kubernetes Administrator | CKA | 120 min |
| 🛠️ Kubernetes Developer | CKAD | 120 min |
| 🛡️ Kubernetes Security | CKS | 120 min |

**Scenario types:**
- **Task** — Hands-on challenge in the live terminal. Click **Validate** for automated cluster-state checking.
- **MCQ** — Multiple-choice question with a detailed explanation on submission.

### Shell Aliases

The terminal comes pre-configured with:

| Alias | Expands to |
|---|---|
| `k` | `kubectl` |
| `kg` | `kubectl get` |
| `kd` | `kubectl describe` |
| `krm` | `kubectl delete` |
| `kgp` | `kubectl get pods` |
| `kga` | `kubectl get pods --all-namespaces` |
| `kgd` | `kubectl get deployments` |
| `kgs` | `kubectl get services` |
| `kgn` | `kubectl get nodes` |
| `kgns` | `kubectl get namespaces` |
| `kdp` | `kubectl describe pod` |
| `kaf` | `kubectl apply -f` |
| `kdf` | `kubectl delete -f` |
| `kex` | `kubectl exec -it` |
| `klogs` | `kubectl logs` |
| `kns <ns>` | `kubectl config set-context --current --namespace=<ns>` |
| `kctx <ctx>` | `kubectl config use-context <ctx>` |

---

## Architecture

| Component | Technology |
|---|---|
| Frontend | React + Vite, `xterm.js` |
| Backend | Node.js / Express, `node-pty` WebSocket PTY |
| Cluster | K3s (single-node, in-container) |
| Proxy | nginx on container port `80`, mapped to host port `7554` |
| Storage | SQLite (`better-sqlite3`) at `/data/progress.db` |

Everything runs inside a **single Docker image** managed by `scripts/entrypoint.sh`.

---

## Repository Layout

```
scenarios/
├── data/             # One JSON file per scenario  -> <scenario-id>.json
├── bundles/          # One JSON file per bundle    -> <bundle-id>.json
└── SCHEMA.md         # Full schema reference

backend/
└── server.js         # Express API + WebSocket PTY

frontend/
└── src/              # React + Vite SPA

scripts/
├── entrypoint.sh     # Container startup (k3s -> API -> nginx)
└── nginx.conf        # Reverse-proxy config
```

---

## Contributing

Contributions are what make open-source projects like this one grow — and every contribution counts, big or small. Whether you're fixing a typo, polishing a scenario description, or building a completely new exercise from scratch, you're helping the next person learn Kubernetes in the best way possible. **Thank you for taking the time!**

### Adding Scenarios

Each scenario is a single JSON file in `scenarios/data` directory; each bundle is a single JSON file in `scenarios/bundles` directory. See [`scenarios/SCHEMA.md`](scenarios/SCHEMA.md) for the full schema.

**Task checklist:**
- `validation.commands` — idempotent `kubectl` commands only
- `setup_commands` / `teardown_commands` — `kubectl` or native Ubuntu commands only

**MCQ checklist:**
- `correct_option` must match one of the `options[].id` values
- Always include an `explanation`

### Workflow

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/<your-username>/kubekosh.git
cd kubekosh

# 2. Create a branch
git checkout -b feat/my-scenario

# 3. Add a new scenario file (copy an existing scenario as a template or create a new one)
cp scenarios/data/deploy-nginx.json scenarios/data/my-new-scenario.json
vim scenarios/data/my-new-scenario.json # edit the new scenario as per [SCHEMA.md](scenarios/SCHEMA.md)

# 4. Add the scenario ID to the relevant bundle
vim scenarios/bundles/k8s-basics.json # edit the bundle to include the new scenario ID

# 5. Build and test locally
docker build -t kubekosh . && docker run --rm -itd --privileged -p 7554:80 kubekosh

# 6. Commit and push to your fork (example for adding `my-new-scenario` to `k8s-basics` bundle)
git add scenarios/data/my-new-scenario.json scenarios/bundles/k8s-basics.json
git commit -m "feat: add my-new-scenario to k8s-basics bundle"
git push -u origin feat/my-new-scenario
```

Open a Pull Request from your fork's branch against `main`.

---

## License

Apache 2.0 License — see [LICENSE](LICENSE).
