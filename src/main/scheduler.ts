import {
  getAllTasks,
  getGoogleTokens,
  getRecentCompletedTasks,
  getSchedulerSettings,
  getSetting,
  getTaskById,
  insertTask,
  reorderOpenTasks,
  saveGoogleTokens,
  setTaskCompleted,
  setSetting,
  setTaskScheduled,
  type GoogleTokenSet,
  type NewTask,
  type PreferredPeriod,
  type Task
} from './db'

type ProtectedSecret = (value: string | null | undefined) => string | null
type RevealedSecret = (value: string | null | undefined) => string | null

type SchedulerSecrets = {
  protectSecret: ProtectedSecret
  revealSecret: RevealedSecret
}

export type ExternalCalendarEvent = {
  id: string
  calendarId: string
  title: string
  start: string
  end: string
}

export type GoogleCalendarSummary = {
  id: string
  summary: string
  primary: boolean
  selected: boolean
  isTaska: boolean
  backgroundColor: string | null
}

type OpenAIEstimate = {
  estimatedMinutes: number
  preferredPeriod: PreferredPeriod
}

type BusyInterval = {
  start: Date
  end: Date
}

type GoogleEventsResponse = {
  items?: Array<{
    id?: string
    summary?: string
    start?: { dateTime?: string; date?: string }
    end?: { dateTime?: string; date?: string }
  }>
}

type GoogleCalendarListResponse = {
  items?: Array<{
    id?: string
    summary?: string
    primary?: boolean
    selected?: boolean
    backgroundColor?: string
  }>
}

type GoogleCalendarResponse = {
  id?: string
  summary?: string
}

type GoogleCreateEventResponse = {
  id?: string
}

type GoogleTokenResponse = {
  access_token?: string
  refresh_token?: string
  scope?: string
  token_type?: string
  expires_in?: number
}

const DEFAULT_MODEL = 'gpt-5.4-mini'
const MIN_DURATION = 15
const MAX_DURATION = 240
const MAX_ACTUAL_DURATION = 480
const TASKA_CALENDAR_SUMMARY = 'DockIt'
const LEGACY_TASKA_CALENDAR_SUMMARY = 'Taska'

function parseTime(value: string): { hours: number; minutes: number } {
  const [hours = '9', minutes = '0'] = value.split(':')
  return {
    hours: Number.parseInt(hours, 10),
    minutes: Number.parseInt(minutes, 10)
  }
}

function setTime(base: Date, value: string): Date {
  const next = new Date(base)
  const { hours, minutes } = parseTime(value)
  next.setHours(hours, minutes, 0, 0)
  return next
}

function addMinutes(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60_000)
}

function startOfLocalDay(base: Date): Date {
  const next = new Date(base)
  next.setHours(0, 0, 0, 0)
  return next
}

function startOfNextLocalDay(base: Date): Date {
  const next = startOfLocalDay(base)
  next.setDate(next.getDate() + 1)
  return next
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return startOfLocalDay(a).getTime() === startOfLocalDay(b).getTime()
}

function clampDuration(value: number): number {
  const rounded = Math.ceil(value / 15) * 15
  return Math.max(MIN_DURATION, Math.min(MAX_DURATION, rounded))
}

function clampActualDuration(value: number): number {
  return Math.max(1, Math.min(MAX_ACTUAL_DURATION, Math.round(value)))
}

function getHistoricalTaskDurations(): Array<{
  title: string
  urgency: Task['urgency']
  estimatedMinutes: number
  actualMinutes: number
}> {
  return getRecentCompletedTasks(12)
    .filter((task) => task.actualMinutes !== null)
    .map((task) => ({
      title: task.title,
      urgency: task.urgency,
      estimatedMinutes: task.estimatedMinutes,
      actualMinutes: task.actualMinutes as number
    }))
}

function getHistoricalEstimateMultiplier(): number {
  const durations = getHistoricalTaskDurations()
  if (durations.length === 0) return 1

  const ratios = durations
    .filter((task) => task.estimatedMinutes > 0)
    .map((task) => task.actualMinutes / task.estimatedMinutes)
    .filter((ratio) => Number.isFinite(ratio) && ratio > 0)

  if (ratios.length === 0) return 1
  const average = ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length
  return Math.max(0.5, Math.min(1.75, average))
}

