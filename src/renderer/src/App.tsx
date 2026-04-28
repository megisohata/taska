import { useState } from 'react'

type ActiveView = 'calendar' | 'addTask' | 'list'

function App(): React.JSX.Element {
  const [activeView, setActiveView] = useState<ActiveView>('addTask')

  const renderView = (): React.JSX.Element => {
    if (activeView === 'calendar') {
      return <section>Calendar View</section>
    }

    if (activeView === 'addTask') {
      return <section>Add Task View</section>
    }

    return <section>List View</section>
  }

  return (
    <main className="app-main">
      <nav>
        <button type="button" onClick={() => setActiveView('calendar')}>
          Calendar
        </button>
        <button type="button" onClick={() => setActiveView('addTask')}>
          Add Task
        </button>
        <button type="button" onClick={() => setActiveView('list')}>
          List
        </button>
      </nav>

      {renderView()}
    </main>
  )
}

export default App
