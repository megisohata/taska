import { Calendar, Plus, ListChecks } from 'lucide-react'
import './BottomNav.css'

export type ActiveView = 'calendar' | 'addTask' | 'list'

type BottomNavProps = {
  activeView: ActiveView
  onChangeView: (view: ActiveView) => void
}

const ITEMS: Array<{ view: ActiveView; icon: React.ReactNode }> = [
  { view: 'calendar', icon: <Calendar size={20} /> },
  { view: 'addTask', icon: <Plus size={22} /> },
  { view: 'list', icon: <ListChecks size={20} /> }
]

function BottomNav({ activeView, onChangeView }: BottomNavProps): React.JSX.Element {
  const activeIndex = ITEMS.findIndex((item) => item.view === activeView)

  return (
    <nav className="bottom-nav">
      <div
        className="bottom-nav__indicator"
        style={{ transform: `translateX(${activeIndex * 100}%)` }}
      />
      {ITEMS.map((item) => (
        <button
          key={item.view}
          type="button"
          className="bottom-nav__btn"
          onClick={() => onChangeView(item.view)}
          aria-current={activeView === item.view ? 'page' : undefined}
        >
          {item.icon}
        </button>
      ))}
    </nav>
  )
}

export default BottomNav
