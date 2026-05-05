import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import './Calendar.css'

type Task = {
  id: string
  title: string
  estimatedMinutes: number
  scheduledStart: string | null
  scheduledEnd: string | null
  googleCalendarEventId: string | null
  completed: boolean
}

type ExternalCalendarEvent = {
  id: string
  title: string
  start: string
  end: string
}

type CalendarItem = {
  id: string
  title: string
  estimatedMinutes: number
  scheduledStart: string | null
  scheduledEnd: string | null
  completed: boolean
  source: 'task' | 'google'
  top: number
  blockTop: number
  blockHeight: number
  durationMinutes: number
  color: string
  connectsPrevious: boolean
  connectsNext: boolean
}

type CalendarConnector = {
  id: string
  top: number
  height: number
  fromColor: string
  toColor: string
  hasGap: boolean
}

type HourTick = {
  label: string
  top: number
}

const TASKS_CHANGED_EVENT = 'tasks:changed'
const DEFAULT_VISIBLE_START_MINUTES = 11 * 60
const PX_PER_MINUTE = 70 / 60
const FALLBACK_STARTS = [0, 67, 118, 223, 250, 282]
const EVENT_COLORS = ['#FFB23E', '#FFA1CA', '#BB89C7', '#8DEAFF', '#C5EF00']
const CONNECTED_GAP_PX = 2

function minutesFromDate(value: string): number {
  const date = new Date(value)
  return date.getHours() * 60 + date.getMinutes()
}

function isSameLocalDay(value: string, day: Date): boolean {
  const date = new Date(value)
  return (
    date.getFullYear() === day.getFullYear() &&
    date.getMonth() === day.getMonth() &&
    date.getDate() === day.getDate()
  )
}

