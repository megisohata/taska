import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import './Calendar.css'

type Task = {
  id: string
  title: string
  estimatedMinutes: number
  scheduledStart: string | null
  scheduledEnd: string | null
  completed: boolean
}

type CalendarItem = Task & {
  top: number
  blockTop: number
  blockHeight: number
  durationMinutes: number
  color: string
}

type CalendarConnector = {
  id: string
  top: number
  height: number
  fromColor: string
  toColor: string
}

type HourTick = {
  label: string
  top: number
}

const TASKS_CHANGED_EVENT = 'tasks:changed'
const VISIBLE_START_MINUTES = 11 * 60
const PX_PER_MINUTE = 70 / 60
const FALLBACK_STARTS = [0, 67, 118, 223, 250, 282]
const EVENT_COLORS = ['#FFB23E', '#FFA1CA', '#BB89C7', '#8DEAFF', '#C5EF00']

function minutesFromDate(value: string): number {
  const date = new Date(value)
  return date.getHours() * 60 + date.getMinutes()
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) % 2147483647
  }
  return hash
}

function getDurationMinutes(task: Task): number {
  if (task.scheduledStart !== null && task.scheduledEnd !== null) {
    const start = minutesFromDate(task.scheduledStart)
    const end = minutesFromDate(task.scheduledEnd)
    if (end > start) return end - start
  }

  return task.estimatedMinutes
}

function buildCalendarItems(tasks: Task[]): CalendarItem[] {
  return tasks
    .map((task, index) => {
      const scheduledTop =
        task.scheduledStart === null
          ? (FALLBACK_STARTS[index] ?? index * 52)
          : (minutesFromDate(task.scheduledStart) - VISIBLE_START_MINUTES) * PX_PER_MINUTE
      const top = Math.max(0, Math.round(scheduledTop))
      const durationMinutes = getDurationMinutes(task)
      const blockHeight = clamp(Math.round(durationMinutes * PX_PER_MINUTE), 19, 120)

      return {
        ...task,
        top,
        blockTop: top,
        blockHeight,
        durationMinutes,
        color: EVENT_COLORS[hashString(task.id) % EVENT_COLORS.length]
      }
    })
    .sort((a, b) => a.blockTop - b.blockTop)
    .map((task, index, orderedTasks) => {
      if (index === 0 || task.color !== orderedTasks[index - 1].color) return task

      const previousColorIndex = EVENT_COLORS.indexOf(orderedTasks[index - 1].color)
      const currentColorIndex = EVENT_COLORS.indexOf(task.color)
      const nextColorIndex =
        (Math.max(previousColorIndex, currentColorIndex) + 1) % EVENT_COLORS.length
      return {
        ...task,
        color: EVENT_COLORS[nextColorIndex]
      }
    })
}

function buildCalendarConnectors(items: CalendarItem[]): CalendarConnector[] {
  return items.slice(0, -1).map((item, index) => {
    const next = items[index + 1]
    const start = item.blockTop + item.blockHeight - 1
    const end = next.blockTop + 1

    return {
      id: `${item.id}-${next.id}`,
      top: Math.min(start, end),
      height: Math.max(2, Math.abs(end - start)),
      fromColor: item.color,
      toColor: next.color
    }
  })
}

function formatHour(totalMinutes: number): string {
  const hour24 = Math.floor(totalMinutes / 60)
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
  return `${hour12}:00`
}

function buildHourTicks(items: CalendarItem[]): HourTick[] {
  if (items.length === 0) return []

  const lastEnd =
    VISIBLE_START_MINUTES +
    Math.max(...items.map((item) => item.blockTop + item.blockHeight)) / PX_PER_MINUTE
  const finalHour = Math.max(VISIBLE_START_MINUTES, Math.floor(lastEnd / 60) * 60)
  const ticks: HourTick[] = []

  for (let hour = VISIBLE_START_MINUTES; hour <= finalHour; hour += 60) {
    ticks.push({
      label: formatHour(hour),
      top: ((hour - VISIBLE_START_MINUTES) / 60) * 70
    })
  }

  return ticks
}

