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

type AppApi = {
  getTasks: () => Promise<TaskApiModel[]>
  addTask: (data: AddTaskInput) => Promise<TaskApiModel>
  completeTask: (id: string) => Promise<TaskApiModel>
  uncompleteTask: (id: string) => Promise<TaskApiModel>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: AppApi
  }
}
