import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { initDatabase } from './db'

type StubUrgency = 'low' | 'med' | 'high'

type StubTask = {
  id: string
  title: string
  context: string | null
  urgency: StubUrgency
  estimatedMinutes: number
  scheduledStart: string | null
  scheduledEnd: string | null
  googleCalendarEventId: string | null
  completed: boolean
  completedAt: string | null
  manualOrder: number | null
  createdAt: string
}

type StubNewTask = {
  title: string
  context?: string
  urgency: StubUrgency
}

const stubTasks: StubTask[] = [
  {
    id: 'stub-1',
    title: 'Draft today plan',
    context: 'Focus block',
    urgency: 'med',
    estimatedMinutes: 30,
    scheduledStart: null,
    scheduledEnd: null,
    googleCalendarEventId: null,
    completed: false,
    completedAt: null,
    manualOrder: 0,
    createdAt: new Date().toISOString()
  }
]

function registerStubTaskIpcHandlers(): void {
  ipcMain.handle('tasks:getAll', () => {
    return stubTasks
  })

  ipcMain.handle('tasks:add', (_, data: StubNewTask) => {
    const task: StubTask = {
      id: `stub-${Date.now()}`,
      title: data.title,
      context: data.context ?? null,
      urgency: data.urgency,
      estimatedMinutes: 30,
      scheduledStart: null,
      scheduledEnd: null,
      googleCalendarEventId: null,
      completed: false,
      completedAt: null,
      manualOrder: stubTasks.length,
      createdAt: new Date().toISOString()
    }

    stubTasks.unshift(task)
    return task
  })

  ipcMain.handle('tasks:complete', (_, id: string) => {
    const task = stubTasks.find((item) => item.id === id)
    if (!task) {
      throw new Error(`Task with id ${id} not found`)
    }

    task.completed = true
    task.completedAt = new Date().toISOString()
    return task
  })

  ipcMain.handle('tasks:uncomplete', (_, id: string) => {
    const task = stubTasks.find((item) => item.id === id)
    if (!task) {
      throw new Error(`Task with id ${id} not found`)
    }

    task.completed = false
    task.completedAt = null
    return task
  })
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 350,
    height: 450,
    useContentSize: true,
    alwaysOnTop: true,
    resizable: false,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  initDatabase(app.getPath('userData'))
  registerStubTaskIpcHandlers()

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
