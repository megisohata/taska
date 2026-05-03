import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import './SettingsOverlay.css'

type SettingsOverlayProps = {
  onClose: () => void
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

type GoogleCalendar = {
  id: string
  summary: string
  primary: boolean
  selected: boolean
  backgroundColor: string | null
}

function SettingsOverlay({ onClose }: SettingsOverlayProps): React.JSX.Element {
  const [workStart, setWorkStart] = useState('09:00')
  const [workEnd, setWorkEnd] = useState('18:00')
  const [schedulingPreferences, setSchedulingPreferences] = useState('')
  const [calendars, setCalendars] = useState<GoogleCalendar[]>([])
  const [includedGoogleCalendarIds, setIncludedGoogleCalendarIds] = useState<string[]>([])
  const [googleCalendarSelectionConfigured, setGoogleCalendarSelectionConfigured] = useState(false)
  const [googleConnected, setGoogleConnected] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [googleState, setGoogleState] = useState<SaveState>('idle')
  const [calendarsState, setCalendarsState] = useState<SaveState>('idle')

  useEffect(() => {
    let cancelled = false

    async function loadSettings(): Promise<void> {
      try {
        const settings = await window.api.getSettings()
        if (cancelled) return
        setWorkStart(settings.workStart)
        setWorkEnd(settings.workEnd)
        setSchedulingPreferences(settings.schedulingPreferences)
        setIncludedGoogleCalendarIds(settings.includedGoogleCalendarIds)
        setGoogleCalendarSelectionConfigured(settings.googleCalendarSelectionConfigured)
        setGoogleConnected(settings.googleCalendarConnected)

        if (settings.googleCalendarConnected) {
          setCalendarsState('saving')
          const googleCalendars = await window.api.getGoogleCalendars()
          if (cancelled) return
          setCalendars(googleCalendars)
          if (!settings.googleCalendarSelectionConfigured) {
            setIncludedGoogleCalendarIds(
              googleCalendars.filter((calendar) => calendar.selected).map((calendar) => calendar.id)
            )
          }
          setCalendarsState('idle')
        }
      } catch {
        if (!cancelled) {
          setSaveState('error')
          setCalendarsState('error')
        }
      }
    }

    void loadSettings()

    return () => {
      cancelled = true
    }
  }, [])

  async function handleSave(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setSaveState('saving')

    try {
      const settings = await window.api.saveSettings({
        workStart,
        workEnd,
        schedulingPreferences,
        includedGoogleCalendarIds
      })
      setGoogleConnected(settings.googleCalendarConnected)
      setIncludedGoogleCalendarIds(settings.includedGoogleCalendarIds)
      setGoogleCalendarSelectionConfigured(settings.googleCalendarSelectionConfigured)
      setSaveState('saved')
    } catch {
      setSaveState('error')
    }
  }

  async function handleConnectGoogle(): Promise<void> {
    setGoogleState('saving')

    try {
      await window.api.connectGoogleCalendar()
      setGoogleState('saved')
    } catch {
      setGoogleState('error')
    }
  }

  async function handleRefreshCalendars(): Promise<void> {
    setCalendarsState('saving')

    try {
      const googleCalendars = await window.api.getGoogleCalendars()
      setCalendars(googleCalendars)
      setGoogleConnected(true)
      setCalendarsState('idle')

      if (!googleCalendarSelectionConfigured) {
        setIncludedGoogleCalendarIds(
          googleCalendars.filter((calendar) => calendar.selected).map((calendar) => calendar.id)
        )
      }
    } catch {
      setCalendarsState('error')
    }
  }

  function toggleCalendar(calendarId: string): void {
    setGoogleCalendarSelectionConfigured(true)
    setIncludedGoogleCalendarIds((prev) =>
      prev.includes(calendarId) ? prev.filter((id) => id !== calendarId) : [...prev, calendarId]
    )
  }

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="settings-overlay__panel">
        <button
          type="button"
          className="settings-overlay__close"
          aria-label="Close settings"
          onClick={onClose}
        >
          <X size={18} strokeWidth={2.5} />
        </button>

        <h1>Settings</h1>

        <form className="settings-overlay__form" onSubmit={handleSave}>
          <section className="settings-overlay__section">
            <h2>Calendar</h2>
            <button
              type="button"
              className="settings-overlay__button"
              onClick={() => void handleConnectGoogle()}
              disabled={googleState === 'saving'}
            >
              {googleConnected ? 'Reconnect Google Calendar' : 'Connect Google Calendar'}
            </button>
            <p className="settings-overlay__status">
              {googleConnected ? 'Google Calendar connected' : 'Google Calendar not connected'}
            </p>
            {googleState === 'error' ? (
              <p className="settings-overlay__error">Could not start Google Calendar connect.</p>
            ) : null}

            {googleConnected ? (
              <div className="settings-overlay__calendars">
                <div className="settings-overlay__calendar-header">
                  <span>Calendars Used for Scheduling</span>
                  <button
                    type="button"
                    className="settings-overlay__text-button"
                    onClick={() => void handleRefreshCalendars()}
                    disabled={calendarsState === 'saving'}
                  >
                    {calendarsState === 'saving' ? 'Loading' : 'Refresh'}
                  </button>
                </div>

                {calendars.length === 0 && calendarsState !== 'saving' ? (
                  <p className="settings-overlay__status">No calendars loaded yet.</p>
                ) : null}

                {calendars.map((calendar) => (
                  <label key={calendar.id} className="settings-overlay__calendar-option">
                    <input
                      type="checkbox"
                      checked={includedGoogleCalendarIds.includes(calendar.id)}
                      onChange={() => toggleCalendar(calendar.id)}
                    />
                    <span
                      className="settings-overlay__calendar-swatch"
                      style={{ background: calendar.backgroundColor ?? '#FFD98A' }}
                      aria-hidden="true"
                    />
                    <span className="settings-overlay__calendar-name">
                      {calendar.summary}
                      {calendar.primary ? ' (Primary)' : ''}
                    </span>
                  </label>
                ))}

                {calendarsState === 'error' ? (
                  <p className="settings-overlay__error">Could not load Google calendars.</p>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="settings-overlay__section">
            <h2>Workday</h2>
            <div className="settings-overlay__time-row">
              <label>
                <span>Start</span>
                <input
                  type="time"
                  value={workStart}
                  onChange={(e) => setWorkStart(e.target.value)}
                />
              </label>
              <label>
                <span>End</span>
                <input type="time" value={workEnd} onChange={(e) => setWorkEnd(e.target.value)} />
              </label>
            </div>
          </section>

          <section className="settings-overlay__section">
            <h2>Scheduling Preferences</h2>
            <textarea
              value={schedulingPreferences}
              onChange={(e) => setSchedulingPreferences(e.target.value)}
              placeholder="I prefer coding in the morning and meetings in the afternoon."
            />
          </section>

          <button
            type="submit"
            className="settings-overlay__button"
            disabled={saveState === 'saving'}
          >
            {saveState === 'saving' ? 'Saving...' : 'Save'}
          </button>
          {saveState === 'saved' ? <p className="settings-overlay__status">Saved</p> : null}
          {saveState === 'error' ? (
            <p className="settings-overlay__error">Settings could not be saved.</p>
          ) : null}
        </form>
      </div>
    </div>
  )
}

export default SettingsOverlay