function extractJsonObject(value: string): unknown {
  const start = value.indexOf('{')
  const end = value.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Model did not return JSON.')
  }

  return JSON.parse(value.slice(start, end + 1)) as unknown
}

type OpenAIResponseContent = {
  type?: string
  text?: string
}

type OpenAIResponseOutputItem = {
  type?: string
  content?: OpenAIResponseContent[]
}

type OpenAIResponseJson = {
  output_text?: string
  output?: OpenAIResponseOutputItem[]
  error?: {
    message?: string
  }
}

function getOpenAIResponseText(json: OpenAIResponseJson): string {
  if (typeof json.output_text === 'string' && json.output_text.trim().length > 0) {
    return json.output_text
  }

  const textParts =
    json.output
      ?.flatMap((item) => item.content ?? [])
      .map((content) => content.text)
      .filter((text): text is string => typeof text === 'string' && text.trim().length > 0) ?? []

  if (textParts.length > 0) return textParts.join('\n')
  throw new Error('Model did not return text.')
}

function parseEstimate(value: unknown): OpenAIEstimate {
  const record = value as Partial<OpenAIEstimate>
  const preferredPeriod =
    record.preferredPeriod === 'morning' || record.preferredPeriod === 'afternoon'
      ? record.preferredPeriod
      : 'any'
  const estimatedMinutes =
    typeof record.estimatedMinutes === 'number' ? record.estimatedMinutes : MIN_DURATION * 2

  return {
    estimatedMinutes: clampDuration(estimatedMinutes),
    preferredPeriod
  }
}

function fallbackEstimate(task: NewTask): OpenAIEstimate {
  const text = `${task.title} ${task.context ?? ''}`.toLowerCase()
  let estimatedMinutes = 30

  if (text.includes('quick') || text.includes('email')) estimatedMinutes = 15
  if (text.includes('draft') || text.includes('write') || text.includes('plan'))
    estimatedMinutes = 45
  if (text.includes('code') || text.includes('build') || text.includes('implement'))
    estimatedMinutes = 90
  if (task.urgency === 'high') estimatedMinutes = Math.max(30, estimatedMinutes)
  estimatedMinutes = clampDuration(estimatedMinutes * getHistoricalEstimateMultiplier())

  return {
    estimatedMinutes,
    preferredPeriod: text.includes('meeting') ? 'afternoon' : 'any'
  }
}

async function estimateTaskWithOpenAI(task: NewTask): Promise<OpenAIEstimate> {
  const apiKey = process.env['OPENAI_API_KEY']
  if (!apiKey) return fallbackEstimate(task)

  const settings = getSchedulerSettings()
  const historicalDurations = getHistoricalTaskDurations()
  const model = getSetting('openAiModel') ?? DEFAULT_MODEL
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      text: {
        format: {
          type: 'json_schema',
          name: 'task_estimate',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              estimatedMinutes: {
                type: 'number',
                description:
                  'The total estimated duration in minutes before rounding to the nearest 15.'
              },
              preferredPeriod: {
                type: 'string',
                enum: ['morning', 'afternoon', 'any']
              }
            },
            required: ['estimatedMinutes', 'preferredPeriod']
          }
        }
      },
      input: [
        {
          role: 'system',
          content:
            'Estimate task scheduling metadata for a daily planner. Return only JSON with estimatedMinutes (number) and preferredPeriod ("morning", "afternoon", or "any"). Use the task title, description/context, user scheduling preferences, and recent completed task history. Pay careful attention to any explicit or implicit duration clues in the user text, including estimates, ranges, repeated work, quantities, per-item times, and math such as "10 lectures, 15 minutes each"; compute the total duration before returning. If the user directly gives a duration or gives enough information to calculate one, use that result. Otherwise infer from comparable past tasks and the task type. Prefer the user’s preferred work periods when they are relevant. estimatedMinutes should be the final total in minutes before the app rounds it up to the nearest 15.'
        },
        {
          role: 'user',
          content: JSON.stringify({
            taskTitle: task.title,
            taskDescription: task.context ?? '',
            urgency: task.urgency,
            workStart: settings.workStart,
            workEnd: settings.workEnd,
            schedulingPreferences: settings.schedulingPreferences,
            recentCompletedTaskDurations: historicalDurations
          })
        }
      ]
    })
  })

  const json = (await response.json()) as OpenAIResponseJson

  if (!response.ok) {
    console.warn('OpenAI estimate failed:', json.error?.message ?? response.statusText)
    return fallbackEstimate(task)
  }

  const outputText = getOpenAIResponseText(json)

  return parseEstimate(extractJsonObject(outputText))
}