function getMsUntilNextLocalDay(): number {
  const now = new Date()
  const nextDay = new Date(now)
  nextDay.setDate(now.getDate() + 1)
  nextDay.setHours(0, 0, 0, 0)
  return Math.max(1000, nextDay.getTime() - now.getTime())
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

function getDurationMinutes(item: {
  scheduledStart: string | null
  scheduledEnd: string | null
  estimatedMinutes: number
}): number {
  if (item.scheduledStart !== null && item.scheduledEnd !== null) {
    const start = minutesFromDate(item.scheduledStart)
    const end = minutesFromDate(item.scheduledEnd)
    if (end > start) return end - start
  }

  return item.estimatedMinutes
}

function getVisibleStartMinutes(
  tasks: Task[],
  externalEvents: ExternalCalendarEvent[],
  visibleDay: Date
): number {
  const taskStarts = tasks
    .filter(
      (task) =>
        !task.completed &&
        task.scheduledStart !== null &&
        isSameLocalDay(task.scheduledStart, visibleDay)
    )
    .map((task) => minutesFromDate(task.scheduledStart as string))
  const eventStarts = externalEvents
    .filter((event) => isSameLocalDay(event.start, visibleDay))
    .map((event) => minutesFromDate(event.start))
  const starts = [...taskStarts, ...eventStarts]

  if (starts.length === 0) return DEFAULT_VISIBLE_START_MINUTES
  return Math.floor(Math.min(...starts) / 60) * 60
}

function buildCalendarItems(
  tasks: Task[],
  externalEvents: ExternalCalendarEvent[],
  visibleDay: Date,
  visibleStartMinutes: number
): CalendarItem[] {
  const taskItems = tasks
    .filter(
      (task) =>
        !task.completed &&
        task.scheduledStart !== null &&
        isSameLocalDay(task.scheduledStart, visibleDay)
    )
    .map((task) => ({
      id: task.id,
      title: task.title,
      estimatedMinutes: task.estimatedMinutes,
      scheduledStart: task.scheduledStart,
      scheduledEnd: task.scheduledEnd,
      completed: task.completed,
      source: 'task' as const
    }))
  const taskGoogleIds = new Set(
    tasks
      .map((task) => task.googleCalendarEventId)
      .filter((id): id is string => id !== null && id.length > 0)
  )
  const googleItems = externalEvents
    .filter((event) => !taskGoogleIds.has(event.id))
    .map((event) => ({
      id: event.id,
      title: event.title,
      estimatedMinutes: 30,
      scheduledStart: event.start,
      scheduledEnd: event.end,
      completed: false,
      source: 'google' as const
    }))

  const orderedItems = [...taskItems, ...googleItems]
    .map((item, index) => {
      const scheduledTop =
        item.scheduledStart === null
          ? (FALLBACK_STARTS[index] ?? index * 52)
          : (minutesFromDate(item.scheduledStart) - visibleStartMinutes) * PX_PER_MINUTE
      const top = Math.max(0, Math.round(scheduledTop))
      const durationMinutes = getDurationMinutes(item)
      const blockHeight = clamp(Math.round(durationMinutes * PX_PER_MINUTE), 19, 120)

      return {
        ...item,
        top,
        blockTop: top,
        blockHeight,
        durationMinutes,
        connectsPrevious: false,
        connectsNext: false,
        color:
          item.source === 'google'
            ? '#FFD98A'
            : EVENT_COLORS[hashString(item.id) % EVENT_COLORS.length]
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
    .map((task, index, orderedTasks) => {
      if (index === 0) return task
      const previous = orderedTasks[index - 1]
      return {
        ...task,
        top: Math.max(task.top, previous.top + 38)
      }
    })

  return orderedItems.map((item, index) => {
    const previous = orderedItems[index - 1]
    const next = orderedItems[index + 1]
    const connectsPrevious =
      previous !== undefined &&
      item.blockTop - (previous.blockTop + previous.blockHeight) <= CONNECTED_GAP_PX
    const connectsNext =
      next !== undefined && next.blockTop - (item.blockTop + item.blockHeight) <= CONNECTED_GAP_PX

    return {
      ...item,
      connectsPrevious,
      connectsNext
    }
  })
}

function buildCalendarConnectors(items: CalendarItem[]): CalendarConnector[] {
  return items.slice(0, -1).map((item, index) => {
    const next = items[index + 1]
    const start = item.blockTop + item.blockHeight - 1
    const end = next.blockTop + 1
    const hasGap = next.blockTop - (item.blockTop + item.blockHeight) > CONNECTED_GAP_PX

    return {
      id: `${item.id}-${next.id}`,
      top: Math.min(start, end),
      height: Math.max(2, Math.abs(end - start)),
      fromColor: item.color,
      toColor: next.color,
      hasGap
    }
  })
}

function formatHour(totalMinutes: number): string {
  const hour24 = Math.floor(totalMinutes / 60)
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
  return `${hour12}:00`
}

function buildHourTicks(items: CalendarItem[], visibleStartMinutes: number): HourTick[] {
  if (items.length === 0) return []

  const lastEnd =
    visibleStartMinutes +
    Math.max(...items.map((item) => item.blockTop + item.blockHeight)) / PX_PER_MINUTE
  const finalHour = Math.max(visibleStartMinutes, Math.floor(lastEnd / 60) * 60)
  const ticks: HourTick[] = []

  for (let hour = visibleStartMinutes; hour <= finalHour; hour += 60) {
    ticks.push({
      label: formatHour(hour),
      top: ((hour - visibleStartMinutes) / 60) * 70
    })
  }

  return ticks
}

function Calendar(): React.JSX.Element {
  const [tasks, setTasks] = useState<Task[]>([])
  const [externalEvents, setExternalEvents] = useState<ExternalCalendarEvent[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [visibleDay, setVisibleDay] = useState(() => new Date())

  useEffect(() => {
    let cancelled = false

    async function loadTasks(showLoading = false): Promise<void> {
      if (showLoading) setIsLoading(true)
      try {
        const [data, googleEvents] = await Promise.all([
          window.api.getTasks(),
          window.api.getGoogleCalendarEvents()
        ])
        if (!cancelled) {
          setTasks(
            data.map((task) => ({
              id: task.id,
              title: task.title,
              estimatedMinutes: task.estimatedMinutes,
              scheduledStart: task.scheduledStart,
              scheduledEnd: task.scheduledEnd,
              googleCalendarEventId: task.googleCalendarEventId,
              completed: task.completed
            }))
          )
          setExternalEvents(googleEvents)
          setIsLoading(false)
        }
      } catch {
        if (!cancelled) {
          setTasks([])
          setExternalEvents([])
          setIsLoading(false)
        }
      }
    }

    const onTasksChanged = (): void => {
      void loadTasks(true)
    }

    const onWindowFocus = (): void => {
      setVisibleDay(new Date())
      void loadTasks(true)
    }

    let midnightTimer: number
    const scheduleMidnightRefresh = (): number => {
      return window.setTimeout(() => {
        setVisibleDay(new Date())
        void loadTasks(true)
        midnightTimer = scheduleMidnightRefresh()
      }, getMsUntilNextLocalDay())
    }

    midnightTimer = scheduleMidnightRefresh()
    void loadTasks(true)
    window.addEventListener(TASKS_CHANGED_EVENT, onTasksChanged)
    window.addEventListener('focus', onWindowFocus)

    return () => {
      cancelled = true
      window.clearTimeout(midnightTimer)
      window.removeEventListener(TASKS_CHANGED_EVENT, onTasksChanged)
      window.removeEventListener('focus', onWindowFocus)
    }
  }, [])

  const visibleStartMinutes = useMemo(
    () => getVisibleStartMinutes(tasks, externalEvents, visibleDay),
    [tasks, externalEvents, visibleDay]
  )
  const calendarItems = useMemo(
    () => buildCalendarItems(tasks, externalEvents, visibleDay, visibleStartMinutes),
    [tasks, externalEvents, visibleDay, visibleStartMinutes]
  )
  const calendarConnectors = useMemo(() => buildCalendarConnectors(calendarItems), [calendarItems])
  const hourTicks = useMemo(
    () => buildHourTicks(calendarItems, visibleStartMinutes),
    [calendarItems, visibleStartMinutes]
  )
  const calendarHeight = useMemo(() => {
    const bottom = calendarItems.reduce(
      (max, task) => Math.max(max, task.blockTop + task.blockHeight, task.top + 26),
      328
    )

    return Math.ceil(bottom)
  }, [calendarItems])

  async function toggleTask(id: string): Promise<void> {
    const current = tasks.find((task) => task.id === id)
    if (!current || current.completed) return

    try {
      const updated = await window.api.completeTask(id)

      setTasks((prev) =>
        prev.map((task) =>
          task.id === id
            ? {
                ...task,
                title: updated.title,
                estimatedMinutes: updated.estimatedMinutes,
                scheduledStart: updated.scheduledStart,
                scheduledEnd: updated.scheduledEnd,
                googleCalendarEventId: updated.googleCalendarEventId,
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
              className={`calendar-view__connector ${
                connector.hasGap ? 'calendar-view__connector--gap' : ''
              }`.trim()}
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
              className={`calendar-view__time-block ${
                task.connectsPrevious ? 'calendar-view__time-block--connected-prev' : ''
              } ${task.connectsNext ? 'calendar-view__time-block--connected-next' : ''}`.trim()}
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
            <li className="calendar-view__empty">{isLoading ? 'Loading...' : 'No tasks yet!'}</li>
          ) : null}
          {calendarItems.map((task) => (
            <li
              key={task.id}
              className={`calendar-task ${task.completed ? 'calendar-task--done' : ''} ${
                task.source === 'google' ? 'calendar-task--external' : ''
              }`}
              style={{ top: `${task.top}px` }}
            >
              <span className="calendar-task__copy">
                <span className="calendar-task__title">
                  <span className="calendar-task__title-text">{task.title}</span>
                </span>
                <span className="calendar-task__time">{task.durationMinutes} Minutes</span>
              </span>
              {task.source === 'task' && !task.completed ? (
                <button
                  type="button"
                  className="calendar-task__checkbox"
                  onClick={() => void toggleTask(task.id)}
                  aria-label="Mark complete"
                >
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
                </button>
              ) : task.source === 'task' && task.completed ? (
                <span className="calendar-task__checkbox calendar-task__checkbox--locked">
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
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export default Calendar
