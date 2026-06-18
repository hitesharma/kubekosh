import styles from './AddonsView.module.css'
import { statusMeta, targetLabel } from './addonStatus'

// A single addon tile in the catalog grid.
export default function AddonCard({ addon, selected, onSelect }) {
  const meta = statusMeta(addon.status)
  return (
    <button
      type="button"
      className={`${styles.card} ${selected ? styles.cardSelected : ''}`}
      onClick={() => onSelect(addon.id)}
    >
      <div className={styles.cardTop}>
        <span className={styles.cardIcon}>{addon.icon}</span>
        <span className={`${styles.statusBadge} ${styles[`status${meta.tone}`]}`}>
          {meta.busy && <span className={styles.badgeSpinner} />}
          {meta.label}
        </span>
      </div>
      <div className={styles.cardName}>{addon.name}</div>
      <div className={styles.cardDesc}>{addon.description}</div>
      <div className={styles.cardFoot}>
        <span className={`${styles.targetTag} ${addon.target === 'cluster' ? styles.targetCluster : styles.targetOs}`}>
          {targetLabel(addon.target)}
        </span>
        <span className={styles.cardCategory}>{addon.category}</span>
      </div>
    </button>
  )
}
