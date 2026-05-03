import { useEffect, useMemo, useState } from 'react'
import { Settings } from 'lucide-react'
import './TopBar.css'

type Task = {
  id: string
  title: string
  estimatedMinutes: number
  completed: boolean
}

const TASKS_CHANGED_EVENT = 'tasks:changed'

type TopBarProps = {
  showProgress?: boolean
}

function TopBar({ showProgress = true }: TopBarProps): React.JSX.Element {
  const [tasks, setTasks] = useState<Task[]>([])

  useEffect(() => {
    let cancelled = false

    async function loadTasks(): Promise<void> {
      try {
        const data = await window.api.getTasks()
        if (!cancelled) {
          setTasks(
            data.map((task) => ({
              id: task.id,
              title: task.title,
              estimatedMinutes: task.estimatedMinutes,
              completed: task.completed
            }))
          )
        }
      } catch {
        if (!cancelled) {
          setTasks([])
        }
      }
    }

    const onTasksChanged = (): void => {
      void loadTasks()
    }

    const onWindowFocus = (): void => {
      void loadTasks()
    }

    void loadTasks()
    window.addEventListener(TASKS_CHANGED_EVENT, onTasksChanged)
    window.addEventListener('focus', onWindowFocus)

    return () => {
      cancelled = true
      window.removeEventListener(TASKS_CHANGED_EVENT, onTasksChanged)
      window.removeEventListener('focus', onWindowFocus)
    }
  }, [])

  const percent = useMemo(() => {
    const total = tasks.length
    if (total === 0) return 100
    const completed = tasks.filter((task) => task.completed).length
    return Math.round((completed / total) * 100)
  }, [tasks])

  return (
    <header className={`top-bar ${showProgress ? '' : 'top-bar--settings-only'}`.trim()}>
      {showProgress ? (
        <div
          className="top-bar__progress"
          aria-label={`Task progress ${percent}%`}
          role="progressbar"
        >
          <div
            className="top-bar__progress-track"
            style={{ '--progress': `${percent}%` } as React.CSSProperties}
          >
            <div className="top-bar__progress-fill" />
            <div className="top-bar__progress-cap" aria-hidden="true" />
          </div>
        </div>
      ) : null}
      <button type="button" className="top-bar__settings" aria-label="Open settings">
        <Settings size={24} strokeWidth={2.5} />
      </button>
    </header>
  )
}

export default TopBar