function revealTokens(
  tokens: GoogleTokenSet | null,
  revealSecret: RevealedSecret
): GoogleTokenSet | null {
  if (!tokens) return null

  return {
    ...tokens,
    accessToken: revealSecret(tokens.accessToken) ?? tokens.accessToken,
    refreshToken: revealSecret(tokens.refreshToken)
  }
}

async function refreshGoogleToken(
  tokens: GoogleTokenSet,
  secrets: SchedulerSecrets
): Promise<GoogleTokenSet> {
  const clientId = process.env['GOOGLE_CLIENT_ID']
  const clientSecret = process.env['GOOGLE_CLIENT_SECRET']

  if (!clientId || !clientSecret || !tokens.refreshToken) return tokens

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refreshToken,
      grant_type: 'refresh_token'
    })
  })

  if (!response.ok) return tokens

  const json = (await response.json()) as GoogleTokenResponse
  if (!json.access_token) return tokens

  const refreshed = {
    accessToken: json.access_token,
    refreshToken: tokens.refreshToken,
    scope: json.scope ?? tokens.scope,
    tokenType: json.token_type ?? tokens.tokenType,
    expiryDate: typeof json.expires_in === 'number' ? Date.now() + json.expires_in * 1000 : null
  }

  saveGoogleTokens({
    ...refreshed,
    accessToken: secrets.protectSecret(refreshed.accessToken) ?? refreshed.accessToken,
    refreshToken: secrets.protectSecret(refreshed.refreshToken)
  })

  return refreshed
}

function getGoogleCalendarId(): string {
  const calendarId = getSetting('calendarId')?.trim()
  return calendarId && calendarId.length > 0 ? calendarId : 'primary'
}

async function ensureTaskaGoogleCalendarId(secrets: SchedulerSecrets): Promise<string | null> {
  const savedCalendarId = getSetting('calendarId')?.trim()
  if (savedCalendarId) {
    await updateGoogleCalendarSummary(savedCalendarId, TASKA_CALENDAR_SUMMARY, secrets)
    return savedCalendarId
  }

  const accessToken = await getGoogleAccessToken(secrets)
  if (!accessToken) return null

  const calendars = await getRawGoogleCalendars(secrets)
  const existing = calendars.find(
    (calendar) =>
      calendar.summary === TASKA_CALENDAR_SUMMARY ||
      calendar.summary === LEGACY_TASKA_CALENDAR_SUMMARY
  )
  if (existing) {
    setSetting('calendarId', existing.id)
    await updateGoogleCalendarSummary(existing.id, TASKA_CALENDAR_SUMMARY, secrets)
    return existing.id
  }

  const response = await fetch('https://www.googleapis.com/calendar/v3/calendars', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      summary: TASKA_CALENDAR_SUMMARY
    })
  })

  if (!response.ok) return null

  const json = (await response.json()) as GoogleCalendarResponse
  if (!json.id) return null

  setSetting('calendarId', json.id)
  return json.id
}

async function updateGoogleCalendarSummary(
  calendarId: string,
  summary: string,
  secrets: SchedulerSecrets
): Promise<void> {
  const accessToken = await getGoogleAccessToken(secrets)
  if (!accessToken) return

  await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ summary })
    }
  )
}

function getGoogleCalendarEventsUrl(calendarId: string): string {
  return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
}

async function getGoogleAccessToken(secrets: SchedulerSecrets): Promise<string | null> {
  const stored = revealTokens(getGoogleTokens(), secrets.revealSecret)
  if (!stored) return null

  if (stored.expiryDate !== null && stored.expiryDate < Date.now() + 60_000) {
    return (await refreshGoogleToken(stored, secrets)).accessToken
  }

  return stored.accessToken
}

