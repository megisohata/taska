import Database from 'better-sqlite3'
import { dirname, join } from 'path'
import { mkdirSync } from 'fs'
import { v4 as uuidv4 } from 'uuid'

// Types

export type Urgency = 'low' | 'med' | 'high'

export type Task = {
  id: string
  title: string
  context: string | null
  urgency: Urgency
  estimatedMinutes: number
  scheduledStart: string | null
  scheduledEnd: string | null
  googleCalendarEventId: string | null
  completed: boolean
  completedAt: string | null
  manualOrder: number | null
  createdAt: string
}

export type NewTask = {
  title: string
  context?: string
  urgency: Urgency
  estimatedMinutes?: number
}

const VALID_URGENCIES = ['low', 'med', 'high'] as const

export type Setting = {
  key: string
  value: string
}

export type GoogleTokenSet = {
  accessToken: string
  refreshToken: string | null
  scope: string | null
  tokenType: string | null
  expiryDate: number | null
}

type GoogleTokenRow = {
  access_token: string
  refresh_token: string | null
  scope: string | null
  token_type: string | null
  expiry_date: number | null
}

export type SchedulerSettings = {
  workStart: string
  workEnd: string
  schedulingPreferences: string
  includedGoogleCalendarIds: string[]
}

type TaskRow = {
  id: string
  title: string
  context: string | null
  urgency: string
  estimated_minutes: number
  scheduled_start: string | null
  scheduled_end: string | null
  google_event_id: string | null
  completed: number
  completed_at: string | null
  manual_order: number | null
  created_at: string
}

// Singleton

let db: Database.Database | null = null

function ensureDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database is not initialized. Call initDatabase() first.')
  }
  return db
}

// Row mapper

function mapTaskRow(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    context: row.context,
    urgency: row.urgency as Urgency,
    estimatedMinutes: row.estimated_minutes,
    scheduledStart: row.scheduled_start,
    scheduledEnd: row.scheduled_end,
    googleCalendarEventId: row.google_event_id,
    completed: row.completed === 1,
    completedAt: row.completed_at,
    manualOrder: row.manual_order,
    createdAt: row.created_at
  }
}

// Init

