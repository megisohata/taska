import { useState } from 'react'
import BottomNav, { type ActiveView } from './components/BottomNav'
import Calendar from './components/Calendar'
import AddTask from './components/AddTask'
import List from './components/List'
import TopBar from './components/TopBar'
import SettingsOverlay from './components/SettingsOverlay'

function App(): React.JSX.Element {
  const [activeView, setActiveView] = useState<ActiveView>('addTask')
  const [showSettings, setShowSettings] = useState(false)

  const renderView = (): React.JSX.Element => {
    if (activeView === 'calendar') return <Calendar />
    if (activeView === 'addTask') return <AddTask />
    return <List />
  }

  return (
    <main className="app-main">
      <TopBar showProgress={activeView !== 'list'} onOpenSettings={() => setShowSettings(true)} />
      {renderView()}
      <BottomNav activeView={activeView} onChangeView={setActiveView} />
      {showSettings ? <SettingsOverlay onClose={() => setShowSettings(false)} /> : null}
    </main>
  )
}

export default App
