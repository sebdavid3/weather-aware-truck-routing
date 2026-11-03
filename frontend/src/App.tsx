import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import LinearProgress from '@mui/material/LinearProgress'
import Paper from '@mui/material/Paper'
import Skeleton from '@mui/material/Skeleton'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { memo, useCallback, useRef, useState } from 'react'
import { fetchHeatmap, planTrip, type Heatmap, type LonLat, type TripInput, type TripPlan } from './api'
import { CheckpointList } from './components/CheckpointList'
import { ForecastSlider } from './components/ForecastSlider'
import { RouteCard } from './components/RouteCard'
import { TripForm } from './components/TripForm'
import { TripMap } from './map/TripMap'

type HeatState = { status: 'loading' | 'ready' | 'error'; data: Heatmap | null; error?: string }

function App() {
  const [plan, setPlan] = useState<TripPlan | null>(null)
  const [planning, setPlanning] = useState(false)
  const [error, setError] = useState<string>()
  const [selected, setSelected] = useState('A')
  const [heat, setHeat] = useState<HeatState>({ status: 'loading', data: null })
  const [hour, setHour] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [focus, setFocus] = useState<{ position: LonLat; key: number } | null>(null)
  const requestRef = useRef<AbortController | null>(null)

  const submit = useCallback(async (trip: TripInput) => {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setPlanning(true)
    setError(undefined)
    setPlaying(false)
    try {
      const result = await planTrip(trip, controller.signal)
      setPlan(result)
      setSelected(result.recommended)
      setHour(0)
      // The heatmap reuses the routes the server just cached, so it comes right after.
      setHeat({ status: 'loading', data: null })
      fetchHeatmap(trip, controller.signal)
        .then((data) => setHeat({ status: 'ready', data }))
        .catch((reason: Error) => {
          if (!controller.signal.aborted) setHeat({ status: 'error', data: null, error: reason.message })
        })
    } catch (reason) {
      if (!controller.signal.aborted) setError((reason as Error).message)
    } finally {
      if (!controller.signal.aborted) setPlanning(false)
    }
  }, [])

  const focusOn = useCallback((position: LonLat) => setFocus({ position, key: Date.now() }), [])

  return (
    <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, height: '100%' }}>
      <SidePanel
        plan={plan}
        planning={planning}
        error={error}
        selected={selected}
        onSubmit={submit}
        onSelect={setSelected}
        onFocus={focusOn}
      />
      <Box sx={{ position: 'relative', flexGrow: 1, minHeight: { xs: '60vh', md: 0 } }}>
        <TripMap
          plan={plan}
          heatmap={heat.data}
          hour={hour}
          selectedRoute={selected}
          focus={focus}
          onSelectRoute={setSelected}
        />
        {!plan && !planning && (
          <Paper elevation={2} sx={{ position: 'absolute', top: 16, left: 16, maxWidth: 320, p: 2 }}>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              Plan a trip to compare routes
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Routes appear colored by weather risk at the time the truck reaches each stretch, with a 48-hour
              corridor forecast below.
            </Typography>
          </Paper>
        )}
        {plan && (
          <ForecastSlider
            departure={plan.departure}
            timeZone={plan.timezone}
            hours={heat.data?.hours ?? 48}
            hour={hour}
            onHour={setHour}
            playing={playing}
            onPlaying={setPlaying}
            status={heat.status}
            error={heat.error}
          />
        )}
      </Box>
    </Box>
  )
}

type PanelProps = {
  plan: TripPlan | null
  planning: boolean
  error?: string
  selected: string
  onSubmit: (trip: TripInput) => void
  onSelect: (name: string) => void
  onFocus: (position: LonLat) => void
}

// Memoized so forecast playback, which updates the hour every frame, doesn't re-render the panel.
const SidePanel = memo(function SidePanel({
  plan,
  planning,
  error,
  selected,
  onSubmit,
  onSelect,
  onFocus,
}: PanelProps) {
  const route = plan?.routes.find((r) => r.name === selected)
  return (
    <Box
      component="aside"
      sx={{
        width: { xs: '100%', md: 420 },
        flexShrink: 0,
        height: { md: '100%' },
        overflowY: 'auto',
        bgcolor: 'background.paper',
        borderRight: { md: 1 },
        borderColor: { md: 'divider' },
        position: 'relative',
      }}
    >
      {planning && <LinearProgress sx={{ position: 'sticky', top: 0, zIndex: 1 }} />}
      <Stack spacing={2.5} sx={{ p: 2.5 }}>
        <Box>
          <Typography variant="h1">Weather-aware truck routing</Typography>
          <Typography variant="body2" color="text.secondary">
            Compares three routes by the forecast at each checkpoint when the truck gets there.
          </Typography>
        </Box>
        <TripForm busy={planning} onSubmit={onSubmit} />
        {error && <Alert severity="error">{error}</Alert>}
        {planning && !plan && <ResultsSkeleton />}
        {plan && (
          <>
            <Divider />
            <Recommendation plan={plan} />
            <Stack spacing={1}>
              <Typography variant="h2" color="text.secondary">
                Routes
              </Typography>
              {plan.routes.map((r) => (
                <RouteCard
                  key={r.name}
                  route={r}
                  recommended={r.name === plan.recommended}
                  selected={r.name === selected}
                  restBreaks={plan.rest_breaks}
                  timeZone={plan.timezone}
                  onSelect={() => onSelect(r.name)}
                />
              ))}
            </Stack>
            {route && (
              <Stack spacing={0.5}>
                <Typography variant="h2" color="text.secondary">
                  Route {route.name} checkpoints · every {plan.interval_miles} mi
                </Typography>
                <CheckpointList route={route} timeZone={plan.timezone} onFocus={onFocus} />
              </Stack>
            )}
          </>
        )}
      </Stack>
    </Box>
  )
})

function Recommendation({ plan }: { plan: TripPlan }) {
  return (
    <Stack spacing={1}>
      {plan.warning && <Alert severity="warning">{plan.warning}</Alert>}
      <Alert severity={plan.warning ? 'info' : 'success'} icon={false}>
        <Typography variant="body2" sx={{ fontWeight: 700, mb: plan.reasons.length ? 0.5 : 0 }}>
          Route {plan.recommended} is recommended
        </Typography>
        {plan.reasons.length > 0 ? (
          <Box component="ul" sx={{ m: 0, pl: 2.25 }}>
            {plan.reasons.map((reason) => (
              <Typography component="li" variant="body2" key={reason}>
                {reason}
              </Typography>
            ))}
          </Box>
        ) : (
          <Typography variant="body2">It's the only route the router found.</Typography>
        )}
      </Alert>
    </Stack>
  )
}

function ResultsSkeleton() {
  return (
    <Stack spacing={1}>
      <Typography variant="body2" color="text.secondary">
        Finding truck routes and sampling the forecast at each checkpoint…
      </Typography>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} variant="rounded" height={92} />
      ))}
    </Stack>
  )
}

export default App