export function initDatabase(basePath: string): Database.Database {
  if (db) return db

  const dbPath = join(basePath, 'taska.sqlite')
  mkdirSync(dirname(dbPath), { recursive: true })

  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id                TEXT PRIMARY KEY,
      title             TEXT NOT NULL,
      context           TEXT,
      urgency           TEXT NOT NULL DEFAULT 'med' CHECK (urgency IN ('low', 'med', 'high')),
      estimated_minutes INTEGER NOT NULL DEFAULT 30,
      scheduled_start   TEXT,
      scheduled_end     TEXT,
      google_event_id   TEXT,
      completed         INTEGER NOT NULL DEFAULT 0,
      completed_at      TEXT,
      manual_order      INTEGER,
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS google_oauth_tokens (
      id            INTEGER PRIMARY KEY CHECK (id = 1),
      access_token  TEXT NOT NULL,
      refresh_token TEXT,
      scope         TEXT,
      token_type    TEXT,
      expiry_date   INTEGER,
      updated_at    TEXT NOT NULL
    );
  `)

  seedDefaultSettings()
  return db
}

// Default settings

function seedDefaultSettings(): void {
  const database = ensureDatabase()
  const insert = database.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')

  const defaults: Setting[] = [
    { key: 'workStart', value: '09:00' },
    { key: 'workEnd', value: '18:00' },
    { key: 'lookaheadDays', value: '7' },
    { key: 'calendarColor', value: '#F6BF26' },
    { key: 'bufferMinutes', value: '10' },
    { key: 'calendarId', value: '' },
    { key: 'includedGoogleCalendarIds', value: '' },
    { key: 'openAiModel', value: 'gpt-5.4-mini' },
    { key: 'schedulingPreferences', value: '' }
  ]

  const seed = database.transaction((items: Setting[]) => {
    for (const item of items) {
      insert.run(item.key, item.value)
    }
  })

  seed(defaults)
}

// Task queries

const TASK_SELECT = `
  SELECT
    id, title, context, urgency,
    estimated_minutes, scheduled_start, scheduled_end,
    google_event_id, completed, completed_at, manual_order, created_at
  FROM tasks
`

export function getAllTasks(): Task[] {
  const database = ensureDatabase()
  const rows = database
    .prepare(`${TASK_SELECT} ORDER BY scheduled_start ASC, created_at ASC`)
    .all() as TaskRow[]
  return rows.map(mapTaskRow)
}

export function getTaskById(id: string): Task {
  const database = ensureDatabase()
  const row = database.prepare(`${TASK_SELECT} WHERE id = ?`).get(id) as TaskRow | undefined

  if (!row) throw new Error(`Task with id ${id} not found`)
  return mapTaskRow(row)
}

export function getUnscheduledTasks(): Task[] {
  const database = ensureDatabase()
  const rows = database
    .prepare(
      `${TASK_SELECT}
       WHERE scheduled_start IS NULL AND completed = 0
       ORDER BY
         CASE urgency WHEN 'high' THEN 0 WHEN 'med' THEN 1 ELSE 2 END ASC,
         manual_order ASC NULLS LAST,
         created_at ASC`
    )
    .all() as TaskRow[]
  return rows.map(mapTaskRow)
}

export function getRecentCompletedTasks(limit = 10): Task[] {
  const database = ensureDatabase()
  const rows = database
    .prepare(
      `${TASK_SELECT}
       WHERE completed = 1
       ORDER BY completed_at DESC
       LIMIT ?`
    )
    .all(limit) as TaskRow[]
  return rows.map(mapTaskRow)
}

export function insertTask(input: NewTask): Task {
  const database = ensureDatabase()
  const id = uuidv4()
  const now = new Date().toISOString()
  const urgency = VALID_URGENCIES.includes(input.urgency) ? input.urgency : 'med'
  const estimatedMinutes =
    typeof input.estimatedMinutes === 'number' && input.estimatedMinutes > 0
      ? Math.round(input.estimatedMinutes)
      : 30

  database
    .prepare(
      `
    INSERT INTO tasks (id, title, context, urgency, estimated_minutes, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `
    )
    .run(id, input.title, input.context ?? null, urgency, estimatedMinutes, now)

  return getTaskById(id)
}

export function setTaskScheduled(
  id: string,
  scheduledStart: string,
  scheduledEnd: string,
  googleEventId: string | null
): Task {
  const database = ensureDatabase()
  database
    .prepare(
      `UPDATE tasks
       SET scheduled_start = ?, scheduled_end = ?, google_event_id = ?
       WHERE id = ?`
    )
    .run(scheduledStart, scheduledEnd, googleEventId, id)
  return getTaskById(id)
}

export function setTaskCompleted(
  id: string,
  completed: boolean,
  completedAt?: string | null
): Task {
  const database = ensureDatabase()

  if (completed) {
    database
      .prepare('UPDATE tasks SET completed = 1, completed_at = ? WHERE id = ?')
      .run(completedAt ?? new Date().toISOString(), id)
  } else {
    database.prepare('UPDATE tasks SET completed = 0, completed_at = NULL WHERE id = ?').run(id)
  }

  return getTaskById(id)
}

export function reorderUnscheduledTasks(orderedIds: string[]): void {
  const database = ensureDatabase()
  const update = database.prepare('UPDATE tasks SET manual_order = ? WHERE id = ?')
  const transaction = database.transaction((ids: string[]) => {
    ids.forEach((id, index) => update.run(index, id))
  })
  transaction(orderedIds)
}

export function deleteAllTasks(): void {
  ensureDatabase().prepare('DELETE FROM tasks').run()
}

// Settings queries

export function getAllSettings(): Setting[] {
  const database = ensureDatabase()
  return database.prepare('SELECT key, value FROM settings ORDER BY key').all() as Setting[]
}

export function getSetting(key: string): string | null {
  const database = ensureDatabase()
  const row = database.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string): Setting {
  ensureDatabase()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value)
  return { key, value }
}

function parseJsonStringArray(value: string | null): string[] {
  if (!value) return []

  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
  } catch {
    return []
  }
}

export function getSchedulerSettings(): SchedulerSettings {
  return {
    workStart: getSetting('workStart') ?? '09:00',
    workEnd: getSetting('workEnd') ?? '18:00',
    schedulingPreferences: getSetting('schedulingPreferences') ?? '',
    includedGoogleCalendarIds: parseJsonStringArray(getSetting('includedGoogleCalendarIds'))
  }
}

export function setSchedulerSettings(settings: SchedulerSettings): SchedulerSettings {
  const database = ensureDatabase()
  const update = database.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  )
  const transaction = database.transaction((next: SchedulerSettings) => {
    update.run('workStart', next.workStart)
    update.run('workEnd', next.workEnd)
    update.run('schedulingPreferences', next.schedulingPreferences)
    update.run('includedGoogleCalendarIds', JSON.stringify(next.includedGoogleCalendarIds))
  })

  transaction(settings)
  return getSchedulerSettings()
}

export function saveGoogleTokens(tokens: GoogleTokenSet): void {
  ensureDatabase()
    .prepare(
      `INSERT INTO google_oauth_tokens (
         id, access_token, refresh_token, scope, token_type, expiry_date, updated_at
       ) VALUES (1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         access_token = excluded.access_token,
         refresh_token = COALESCE(excluded.refresh_token, google_oauth_tokens.refresh_token),
         scope = excluded.scope,
         token_type = excluded.token_type,
         expiry_date = excluded.expiry_date,
         updated_at = excluded.updated_at`
    )
    .run(
      tokens.accessToken,
      tokens.refreshToken,
      tokens.scope,
      tokens.tokenType,
      tokens.expiryDate,
      new Date().toISOString()
    )
}

export function getGoogleTokens(): GoogleTokenSet | null {
  const row = ensureDatabase()
    .prepare(
      `SELECT access_token, refresh_token, scope, token_type, expiry_date
       FROM google_oauth_tokens WHERE id = 1`
    )
    .get() as GoogleTokenRow | undefined

  if (!row) return null

  return {
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    scope: row.scope,
    tokenType: row.token_type,
    expiryDate: row.expiry_date
  }
}

export function hasGoogleTokens(): boolean {
  const row = ensureDatabase()
    .prepare('SELECT 1 FROM google_oauth_tokens WHERE id = 1 LIMIT 1')
    .get() as { 1: number } | undefined
  return row !== undefined
}
