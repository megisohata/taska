import { useState, useEffect, useRef } from 'react'
import './List.css'
import hamburger from '../assets/hamburger.png'
import face1 from '../assets/face-1.png'
import face2 from '../assets/face-2.png'
import face3 from '../assets/face-3.png'
import face4 from '../assets/face-4.png'
import face5 from '../assets/face-5.png'

type Task = {
  id: string
  title: string
  estimatedMinutes: number
  scheduledStart: string | null
  completed: boolean
}

function mapTask(task: {
  id: string
  title: string
  estimatedMinutes: number
  scheduledStart: string | null
  completed: boolean
}): Task {
  return {
    id: task.id,
    title: task.title,
    estimatedMinutes: task.estimatedMinutes,
    scheduledStart: task.scheduledStart,
    completed: task.completed
  }
}

const FACES = [
  { src: face1, alt: 'saddest face' },
  { src: face2, alt: 'sad face' },
  { src: face3, alt: 'neutral face' },
  { src: face4, alt: 'happy face' },
  { src: face5, alt: 'happiest face' }
]

// 0–24 → face 1, 25–49 → face 2, 50–74 → face 3, 75–99 → face 4, 100 → face 5
function getFaceIndex(percent: number): number {
  if (percent >= 100) return 4
  if (percent >= 75) return 3
  if (percent >= 50) return 2
  if (percent >= 25) return 1
  return 0
}

function FaceDisplay({ percent }: { percent: number }): React.JSX.Element {
  const faceIndex = getFaceIndex(percent)
  const [displayIndex, setDisplayIndex] = useState(faceIndex)
  const [phase, setPhase] = useState<'idle' | 'out' | 'in'>('idle')
  const prevIndex = useRef(faceIndex)

  useEffect(() => {
    if (faceIndex === prevIndex.current) return

    setPhase('out')

    const swapTimer = setTimeout(() => {
      setDisplayIndex(faceIndex)
      setPhase('in')
      prevIndex.current = faceIndex
    }, 180)

    const idleTimer = setTimeout(() => {
      setPhase('idle')
    }, 360)

    return () => {
      clearTimeout(swapTimer)
      clearTimeout(idleTimer)
    }
  }, [faceIndex])

  return (
    <div className={`face-display face-display--${phase}`}>
      <img
        src={FACES[displayIndex].src}
        alt={FACES[displayIndex].alt}
        className="face-display__img"
      />
    </div>
  )
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16)
  ]
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number): string =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function lerpColor(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t)
}

function buildBaseLayer(): string {
  return 'conic-gradient(from 0deg, #FFB23E 0deg, transparent 270deg, transparent 360deg)'
}

const PROGRESS_STOPS = [
  { pct: 0, hex: '#FFB23E' }, // Orange at PI/2
  { pct: 25, hex: '#FFA1CA' }, // Pink at PI
  { pct: 50, hex: '#BB89C7' }, // Purple at 3PI/2
  { pct: 75, hex: '#8DEAFF' }, // Blue at 2PI
  { pct: 100, hex: '#C5EF00' } // Green at 5PI/2
]

function progressColorAt(percent: number): string {
  const clamped = Math.max(0, Math.min(100, percent))
  for (let i = 0; i < PROGRESS_STOPS.length - 1; i++) {
    const a = PROGRESS_STOPS[i]
    const b = PROGRESS_STOPS[i + 1]
    if (clamped <= b.pct) {
      const t = (clamped - a.pct) / (b.pct - a.pct)
      return lerpColor(a.hex, b.hex, t)
    }
  }
  return PROGRESS_STOPS[PROGRESS_STOPS.length - 1].hex
}

