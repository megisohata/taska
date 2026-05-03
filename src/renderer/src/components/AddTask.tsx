import { useState } from 'react'
import './AddTask.css'

type Urgency = 'low' | 'med' | 'high'

const URGENCY_OPTIONS: Array<{ value: Urgency; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'med', label: 'Med' },
  { value: 'high', label: 'High' }
]

function AddTask(): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [context, setContext] = useState('')
  const [urgency, setUrgency] = useState<Urgency>('med')
  const [loading, setLoading] = useState(false)
  const activeUrgencyIndex = URGENCY_OPTIONS.findIndex((option) => option.value === urgency)
  const isSubmittable = title.trim().length > 0

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()

    if (!title.trim()) {
      return
    }

    setLoading(true)
    try {
      await window.api.addTask({
        title: title.trim(),
        context: context.trim() || undefined,
        urgency
      })
      window.dispatchEvent(new Event('tasks:changed'))
      // Reset form on success
      setTitle('')
      setContext('')
      setUrgency('med')
    } catch {
      return
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="add-task">
      <h1>Add Task</h1>

      <form className="add-task__form" onSubmit={handleSubmit}>
        <div className="add-task__field">
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Description"
            disabled={loading}
          />
        </div>

        <div className="add-task__field">
          <textarea
            id="context"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="Context (Optional)"
            rows={4}
            disabled={loading}
          />
        </div>

        <div className="add-task__field add-task__urgency-row">
          <h2>Urgency</h2>
          <div className="urgency-selector" role="radiogroup">
            <div
              className="urgency-selector__indicator"
              style={{ transform: `translateX(${activeUrgencyIndex * 100}%)` }}
            />
            {URGENCY_OPTIONS.map((option) => {
              const isActive = urgency === option.value

              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  className="urgency-selector__btn"
                  onClick={() => setUrgency(option.value)}
                  disabled={loading}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className={
            isSubmittable ? 'add-task__submit add-task__submit--ready' : 'add-task__submit'
          }
        >
          {loading ? 'Adding...' : 'Add'}
        </button>
      </form>
    </section>
  )
}

export default AddTask
