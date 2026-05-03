import {
  getAllTasks,
  getGoogleTokens,
  getSchedulerSettings,
  getSetting,
  insertTask,
  saveGoogleTokens,
  setTaskScheduled,
  type GoogleTokenSet,
  type NewTask,
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
  backgroundColor: string | null
}

type OpenAIEstimate = {
  estimatedMinutes: number
  preferredPeriod: 'morning' | 'afternoon' | 'any'
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

function clampDuration(value: number): number {
  const rounded = Math.round(value / 5) * 5
  return Math.max(MIN_DURATION, Math.min(MAX_DURATION, rounded))
}

function extractJsonObject(value: string): unknown {
  const start = value.indexOf('{')
  const end = value.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Model did not return JSON.')
  }

  return JSON.parse(value.slice(start, end + 1)) as unknown
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

  return {
    estimatedMinutes,
    preferredPeriod: text.includes('meeting') ? 'afternoon' : 'any'
  }
}

async function estimateTaskWithOpenAI(task: NewTask): Promise<OpenAIEstimate> {
  const apiKey = process.env['OPENAI_API_KEY']
  if (!apiKey) return fallbackEstimate(task)

  const settings = getSchedulerSettings()
  const model = getSetting('openAiModel') ?? DEFAULT_MODEL
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'system',
          content:
            'Estimate task scheduling metadata. Return only JSON with estimatedMinutes (number) and preferredPeriod ("morning", "afternoon", or "any").'
        },
        {
          role: 'user',
          content: JSON.stringify({
            taskTitle: task.title,
            taskDescription: task.context ?? '',
            urgency: task.urgency,
            workStart: settings.workStart,
            workEnd: settings.workEnd,
            schedulingPreferences: settings.schedulingPreferences
          })
        }
      ]
    })
  })

  if (!response.ok) return fallbackEstimate(task)

  const json = (await response.json()) as { output_text?: string; output?: unknown }
  const outputText =
    json.output_text ?? JSON.stringify(json.output).replace(/\\n/g, '\n').replace(/\\"/g, '"')

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

async function getIncludedGoogleCalendarIds(secrets: SchedulerSecrets): Promise<string[]> {
  const configuredCalendarIds = getSetting('includedGoogleCalendarIds')
  if (configuredCalendarIds && configuredCalendarIds.length > 0) {
    const settings = getSchedulerSettings()
    return settings.includedGoogleCalendarIds
  }

  const calendars = await getGoogleCalendars(secrets)
  const visibleCalendars = calendars.filter((calendar) => calendar.selected)
  if (visibleCalendars.length > 0) return visibleCalendars.map((calendar) => calendar.id)

  return [getGoogleCalendarId()]
}

async function getGoogleBusyIntervals(
  timeMin: Date,
  timeMax: Date,
  secrets: SchedulerSecrets
): Promise<BusyInterval[]> {
  const calendarIds = await getIncludedGoogleCalendarIds(secrets)
  const eventGroups = await Promise.all(
    calendarIds.map((calendarId) => getGoogleEvents(calendarId, timeMin, timeMax, secrets))
  )

  return eventGroups.flat().map((event) => ({
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

  const response = await fetch(getGoogleCalendarEventsUrl(getGoogleCalendarId()), {
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

export async function getGoogleCalendars(
  secrets: SchedulerSecrets
): Promise<GoogleCalendarSummary[]> {
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
        backgroundColor: calendar.backgroundColor ?? null
      }
    })
    .filter((calendar): calendar is GoogleCalendarSummary => calendar !== null)
}

function getLocalBusyIntervals(): BusyInterval[] {
  return getAllTasks()
    .filter((task) => task.scheduledStart !== null && task.scheduledEnd !== null && !task.completed)
    .map((task) => ({
      start: new Date(task.scheduledStart as string),
      end: new Date(task.scheduledEnd as string)
    }))
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart
}

function findFreeSlot(
  durationMinutes: number,
  preferredPeriod: OpenAIEstimate['preferredPeriod'],
  busyIntervals: BusyInterval[]
): { start: Date; end: Date } | null {
  const settings = getSchedulerSettings()
  const now = new Date()
  const lookaheadDays = Number.parseInt(getSetting('lookaheadDays') ?? '7', 10)
  const slotStepMinutes = 15

  for (let offset = 0; offset < lookaheadDays; offset++) {
    const day = new Date(now)
    day.setDate(now.getDate() + offset)
    const workStart = setTime(day, settings.workStart)
    const workEnd = setTime(day, settings.workEnd)

    let cursor = new Date(Math.max(workStart.getTime(), now.getTime()))
    cursor.setMinutes(Math.ceil(cursor.getMinutes() / slotStepMinutes) * slotStepMinutes, 0, 0)

    if (preferredPeriod === 'morning') {
      const noon = setTime(day, '12:00')
      if (cursor >= noon) continue
    }

    if (preferredPeriod === 'afternoon') {
      cursor = new Date(Math.max(cursor.getTime(), setTime(day, '12:00').getTime()))
    }

    while (addMinutes(cursor, durationMinutes) <= workEnd) {
      const end = addMinutes(cursor, durationMinutes)
      const conflicts = busyIntervals.some((interval) =>
        overlaps(cursor, end, interval.start, interval.end)
      )

      if (!conflicts) return { start: cursor, end }
      cursor = addMinutes(cursor, slotStepMinutes)
    }
  }

  return null
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
  const settings = getSchedulerSettings()
  const now = new Date()
  const lookaheadDays = Number.parseInt(getSetting('lookaheadDays') ?? '7', 10)
  const timeMax = new Date(now)
  timeMax.setDate(now.getDate() + lookaheadDays)
  timeMax.setHours(parseTime(settings.workEnd).hours, parseTime(settings.workEnd).minutes, 0, 0)

  let googleBusy: BusyInterval[] = []
  try {
    googleBusy = await getGoogleBusyIntervals(now, timeMax, secrets)
  } catch {
    googleBusy = []
  }
  const localBusy = getLocalBusyIntervals()
  const slot = findFreeSlot(estimate.estimatedMinutes, estimate.preferredPeriod, [
    ...googleBusy,
    ...localBusy
  ])
  const task = insertTask({ ...input, estimatedMinutes: estimate.estimatedMinutes })

  if (!slot) return task

  let googleEventId: string | null = null
  try {
    googleEventId = await createGoogleCalendarEvent(task, slot.start, slot.end, secrets)
  } catch {
    googleEventId = null
  }

  return setTaskScheduled(task.id, slot.start.toISOString(), slot.end.toISOString(), googleEventId)
}

export async function getVisibleGoogleCalendarEvents(
  secrets: SchedulerSecrets
): Promise<ExternalCalendarEvent[]> {
  const now = new Date()
  const timeMin = startOfLocalDay(now)
  const timeMax = startOfNextLocalDay(now)

  try {
    const calendarIds = await getIncludedGoogleCalendarIds(secrets)
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
