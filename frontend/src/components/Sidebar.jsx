import { useState, useMemo } from 'react'
import styles from './Sidebar.module.css'

const DIFF_COLOR = { Easy: 'green', Medium: 'amber', Hard: 'red' }
const TYPE_ICON  = { task: '⚙', mcq: '◉' }

async function resetProgress(scope, opts) {
  await fetch('/api/progress/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, ...opts }),
  })
}

export default function Sidebar({
  scenarios, activeId, onSelect, loading,
  collapsed, onToggleCollapse, width,
  activeBundleId, onProgressUpdate,
  isExamMode, examProgress,
}) {
  const [filterDiff, setFilterDiff] = useState('All')
  const [filterType, setFilterType] = useState('All')

  const filteredScenarios = useMemo(() => {
    return scenarios.filter(s => {
      if (filterDiff !== 'All' && s.difficulty !== filterDiff) return false
      if (filterType !== 'All' && s.type !== filterType) return false
      return true
    })
  }, [scenarios, filterDiff, filterType])

  const groups = useMemo(() => {
    const map = {}
    filteredScenarios.forEach(s => {
      if (!map[s.category]) map[s.category] = []
      map[s.category].push(s)
    })
    return map
  }, [filteredScenarios])

  // Calculate index based on ALL scenarios so numbers stay absolute
  const scenarioIndex = useMemo(() => {
    const map = {}
    scenarios.forEach(s => {
      if (!map[s.category]) map[s.category] = []
      map[s.category].push(s)
    })
    const idx = {}
    let counter = 1
    Object.values(map).forEach(items => {
      items.forEach(s => { idx[s.id] = counter++ })
    })
    return idx
  }, [scenarios])

  // Number scenarios in accordion display order (category by category, then by position within category)


  const [open, setOpen] = useState({})

  useMemo(() => {
    if (!activeId) return
    const s = scenarios.find(x => x.id === activeId)
    if (s) setOpen(o => ({ ...o, [s.category]: true }))
  }, [activeId, scenarios])

  const toggle = cat => setOpen(o => ({ ...o, [cat]: !o[cat] }))

  const totalDone = isExamMode
    ? scenarios.filter(s => examProgress?.[s.id]?.status === 'completed').length
    : scenarios.filter(s => s.progress?.status === 'completed').length

  const handleCategoryReset = async (e, cat) => {
    e.stopPropagation()
    if (!window.confirm(`Reset all progress in "${cat}"?`)) return
    await resetProgress('category', { category: cat })
    onProgressUpdate?.()
  }

  const handleScenarioReset = async (e, scenarioId, title) => {
    e.stopPropagation()
    if (!window.confirm(`Reset progress for "${title}"?`)) return
    await resetProgress('scenario', { scenarioId })
    onProgressUpdate?.()
  }

  return (
    <aside
      className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''}`}
      style={{ width, minWidth: width }}
    >
      {/* Top bar */}
      <div className={styles.sidebarTop}>
        {!collapsed && <span className={styles.sidebarTitle}>Scenarios</span>}
        {!collapsed && (
          <span className={styles.sidebarCount}>
            {totalDone}/{scenarios.length}
          </span>
        )}
        <button
          className={styles.collapseBtn}
          onClick={onToggleCollapse}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>

      {/* Filter bar */}
      {!collapsed && (
        <div className={styles.filterBar}>
          {!isExamMode && (
            <select 
              value={filterDiff} 
              onChange={e => setFilterDiff(e.target.value)}
              className={`${styles.selectFilter} ${filterDiff !== 'All' ? styles[DIFF_COLOR[filterDiff]] : ''}`}
            >
              <option value="All">All Difficulties</option>
              <option value="Easy">Easy</option>
              <option value="Medium">Medium</option>
              <option value="Hard">Hard</option>
            </select>
          )}
          <select 
            value={filterType} 
            onChange={e => setFilterType(e.target.value)}
            className={`${styles.selectFilter} ${filterType !== 'All' ? styles[filterType] : ''}`}
          >
            <option value="All">All Types</option>
            <option value="task">Task</option>
            <option value="mcq">MCQ</option>
          </select>
        </div>
      )}

      {/* List */}
      {!collapsed && (
        <div className={styles.list}>
          {loading && (
            <div className={styles.loadingWrap}>
              {[...Array(5)].map((_, i) => (
                <div key={i} className={styles.skeleton} style={{ animationDelay: `${i * 0.1}s` }} />
              ))}
            </div>
          )}

          {!loading && Object.entries(groups).map(([cat, items]) => {
            const catDone = items.filter(s => s.progress?.status === 'completed').length
            const isOpen = open[cat] !== false
            const hasCatProgress = items.some(s => s.progress?.attempts > 0)

            return (
              <div key={cat} className={styles.group}>
                <button className={styles.accordion} onClick={() => toggle(cat)}>
                  <div className={styles.accordionLeft}>
                    <span className={`${styles.chevron} ${isOpen ? styles.open : ''}`}>›</span>
                    <span className={styles.catName}>{cat}</span>
                  </div>
                  <div className={styles.accordionRight}>
                    <span className={styles.catCount}>
                      {isExamMode
                        ? `${items.filter(s => examProgress?.[s.id]?.status === 'completed').length}/${items.length}`
                        : `${catDone}/${items.length}`}
                    </span>
                    {hasCatProgress && (
                      <button
                        className={styles.catResetBtn}
                        title={`Reset all progress in "${cat}"`}
                        onClick={e => handleCategoryReset(e, cat)}
                      >
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M23 4v6h-6" />
                          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                        </svg>
                      </button>
                    )}
                  </div>
                </button>

                {isOpen && (
                  <div className={styles.itemsBox}>
                    {items.map(s => {
                      const examDone = isExamMode && examProgress?.[s.id]?.status === 'completed'
                      const done = !isExamMode && s.progress?.status === 'completed'
                      const active = s.id === activeId
                      const hasAttempts = isExamMode
                        ? (examProgress?.[s.id]?.attempts || 0) > 0
                        : s.progress?.attempts > 0
                      return (
                        <button
                          key={s.id}
                          className={`${styles.item} ${active ? styles.active : ''} ${(done || examDone) ? styles.done : ''}`}
                          onClick={() => onSelect(s.id)}
                        >
                          <div className={styles.itemTop}>
                            <span className={styles.itemNum}>{scenarioIndex[s.id]}</span>
                            <span className={styles.typeIcon}>{TYPE_ICON[s.type] || '•'}</span>
                            <span className={styles.itemTitle}>{s.title}</span>
                            {(done || examDone) && <span className={styles.checkmark}>✓</span>}
                            {/* Per-scenario reset — shown when item has attempts */}
                            {hasAttempts && (
                              <button
                                className={styles.itemResetBtn}
                                title="Reset this scenario's progress"
                                onClick={e => handleScenarioReset(e, s.id, s.title)}
                              >
                                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M23 4v6h-6" />
                                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                                </svg>
                              </button>
                            )}
                          </div>
                          <div className={styles.itemMeta}>
                            {!isExamMode && (
                              <span className={`${styles.diff} ${styles[DIFF_COLOR[s.difficulty]]}`}>
                                {s.difficulty}
                              </span>
                            )}
                            <span className={`${styles.type} ${styles[s.type]}`}>{s.type.toUpperCase()}</span>
                            {!isExamMode && <span className={styles.weight}>{s.weight}pt</span>}
                            {isExamMode && examDone && (
                              <span className={styles.examCompletedTag}>✓ Completed</span>
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </aside>
  )
}
