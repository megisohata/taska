import { useState } from 'react'
import BottomNav, { type ActiveView } from './components/BottomNav'
import Calendar from './components/Calendar'
import AddTask from './components/AddTask'
import List from './components/List'
import TopBar from './components/TopBar'

function App(): React.JSX.Element {
  const [activeView, setActiveView] = useState<ActiveView>('addTask')

  const renderView = (): React.JSX.Element => {
    if (activeView === 'calendar') return <Calendar />
    if (activeView === 'addTask') return <AddTask />
    return <List />
  }

  return (
    <main className="app-main">
      <TopBar showProgress={activeView !== 'list'} />
      {renderView()}
      <BottomNav activeView={activeView} onChangeView={setActiveView} />
    </main>
  )
}

export default App
