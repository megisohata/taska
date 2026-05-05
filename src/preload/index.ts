import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  getTasks: () => ipcRenderer.invoke('tasks:getAll') as Promise<unknown[]>,
  addTask: (data: { title: string; context?: string; urgency: 'low' | 'med' | 'high' }) =>
    ipcRenderer.invoke('tasks:add', data) as Promise<unknown>,
  completeTask: (id: string) => ipcRenderer.invoke('tasks:complete', id) as Promise<unknown>,
  reorderTasks: (orderedIds: string[]) =>
    ipcRenderer.invoke('tasks:reorder', orderedIds) as Promise<unknown[]>,
  rescheduleTomorrow: () => ipcRenderer.invoke('tasks:rescheduleTomorrow') as Promise<unknown[]>,
  getSettings: () => ipcRenderer.invoke('settings:get') as Promise<unknown>,
  saveSettings: (data: {
    workStart: string
    workEnd: string
    schedulingPreferences: string
    includedGoogleCalendarIds: string[]
  }) => ipcRenderer.invoke('settings:save', data) as Promise<unknown>,
  connectGoogleCalendar: () =>
    ipcRenderer.invoke('googleCalendar:connect') as Promise<{ started: boolean }>,
  getGoogleCalendarEvents: () =>
    ipcRenderer.invoke('googleCalendar:getEvents') as Promise<unknown[]>,
  getGoogleCalendars: () => ipcRenderer.invoke('googleCalendar:getCalendars') as Promise<unknown[]>
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
