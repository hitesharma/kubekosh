import { useState, useCallback } from 'react'
import styles from './AddonsView.module.css'
import { useAddonDetail } from './useAddons'
import { useAddonStream } from './useAddonStream'
import { statusMeta, targetLabel } from './addonStatus'
import AddonLogPane from './AddonLogPane'

const BUSY = new Set(['installing', 'removing'])

// Detail panel for the selected addon: metadata, dependency chain, the resolved
// install plan (live during a run), action buttons, and a streaming log pane.
export default function AddonDetail({ id, onChanged }) {
  const { detail, refresh } = useAddonDetail(id)
  const [streaming, setStreaming] = useState(false)
  const [actionError, setActionError] = useState(null)

  const handleStatus = useCallback((s) => {
    // A status change for the selected addon means the catalog + detail are stale.
    if (s.addon === id) refresh()
    onChanged?.()
  }, [id, refresh, onChanged])

  const detailBusy = detail && BUSY.has(detail.status)
  const { logs, statuses } = useAddonStream(id, streaming || detailBusy, handleStatus)

  const act = useCallback(async (kind) => {
    setActionError(null)
    try {
      const res = await fetch(`/api/addons/${id}/${kind}`, { method: 'POST' })
      if (res.status === 202) {
        setStreaming(true)
        refresh()
      } else {
        const body = await res.json().catch(() => ({}))
        const dep = body.dependents?.length ? ` (${body.dependents.join(', ')})` : ''
        setActionError((body.error || 'Action failed') + dep)
      }
    } catch (e) {
      setActionError(`Network error: ${e.message}`)
    }
  }, [id, refresh])

  if (!id) {
    return (
      <div className={styles.detailEmpty}>
        <div className={styles.detailEmptyIcon}>🧩</div>
        <p>Select an addon to see details.</p>
      </div>
    )
  }
  if (!detail) {
    return <div className={styles.detailEmpty}><p>Loading…</p></div>
  }

  // Live status overrides the fetched snapshot during a run.
  const effStatus = statuses[id] || detail.status
  const meta = statusMeta(effStatus)
  const busy = BUSY.has(effStatus)
  const isInstalled = effStatus === 'installed'
  const plan = detail.install_plan || { order: [], to_install: 0 }
  const planError = plan.error

  return (
    <div className={styles.detail}>
      <div className={styles.detailHead}>
        <span className={styles.detailIcon}>{detail.icon}</span>
        <div className={styles.detailHeadText}>
          <div className={styles.detailName}>{detail.name}</div>
          <div className={styles.detailMetaRow}>
            <span className={`${styles.statusBadge} ${styles[`status${meta.tone}`]}`}>
              {meta.busy && <span className={styles.badgeSpinner} />}
              {meta.label}
            </span>
            <span className={`${styles.targetTag} ${detail.target === 'cluster' ? styles.targetCluster : styles.targetOs}`}>
              {targetLabel(detail.target)}
            </span>
            <span className={styles.detailVersion}>v{detail.version}</span>
          </div>
        </div>
      </div>

      <p className={styles.detailDesc}>{detail.description}</p>

      {detail.docs_url && (
        <a className={styles.detailDocs} href={detail.docs_url} target="_blank" rel="noopener noreferrer">
          Documentation ↗
        </a>
      )}

      {actionError && <div className={styles.detailError}>{actionError}</div>}
      {!actionError && detail.last_error && effStatus.endsWith('failed') && (
        <div className={styles.detailError}>{detail.last_error}</div>
      )}

      {detail.dependencies.length > 0 && (
        <div className={styles.detailSection}>
          <div className={styles.detailSectionTitle}>Dependencies</div>
          <div className={styles.chips}>
            {detail.dependencies.map(d => <span key={d} className={styles.chip}>{d}</span>)}
          </div>
        </div>
      )}

      {/* Install plan — rows pick up live status during a run */}
      {!isInstalled && plan.order.length > 0 && (
        <div className={styles.detailSection}>
          <div className={styles.detailSectionTitle}>Install plan</div>
          {planError ? (
            <div className={styles.detailError}>{planError}</div>
          ) : (
            <ol className={styles.planList}>
              {plan.order.map((step, i) => {
                const rowStatus = statuses[step.id] || step.status
                return (
                  <li key={step.id} className={styles.planStep}>
                    <span className={styles.planNum}>{i + 1}</span>
                    <span className={styles.planStepName}>{step.name}</span>
                    <span className={planRowClass(rowStatus, step.action, styles)}>
                      {planRowLabel(rowStatus, step.action)}
                    </span>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      )}

      {/* Actions */}
      <div className={styles.detailActions}>
        {isInstalled ? (
          <button className={styles.removeBtn} disabled={busy} onClick={() => act('remove')}>
            {effStatus === 'removing' ? 'Removing…' : 'Remove'}
          </button>
        ) : (
          <button className={styles.installBtn} disabled={busy} onClick={() => act('install')}>
            {effStatus === 'installing' ? 'Installing…'
              : plan.to_install > 1 ? `Install all (${plan.to_install})` : 'Install'}
          </button>
        )}
      </div>

      {/* Live log */}
      {(busy || logs.length > 0) && (
        <div className={styles.detailSection}>
          <div className={styles.detailSectionTitle}>Output</div>
          <AddonLogPane logs={logs} />
        </div>
      )}
    </div>
  )
}

function planRowLabel(status, action) {
  if (status === 'installed') return '✓ installed'
  if (status === 'installing') return 'installing…'
  if (status === 'install_failed') return '✗ failed'
  if (action === 'skip') return '✓ already installed'
  return 'will install'
}

function planRowClass(status, action, styles) {
  if (status === 'installed' || action === 'skip') return styles.planSkip
  if (status === 'install_failed') return styles.planFailed
  return styles.planInstall
}
