import { ElectronAPI } from '@electron-toolkit/preload'

type Urgency = 'low' | 'med' | 'high'

type TaskApiModel = {
  id: string
  title: string
  context: string | null
  urgency: Urgency
  estimatedMinutes: number
  scheduledStart: string | null
  scheduledEnd: string | null
  googleCalendarEventId: string | null
  actualMinutes: number | null
  completed: boolean
  completedAt: string | null
  manualOrder: number | null
  createdAt: string
}

type AddTaskInput = {
  title: string
  context?: string
  urgency: Urgency
}

type SettingsApiModel = {
  workStart: string
  workEnd: string
  schedulingPreferences: string
  includedGoogleCalendarIds: string[]
  googleCalendarSelectionConfigured: boolean
  googleCalendarConnected: boolean
}

type GoogleCalendarEventApiModel = {
  id: string
  calendarId: string
  title: string
  start: string
  end: string
}

type GoogleCalendarApiModel = {
  id: string
  summary: string
  primary: boolean
  selected: boolean
  isTaska: boolean
  backgroundColor: string | null
}

type SaveSettingsInput = {
  workStart: string
  workEnd: string
  schedulingPreferences: string
  includedGoogleCalendarIds: string[]
}

type AppApi = {
  getTasks: () => Promise<TaskApiModel[]>
  addTask: (data: AddTaskInput) => Promise<TaskApiModel>
  completeTask: (id: string) => Promise<TaskApiModel>
  uncompleteTask: (id: string) => Promise<TaskApiModel>
  rescheduleTomorrow: () => Promise<TaskApiModel[]>
  getSettings: () => Promise<SettingsApiModel>
  saveSettings: (data: SaveSettingsInput) => Promise<SettingsApiModel>
  connectGoogleCalendar: () => Promise<{ started: boolean }>
  getGoogleCalendarEvents: () => Promise<GoogleCalendarEventApiModel[]>
  getGoogleCalendars: () => Promise<GoogleCalendarApiModel[]>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: AppApi
  }
}
