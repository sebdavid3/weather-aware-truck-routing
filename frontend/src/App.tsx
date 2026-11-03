import { useCallback, useEffect, useState } from 'react'
import { Landing } from './landing/Landing'
import { Planner } from './planner/Planner'
import type { TripDraft } from './trip/draft'

const PLANNER_PATH = '/plan'

/** Two screens: the landing at "/" and the planner at "/plan", switched without a page load. */
function App() {
  const [path, setPath] = useState(() => window.location.pathname)
  // A trip filled in on the landing; the planner runs it as soon as it opens.
  const [handoff, setHandoff] = useState<TripDraft | null>(null)

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const go = useCallback((to: string) => {
    window.history.pushState(null, '', to)
    setPath(to)
    window.scrollTo(0, 0)
  }, [])

  useEffect(() => {
    document.title =
      path === PLANNER_PATH ? 'Plan a trip · Haulcast' : 'Haulcast · Weigh your route against the weather'
  }, [path])

  if (path === PLANNER_PATH) {
    return <Planner initialDraft={handoff} onHome={() => go('/')} />
  }
  return (
    <Landing
      onPlan={(draft) => {
        setHandoff(draft)
        go(PLANNER_PATH)
      }}
      onOpenPlanner={() => {
        setHandoff(null)
        go(PLANNER_PATH)
      }}
    />
  )
}

export default App
