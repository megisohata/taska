import { app, shell, BrowserWindow, ipcMain, safeStorage } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { createServer, type Server } from 'http'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  getAllTasks,
  getSchedulerSettings,
  getSetting,
  hasGoogleTokens,
  initDatabase,
  saveGoogleTokens,
  setSchedulerSettings,
  type NewTask,
  type SchedulerSettings
} from './db'
import {
  completeTaskAndRefreshSchedule,
  createScheduledTask,
  getGoogleCalendars,
  getVisibleGoogleCalendarEvents,
  rescheduleUnfinishedTasksToTomorrow,
  uncompleteTaskAndRefreshSchedule,
  withRequiredTaskaCalendar
} from './scheduler'

const GOOGLE_OAUTH_PORT = 42813
const GOOGLE_REDIRECT_URI = `http://127.0.0.1:${GOOGLE_OAUTH_PORT}/oauth/google/callback`
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly'
]

type GoogleTokenResponse = {
  access_token?: string
  refresh_token?: string
  scope?: string
  token_type?: string
  expires_in?: number
  error?: string
  error_description?: string
}

let googleOAuthServer: Server | null = null

function parseEnvLine(line: string): [string, string] | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return null

  const separator = trimmed.indexOf('=')
  if (separator === -1) return null

  const key = trimmed.slice(0, separator).trim()
  let value = trimmed.slice(separator + 1).trim()

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1)
  }

  return key ? [key, value] : null
}

function loadEnvFile(): void {
  const candidates = [join(process.cwd(), '.env'), join(app.getAppPath(), '.env')]

  for (const envPath of candidates) {
    if (!existsSync(envPath)) continue

    const contents = readFileSync(envPath, 'utf8')
    for (const line of contents.split(/\r?\n/)) {
      const parsed = parseEnvLine(line)
      if (!parsed) continue

      const [key, value] = parsed
      process.env[key] ??= value
    }
  }
}

function requireGoogleEnv(): { clientId: string; clientSecret: string } {
  const clientId = process.env['GOOGLE_CLIENT_ID']
  const clientSecret = process.env['GOOGLE_CLIENT_SECRET']

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in the environment.')
  }

  return { clientId, clientSecret }
}

function protectSecret(value: string | null | undefined): string | null {
  if (!value) return null
  if (!safeStorage.isEncryptionAvailable()) return value
  return `safeStorage:v1:${safeStorage.encryptString(value).toString('base64')}`
}

function revealSecret(value: string | null | undefined): string | null {
  if (!value) return null
  const prefix = 'safeStorage:v1:'
  if (!value.startsWith(prefix)) return value
  if (!safeStorage.isEncryptionAvailable()) return null
  return safeStorage.decryptString(Buffer.from(value.slice(prefix.length), 'base64'))
}

function sendOAuthHtml(
  res: import('http').ServerResponse,
  statusCode: number,
  title: string,
  body: string
): void {
  res.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(`<!doctype html><html><body><h1>${title}</h1><p>${body}</p></body></html>`)
}

function ensureGoogleOAuthCallbackServer(): void {
  if (googleOAuthServer) return

  googleOAuthServer = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url ?? '/', GOOGLE_REDIRECT_URI)
      if (requestUrl.pathname !== '/oauth/google/callback') {
        sendOAuthHtml(res, 404, 'Not found', 'This callback route is only used for Google OAuth.')
        return
      }

      const error = requestUrl.searchParams.get('error')
      if (error) {
        sendOAuthHtml(res, 400, 'Google Calendar not connected', error)
        return
      }

      const code = requestUrl.searchParams.get('code')
      if (!code) {
        sendOAuthHtml(res, 400, 'Google Calendar not connected', 'Missing authorization code.')
        return
      }

      const { clientId, clientSecret } = requireGoogleEnv()
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: GOOGLE_REDIRECT_URI,
          grant_type: 'authorization_code'
        })
      })
      const tokenJson = (await tokenResponse.json()) as GoogleTokenResponse

      if (!tokenResponse.ok || !tokenJson.access_token) {
        throw new Error(tokenJson.error_description ?? tokenJson.error ?? 'Token exchange failed.')
      }

      saveGoogleTokens({
        accessToken: protectSecret(tokenJson.access_token) ?? tokenJson.access_token,
        refreshToken: protectSecret(tokenJson.refresh_token),
        scope: tokenJson.scope ?? null,
        tokenType: tokenJson.token_type ?? null,
        expiryDate:
          typeof tokenJson.expires_in === 'number' ? Date.now() + tokenJson.expires_in * 1000 : null
      })

      sendOAuthHtml(
        res,
        200,
        'Google Calendar connected',
        'You can close this window and return to Taska.'
      )
    } catch (error) {
      sendOAuthHtml(
        res,
        500,
        'Google Calendar not connected',
        error instanceof Error ? error.message : 'Unexpected OAuth error.'
      )
    }
  })

  googleOAuthServer.listen(GOOGLE_OAUTH_PORT, '127.0.0.1')
}

function registerTaskIpcHandlers(): void {
  ipcMain.handle('tasks:getAll', () => {
    return getAllTasks()
  })

  ipcMain.handle('tasks:add', async (_, data: NewTask) => {
    return createScheduledTask(data, { protectSecret, revealSecret })
  })

  ipcMain.handle('tasks:complete', async (_, id: string) => {
    return completeTaskAndRefreshSchedule(id, { protectSecret, revealSecret })
  })

  ipcMain.handle('tasks:uncomplete', async (_, id: string) => {
    return uncompleteTaskAndRefreshSchedule(id, { protectSecret, revealSecret })
  })

  ipcMain.handle('tasks:rescheduleTomorrow', async () => {
    return rescheduleUnfinishedTasksToTomorrow({ protectSecret, revealSecret })
  })
}

function registerSettingsIpcHandlers(): void {
  ipcMain.handle('settings:get', () => {
    return {
      ...getSchedulerSettings(),
      googleCalendarSelectionConfigured: (getSetting('includedGoogleCalendarIds') ?? '').length > 0,
      googleCalendarConnected: hasGoogleTokens()
    }
  })

  ipcMain.handle('settings:save', async (_, settings: SchedulerSettings) => {
    const saved = setSchedulerSettings({
      ...settings,
      includedGoogleCalendarIds: await withRequiredTaskaCalendar(
        settings.includedGoogleCalendarIds,
        {
          protectSecret,
          revealSecret
        }
      )
    })
    return {
      ...saved,
      googleCalendarSelectionConfigured: true,
      googleCalendarConnected: hasGoogleTokens()
    }
  })

  ipcMain.handle('googleCalendar:connect', async () => {
    const { clientId } = requireGoogleEnv()
    ensureGoogleOAuthCallbackServer()

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('redirect_uri', GOOGLE_REDIRECT_URI)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('scope', GOOGLE_SCOPES.join(' '))
    authUrl.searchParams.set('access_type', 'offline')
    authUrl.searchParams.set('prompt', 'consent')

    await shell.openExternal(authUrl.toString())
    return { started: true }
  })

  ipcMain.handle('googleCalendar:getEvents', async () => {
    return getVisibleGoogleCalendarEvents({ protectSecret, revealSecret })
  })

  ipcMain.handle('googleCalendar:getCalendars', async () => {
    return getGoogleCalendars({ protectSecret, revealSecret })
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
  loadEnvFile()
  initDatabase(app.getPath('userData'))
  registerTaskIpcHandlers()
  registerSettingsIpcHandlers()

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