async function getGoogleEvents(
  calendarId: string,
  timeMin: Date,
  timeMax: Date,
  secrets: SchedulerSecrets
): Promise<ExternalCalendarEvent[]> {
  const accessToken = await getGoogleAccessToken(secrets)
  if (!accessToken) return []

  const requestUrl = new URL(getGoogleCalendarEventsUrl(calendarId))
  requestUrl.searchParams.set('timeMin', timeMin.toISOString())
  requestUrl.searchParams.set('timeMax', timeMax.toISOString())
  requestUrl.searchParams.set('singleEvents', 'true')
  requestUrl.searchParams.set('orderBy', 'startTime')

  const response = await fetch(requestUrl, {
    headers: { Authorization: `Bearer ${accessToken}` }
  })
  if (!response.ok) return []

  const json = (await response.json()) as GoogleEventsResponse
  return (json.items ?? [])
    .map((event) => {
      const startValue = event.start?.dateTime ?? event.start?.date
      const endValue = event.end?.dateTime ?? event.end?.date
      if (!event.id || !startValue || !endValue) return null

      return {
        id: event.id,
        calendarId,
        title: event.summary ?? 'Calendar Event',
        start: startValue,
        end: endValue
      }
    })
    .filter((item): item is ExternalCalendarEvent => item !== null)
}

async function getIncludedGoogleEvents(
  timeMin: Date,
  timeMax: Date,
  secrets: SchedulerSecrets
): Promise<ExternalCalendarEvent[]> {
  const calendarIds = await getIncludedExternalGoogleCalendarIds(secrets)
  const eventGroups = await Promise.all(
    calendarIds.map((calendarId) => getGoogleEvents(calendarId, timeMin, timeMax, secrets))
  )
  return eventGroups.flat()
}

async function getIncludedGoogleCalendarIds(secrets: SchedulerSecrets): Promise<string[]> {
  const taskaCalendarId = await ensureTaskaGoogleCalendarId(secrets)
  const configuredCalendarIds = getSetting('includedGoogleCalendarIds')
  if (configuredCalendarIds && configuredCalendarIds.length > 0) {
    const settings = getSchedulerSettings()
    return mergeRequiredTaskaCalendarId(settings.includedGoogleCalendarIds, taskaCalendarId)
  }

  const calendars = await getRawGoogleCalendars(secrets)
  const visibleCalendars = calendars.filter((calendar) => calendar.selected)
  if (visibleCalendars.length > 0) {
    return mergeRequiredTaskaCalendarId(
      visibleCalendars.map((calendar) => calendar.id),
      taskaCalendarId
    )
  }

  return mergeRequiredTaskaCalendarId([getGoogleCalendarId()], taskaCalendarId)
}

async function getIncludedExternalGoogleCalendarIds(secrets: SchedulerSecrets): Promise<string[]> {
  const taskaCalendarId = await ensureTaskaGoogleCalendarId(secrets)
  return (await getIncludedGoogleCalendarIds(secrets)).filter(
    (calendarId) => calendarId !== taskaCalendarId
  )
}

function mergeRequiredTaskaCalendarId(
  calendarIds: string[],
  taskaCalendarId: string | null
): string[] {
  const next = new Set(calendarIds)
  if (taskaCalendarId) next.add(taskaCalendarId)
  return [...next]
}

async function getGoogleBusyIntervals(
  timeMin: Date,
  timeMax: Date,
  secrets: SchedulerSecrets,
  excludedEventIds = new Set<string>()
): Promise<BusyInterval[]> {
  return (await getIncludedGoogleEvents(timeMin, timeMax, secrets))
    .filter((event) => !excludedEventIds.has(event.id))
    .map((event) => ({
      start: new Date(event.start),
      end: new Date(event.end)
    }))
}

async function createGoogleCalendarEvent(
  task: Task,
  start: Date,
  end: Date,
  secrets: SchedulerSecrets
): Promise<string | null> {
  const accessToken = await getGoogleAccessToken(secrets)
  if (!accessToken) return null
  const calendarId = await ensureTaskaGoogleCalendarId(secrets)
  if (!calendarId) return null

  const response = await fetch(getGoogleCalendarEventsUrl(calendarId), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      summary: task.title,
      description: task.context ?? undefined,
      colorId: '6',
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() }
    })
  })

  if (!response.ok) return null

  const json = (await response.json()) as GoogleCreateEventResponse
  return json.id ?? null
}