function Calendar(): React.JSX.Element {
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
              scheduledStart: task.scheduledStart,
              scheduledEnd: task.scheduledEnd,
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

  const calendarItems = useMemo(() => buildCalendarItems(tasks), [tasks])
  const calendarConnectors = useMemo(() => buildCalendarConnectors(calendarItems), [calendarItems])
  const hourTicks = useMemo(() => buildHourTicks(calendarItems), [calendarItems])
  const calendarHeight = useMemo(() => {
    const bottom = calendarItems.reduce(
      (max, task) => Math.max(max, task.blockTop + task.blockHeight, task.top + 26),
      328
    )

    return Math.ceil(bottom)
  }, [calendarItems])

  async function toggleTask(id: string): Promise<void> {
    const current = tasks.find((task) => task.id === id)
    if (!current) return

    try {
      const updated = current.completed
        ? await window.api.uncompleteTask(id)
        : await window.api.completeTask(id)

      setTasks((prev) =>
        prev.map((task) =>
          task.id === id
            ? {
                ...task,
                title: updated.title,
                estimatedMinutes: updated.estimatedMinutes,
                scheduledStart: updated.scheduledStart,
                scheduledEnd: updated.scheduledEnd,
                completed: updated.completed
              }
            : task
        )
      )
      window.dispatchEvent(new Event(TASKS_CHANGED_EVENT))
    } catch {
      return
    }
  }

  return (
    <section className="calendar-view" aria-label="Calendar schedule">
      <div className="calendar-view__canvas" style={{ height: `${calendarHeight}px` }}>
        <div className="calendar-view__timeline" aria-hidden="true">
          {calendarConnectors.map((connector) => (
            <span
              key={connector.id}
              className="calendar-view__connector"
              style={
                {
                  top: `${connector.top}px`,
                  height: `${connector.height}px`,
                  '--connector-start': connector.fromColor,
                  '--connector-end': connector.toColor
                } as CSSProperties
              }
            />
          ))}
          {calendarItems.map((task) => (
            <span
              key={task.id}
              className="calendar-view__time-block"
              style={
                {
                  top: `${task.blockTop}px`,
                  height: `${task.blockHeight}px`,
                  '--event-color': task.color
                } as CSSProperties
              }
            />
          ))}
        </div>

        <div className="calendar-view__hours" aria-hidden="true">
          {hourTicks.map((hour) => (
            <span key={hour.label} style={{ top: `${hour.top}px` }}>
              {hour.label}
            </span>
          ))}
        </div>

        <ul className="calendar-view__tasks">
          {calendarItems.length === 0 ? (
            <li className="calendar-view__empty">No tasks yet!</li>
          ) : null}
          {calendarItems.map((task) => (
            <li
              key={task.id}
              className={`calendar-task ${task.completed ? 'calendar-task--done' : ''}`}
              style={{ top: `${task.top}px` }}
            >
              <span className="calendar-task__copy">
                <span className="calendar-task__title">
                  <span className="calendar-task__title-text">{task.title}</span>
                </span>
                <span className="calendar-task__time">{task.durationMinutes} Minutes</span>
              </span>
              <button
                type="button"
                className="calendar-task__checkbox"
                onClick={() => void toggleTask(task.id)}
                aria-label={task.completed ? 'Mark incomplete' : 'Mark complete'}
              >
                {task.completed ? (
                  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                    <circle
                      cx="10"
                      cy="10"
                      r="9.25"
                      fill="#C5EF00"
                      stroke="#000000"
                      strokeWidth="1.5"
                    />
                    <path
                      d="M6 10.4 L8.6 13 L14 7.2"
                      stroke="#000000"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                    />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                    <circle
                      cx="10"
                      cy="10"
                      r="9.25"
                      fill="#FFF0CB"
                      stroke="#000000"
                      strokeWidth="1.5"
                    />
                  </svg>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export default Calendar