function buildProgressLayer(percent: number): string {
  const clamped = Math.max(0, Math.min(100, percent))
  const sweep = (clamped / 100) * 360
  const seamColor = '#FFB23E'

  if (sweep < 0.5) {
    return 'conic-gradient(from 0deg, transparent 0deg 360deg)'
  }

  const fromAngle = (360 - sweep) % 360
  const stops: string[] = []

  const headColor = progressColorAt(clamped)
  stops.push(`${headColor} 0deg`)

  for (let i = PROGRESS_STOPS.length - 1; i >= 0; i--) {
    const stop = PROGRESS_STOPS[i]
    if (stop.pct >= clamped) continue
    const deg = ((clamped - stop.pct) / 100) * 360
    stops.push(`${stop.hex} ${deg.toFixed(1)}deg`)
  }

  if (sweep < 359.5) {
    const overlapDeg = Math.min(360, sweep + 0.8)
    stops.push(`${seamColor} ${overlapDeg.toFixed(1)}deg`)

    const wrapCoverStart = 359.2
    if (overlapDeg < wrapCoverStart) {
      stops.push(`transparent ${overlapDeg.toFixed(1)}deg ${wrapCoverStart.toFixed(1)}deg`)
    }

    // Cover the conic 0/360 wrap seam with the current progress color.
    stops.push(`${headColor} ${wrapCoverStart.toFixed(1)}deg 360deg`)
  }

  return `conic-gradient(from ${fromAngle.toFixed(1)}deg, ${stops.join(', ')})`
}

function buildArcGradient(percent: number): string {
  return `${buildProgressLayer(percent)}, ${buildBaseLayer()}`
}