async function updateGoogleCalendarEvent(
  task: Task,
  start: Date,
  end: Date,
  secrets: SchedulerSecrets
): Promise<string | null> {
  if (!task.googleCalendarEventId) {
    return createGoogleCalendarEvent(task, start, end, secrets)
  }

  const accessToken = await getGoogleAccessToken(secrets)
  if (!accessToken) return task.googleCalendarEventId
  const calendarId = await ensureTaskaGoogleCalendarId(secrets)
  if (!calendarId) return task.googleCalendarEventId

  const response = await fetch(
    `${getGoogleCalendarEventsUrl(calendarId)}/${encodeURIComponent(task.googleCalendarEventId)}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        summary: task.title,
        description: task.context ?? undefined,
        colorId: '6',
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() }
      })
    }
  )

  if (response.ok) return task.googleCalendarEventId
  if (response.status === 404 || response.status === 410) {
    return createGoogleCalendarEvent(task, start, end, secrets)
  }

  return task.googleCalendarEventId
}

async function deleteGoogleCalendarEvent(
  eventId: string,
  secrets: SchedulerSecrets
): Promise<boolean> {
  const accessToken = await getGoogleAccessToken(secrets)
  if (!accessToken) return false
  const calendarId = await ensureTaskaGoogleCalendarId(secrets)
  if (!calendarId) return false

  const response = await fetch(
    `${getGoogleCalendarEventsUrl(calendarId)}/${encodeURIComponent(eventId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` }
    }
  )

  return response.ok || response.status === 404 || response.status === 410
}

async function getRawGoogleCalendars(secrets: SchedulerSecrets): Promise<GoogleCalendarSummary[]> {
  const accessToken = await getGoogleAccessToken(secrets)
  if (!accessToken) return []

  const requestUrl = new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList')
  requestUrl.searchParams.set('minAccessRole', 'reader')

  const response = await fetch(requestUrl, {
    headers: { Authorization: `Bearer ${accessToken}` }
  })
  if (!response.ok) return []

  const json = (await response.json()) as GoogleCalendarListResponse
  return (json.items ?? [])
    .map((calendar) => {
      if (!calendar.id) return null

      return {
        id: calendar.id,
        summary: calendar.summary ?? 'Untitled Calendar',
        primary: calendar.primary === true,
        selected: calendar.selected !== false,
        isTaska: false,
        backgroundColor: calendar.backgroundColor ?? null
      }
    })
    .filter((calendar): calendar is GoogleCalendarSummary => calendar !== null)
}

export async function getGoogleCalendars(
  secrets: SchedulerSecrets
): Promise<GoogleCalendarSummary[]> {
  const taskaCalendarId = await ensureTaskaGoogleCalendarId(secrets)
  return (await getRawGoogleCalendars(secrets)).map((calendar) => ({
    ...calendar,
    selected: calendar.id === taskaCalendarId ? true : calendar.selected,
    isTaska: calendar.id === taskaCalendarId
  }))
}

export async function withRequiredTaskaCalendar(
  calendarIds: string[],
  secrets: SchedulerSecrets
): Promise<string[]> {
  return mergeRequiredTaskaCalendarId(calendarIds, await ensureTaskaGoogleCalendarId(secrets))
}

function getSchedulingWindow(day = new Date(), fromNow = true): { timeMin: Date; timeMax: Date } {
  const settings = getSchedulerSettings()
  const now = new Date()
  const timeMin = fromNow
    ? new Date(Math.max(now.getTime(), setTime(day, settings.workStart).getTime()))
    : startOfLocalDay(day)
  const timeMax = new Date(day)
  timeMax.setHours(parseTime(settings.workEnd).hours, parseTime(settings.workEnd).minutes, 0, 0)
  return { timeMin, timeMax }
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart
}

function findFreeSlot(
  durationMinutes: number,
  preferredPeriod: OpenAIEstimate['preferredPeriod'],
  busyIntervals: BusyInterval[],
  day = new Date(),
  fromNow = true
): { start: Date; end: Date } | null {
  const settings = getSchedulerSettings()
  const now = new Date()
  const slotStepMinutes = 15
  const workStart = setTime(day, settings.workStart)
  const workEnd = setTime(day, settings.workEnd)
  let periodEnd = workEnd

  let cursor = fromNow ? new Date(Math.max(workStart.getTime(), now.getTime())) : workStart
  cursor.setMinutes(Math.ceil(cursor.getMinutes() / slotStepMinutes) * slotStepMinutes, 0, 0)

  if (preferredPeriod === 'morning') {
    const noon = setTime(day, '12:00')
    if (cursor >= noon) return null
    periodEnd = new Date(Math.min(workEnd.getTime(), noon.getTime()))
  }

  if (preferredPeriod === 'afternoon') {
    cursor = new Date(Math.max(cursor.getTime(), setTime(day, '12:00').getTime()))
  }

  while (addMinutes(cursor, durationMinutes) <= periodEnd) {
    const end = addMinutes(cursor, durationMinutes)
    const conflicts = busyIntervals.some((interval) =>
      overlaps(cursor, end, interval.start, interval.end)
    )

    if (!conflicts) return { start: cursor, end }
    cursor = addMinutes(cursor, slotStepMinutes)
  }

  return null
}

function findBestSlot(
  durationMinutes: number,
  preferredPeriod: PreferredPeriod,
  busyIntervals: BusyInterval[],
  day = new Date(),
  fromNow = true
): { start: Date; end: Date } | null {
  const preferredSlot = findFreeSlot(durationMinutes, preferredPeriod, busyIntervals, day, fromNow)
  if (preferredSlot || preferredPeriod === 'any') return preferredSlot
  return findFreeSlot(durationMinutes, 'any', busyIntervals, day, fromNow)
}

function sortOpenTasksForScheduling(tasks: Task[], explicitOrderIds?: string[]): Task[] {
  const explicitOrder = explicitOrderIds
    ? new Map(explicitOrderIds.map((id, index) => [id, index]))
    : null

  return [...tasks]
    .filter((task) => !task.completed)
    .sort((a, b) => {
      if (explicitOrder) {
        const orderA = explicitOrder.get(a.id)
        const orderB = explicitOrder.get(b.id)
        if (orderA !== undefined && orderB !== undefined) return orderA - orderB
        if (orderA !== undefined) return -1
        if (orderB !== undefined) return 1
      }

      const urgencyRank = { high: 0, med: 1, low: 2 } as const
      const urgencyDelta = urgencyRank[a.urgency] - urgencyRank[b.urgency]
      if (urgencyDelta !== 0) return urgencyDelta

      const preferredRank = { morning: 0, any: 1, afternoon: 2 } as const
      const preferredDelta = preferredRank[a.preferredPeriod] - preferredRank[b.preferredPeriod]
      if (preferredDelta !== 0) return preferredDelta

      if (a.scheduledStart && b.scheduledStart) {
        return new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime()
      }
      if (a.scheduledStart) return -1
      if (b.scheduledStart) return 1

      const orderA = a.manualOrder ?? Number.MAX_SAFE_INTEGER
      const orderB = b.manualOrder ?? Number.MAX_SAFE_INTEGER
      if (orderA !== orderB) return orderA - orderB

      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    })
}

function calculateActualMinutes(task: Task, completedAt: Date): number | null {
  if (!task.scheduledStart) return null

  const scheduledStart = new Date(task.scheduledStart)
  if (completedAt <= scheduledStart) return task.estimatedMinutes

  return clampActualDuration((completedAt.getTime() - scheduledStart.getTime()) / 60_000)
}

async function syncTaskGoogleEvent(
  task: Task,
  slot: { start: Date; end: Date } | null,
  secrets: SchedulerSecrets
): Promise<string | null> {
  if (!slot) {
    if (task.googleCalendarEventId) {
      await deleteGoogleCalendarEvent(task.googleCalendarEventId, secrets)
    }
    return null
  }

  return updateGoogleCalendarEvent(task, slot.start, slot.end, secrets)
}

async function rescheduleOpenTasks(
  secrets: SchedulerSecrets,
  day = new Date(),
  fromNow = true,
  includeAllOpenTasks = false,
  explicitOrderIds?: string[]
): Promise<void> {
  const openTasks = sortOpenTasksForScheduling(
    getAllTasks().filter((task) => {
      if (task.completed) return false
      if (includeAllOpenTasks) return true
      if (!task.scheduledStart) return true
      return isSameLocalDay(new Date(task.scheduledStart), day)
    }),
    explicitOrderIds
  )
  const taskGoogleEventIds = new Set(
    openTasks
      .map((task) => task.googleCalendarEventId)
      .filter((eventId): eventId is string => eventId !== null && eventId.length > 0)
  )
  const { timeMin, timeMax } = getSchedulingWindow(day, fromNow)

  let busyIntervals: BusyInterval[] = []
  try {
    busyIntervals = await getGoogleBusyIntervals(timeMin, timeMax, secrets, taskGoogleEventIds)
  } catch {
    busyIntervals = []
  }

  for (const task of openTasks) {
    const slot = findBestSlot(
      task.estimatedMinutes,
      task.preferredPeriod,
      busyIntervals,
      day,
      fromNow
    )
    let googleEventId: string | null = task.googleCalendarEventId

    try {
      googleEventId = await syncTaskGoogleEvent(task, slot, secrets)
    } catch {
      googleEventId = task.googleCalendarEventId
    }

    if (!slot) {
      setTaskScheduled(task.id, null, null, googleEventId)
      continue
    }

    setTaskScheduled(task.id, slot.start.toISOString(), slot.end.toISOString(), googleEventId)
    busyIntervals.push({ start: slot.start, end: slot.end })
  }
}

export async function createScheduledTask(
  input: NewTask,
  secrets: SchedulerSecrets
): Promise<Task> {
  let estimate = fallbackEstimate(input)
  try {
    estimate = await estimateTaskWithOpenAI(input)
  } catch {
    estimate = fallbackEstimate(input)
  }

  const task = insertTask({
    ...input,
    estimatedMinutes: estimate.estimatedMinutes,
    preferredPeriod: estimate.preferredPeriod
  })
  await rescheduleOpenTasks(secrets)
  return getTaskById(task.id)
}

export async function completeTaskAndRefreshSchedule(
  id: string,
  secrets: SchedulerSecrets
): Promise<Task> {
  const task = getTaskById(id)
  const completedAt = new Date()
  const actualMinutes = calculateActualMinutes(task, completedAt)
  const completedTask = setTaskCompleted(id, true, completedAt.toISOString(), actualMinutes)

  if (completedTask.googleCalendarEventId) {
    try {
      const deleted = await deleteGoogleCalendarEvent(completedTask.googleCalendarEventId, secrets)
      if (deleted) {
        setTaskScheduled(
          completedTask.id,
          completedTask.scheduledStart,
          completedTask.scheduledEnd,
          null
        )
      }
    } catch {
      // Keep the local completion even if Google Calendar cannot be updated.
    }
  }

  await rescheduleOpenTasks(secrets)
  return getTaskById(id)
}

export async function rescheduleUnfinishedTasksToTomorrow(
  secrets: SchedulerSecrets
): Promise<Task[]> {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  await rescheduleOpenTasks(secrets, tomorrow, false, true)
  return getAllTasks()
}

export async function reorderTasksAndRefreshSchedule(
  orderedIds: string[],
  secrets: SchedulerSecrets
): Promise<Task[]> {
  reorderOpenTasks(orderedIds)
  await rescheduleOpenTasks(secrets, new Date(), true, false, orderedIds)
  return getAllTasks()
}

export async function getVisibleGoogleCalendarEvents(
  secrets: SchedulerSecrets
): Promise<ExternalCalendarEvent[]> {
  const now = new Date()
  const timeMin = startOfLocalDay(now)
  const timeMax = startOfNextLocalDay(now)

  try {
    const calendarIds = await getIncludedExternalGoogleCalendarIds(secrets)
    const eventGroups = await Promise.all(
      calendarIds.map((calendarId) => getGoogleEvents(calendarId, timeMin, timeMax, secrets))
    )
    return eventGroups
      .flat()
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
  } catch {
    return []
  }
}