function ProgressArc({ percent }: { percent: number }): React.JSX.Element {
  const [animatedPercent, setAnimatedPercent] = useState(percent)
  const prevPercent = useRef(percent)

  useEffect(() => {
    const start = prevPercent.current
    const end = percent
    const duration = 500
    const startedAt = performance.now()
    let rafId = 0

    const tick = (now: number): void => {
      const elapsed = now - startedAt
      const t = Math.min(1, elapsed / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setAnimatedPercent(start + (end - start) * eased)

      if (t < 1) {
        rafId = requestAnimationFrame(tick)
      }
    }

    rafId = requestAnimationFrame(tick)
    prevPercent.current = percent

    return () => {
      cancelAnimationFrame(rafId)
    }
  }, [percent])

  const clamped = Math.max(0, Math.min(100, animatedPercent))
  const sweep = (clamped / 100) * 360
  const tipAngle = (360 - sweep + 360) % 360
  const tipRadians = (tipAngle * Math.PI) / 180

  const center = 93.5
  const trackRadius = 86.75
  const tipX = center + trackRadius * Math.sin(tipRadians)
  const tipY = center - trackRadius * Math.cos(tipRadians)
  const tipColor = progressColorAt(clamped)

  return (
    <>
      <div className="progress-arc" style={{ background: buildArcGradient(animatedPercent) }} />
      <div
        className="progress-arc__cap"
        style={{
          left: `${tipX.toFixed(2)}px`,
          top: `${tipY.toFixed(2)}px`,
          transform: `translate(-50%, -50%) rotate(${tipAngle.toFixed(1)}deg)`,
          backgroundColor: tipColor
        }}
      />
    </>
  )
}

function List(): React.JSX.Element {
  const [tasks, setTasks] = useState<Task[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [rescheduling, setRescheduling] = useState(false)

  async function loadTasks(showLoading = false): Promise<void> {
    if (showLoading) setIsLoading(true)
    try {
      const data = await window.api.getTasks()
      setTasks(data.map(mapTask))
    } catch {
      setTasks([])
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    async function loadInitialTasks(): Promise<void> {
      setIsLoading(true)
      try {
        const data = await window.api.getTasks()

        if (!cancelled) {
          setTasks(data.map(mapTask))
          setIsLoading(false)
        }
      } catch {
        if (!cancelled) {
          setTasks([])
          setIsLoading(false)
        }
      }
    }

    const onTasksChanged = (): void => {
      void loadInitialTasks()
    }

    void loadInitialTasks()
    window.addEventListener('tasks:changed', onTasksChanged)

    return () => {
      cancelled = true
      window.removeEventListener('tasks:changed', onTasksChanged)
    }
  }, [])

  const total = tasks.length
  const completedCount = tasks.filter((task) => task.completed).length
  const percent = total === 0 ? 100 : Math.round((completedCount / total) * 100)

  const dragItem = useRef<number | null>(null)
  const dragOver = useRef<number | null>(null)

  function handleDragStart(index: number): void {
    dragItem.current = index
  }

  function handleDragEnter(index: number, canDrop: boolean): void {
    if (!canDrop) return
    dragOver.current = index
    if (dragItem.current === null || dragItem.current === index) return
    const from = dragItem.current
    dragItem.current = index
    setTasks((prev) => {
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(index, 0, moved)
      return next
    })
  }

  async function handleDragEnd(): Promise<void> {
    const didMove = dragItem.current !== null && dragOver.current !== null
    dragItem.current = null
    dragOver.current = null

    if (!didMove) return

    const orderedIds = tasks.filter((task) => !task.completed).map((task) => task.id)
    try {
      const data = await window.api.reorderTasks(orderedIds)
      setTasks(data.map(mapTask))
      window.dispatchEvent(new Event('tasks:changed'))
    } catch {
      await loadTasks(true)
    }
  }

  async function toggleTask(id: string): Promise<void> {
    const current = tasks.find((task) => task.id === id)
    if (!current || current.completed) return

    try {
      const updated = await window.api.completeTask(id)

      setTasks((prev) => prev.map((task) => (task.id === id ? mapTask(updated) : task)))
      window.dispatchEvent(new Event('tasks:changed'))
      await loadTasks()
    } catch {
      return
    }
  }

  const scheduledTasks = tasks.filter((task) => task.scheduledStart !== null)
  const unscheduledTasks = tasks.filter((task) => task.scheduledStart === null)
  const unfinishedTasks = tasks.filter((task) => !task.completed)
  const orderedTasks = [...scheduledTasks, ...unscheduledTasks]

  async function handleRescheduleTomorrow(): Promise<void> {
    setRescheduling(true)

    try {
      const data = await window.api.rescheduleTomorrow()
      setTasks(data.map(mapTask))
      window.dispatchEvent(new Event('tasks:changed'))
    } catch {
      return
    } finally {
      setRescheduling(false)
    }
  }

  function renderTaskRow(task: Task, index: number): React.JSX.Element {
    return (
      <li
        key={task.id}
        className={`task-row ${task.completed ? 'task-row--done' : ''}`}
        draggable={!task.completed}
        onDragStart={() => handleDragStart(index)}
        onDragEnter={() => handleDragEnter(index, !task.completed)}
        onDragEnd={() => void handleDragEnd()}
        onDragOver={(e) => e.preventDefault()}
      >
        <img src={hamburger} alt="" className="task-row__handle" draggable={false} />
        <span className="task-row__title">
          <span className="task-row__title-text">{task.title}</span>
        </span>
        <span className="task-row__time">{task.estimatedMinutes} min</span>
        {task.completed ? (
          <span className="task-row__checkbox task-row__checkbox--locked">
            <svg width="18" height="18" viewBox="0 0 18 18">
              <circle cx="9" cy="9" r="8" fill="#C5EF00" stroke="#000000" strokeWidth="1.5" />
              <path
                d="M5 9.5 L7.5 12 L13 6.5"
                stroke="#000000"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                className="checkmark-path"
              />
            </svg>
          </span>
        ) : (
          <button
            className="task-row__checkbox"
            onClick={() => void toggleTask(task.id)}
            aria-label="Mark complete"
          >
            <svg width="18" height="18" viewBox="0 0 18 18">
              <circle cx="9" cy="9" r="8" fill="#FFF0CB" stroke="#000000" strokeWidth="1.5" />
            </svg>
          </button>
        )}
      </li>
    )
  }

  return (
    <div className="list-view">
      <div className="list-view__ring-wrapper">
        <ProgressArc percent={percent} />
        <div className="ring-outer" aria-hidden="true">
          <div className="ring-inner" />
        </div>
        <div className="list-view__face-center">
          <FaceDisplay percent={percent} />
        </div>
      </div>

      <ul className="list-view__tasks">
        {tasks.length === 0 ? (
          <li className="list-view__empty">{isLoading ? 'Loading...' : 'No tasks yet!'}</li>
        ) : null}
        {unfinishedTasks.length > 0 ? (
          <li className="list-view__action-row">
            <button
              type="button"
              className="list-view__tomorrow"
              disabled={rescheduling}
              onClick={() => void handleRescheduleTomorrow()}
            >
              {rescheduling ? 'Rescheduling...' : 'Reschedule unfinished to tomorrow'}
            </button>
          </li>
        ) : null}
        {scheduledTasks.map((task) => renderTaskRow(task, orderedTasks.indexOf(task)))}
        {unscheduledTasks.length > 0 ? (
          <li className="list-view__section-heading">Unscheduled Tasks</li>
        ) : null}
        {unscheduledTasks.map((task) => renderTaskRow(task, orderedTasks.indexOf(task)))}
      </ul>
    </div>
  )
}

export default List
