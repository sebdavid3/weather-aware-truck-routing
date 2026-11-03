import Box from '@mui/material/Box'
import LinearProgress from '@mui/material/LinearProgress'
import Typography from '@mui/material/Typography'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchHeatmap,
  planTrip,
  previewTrip,
  type Heatmap,
  type LonLat,
  type TripPlan,
  type TripPreview,
} from '../api'
import { color, display, font } from '../brand'
import { CheckpointList } from '../components/CheckpointList'
import { ForecastSlider, type SliderRange } from '../components/ForecastSlider'
import { LayerToggles, type MapLayers } from '../components/LayerToggles'
import { RouteCard } from '../components/RouteCard'
import { TripMap } from '../map/TripMap'
import { Weighing } from './Weighing'
import { Stamp, TearRule, Ticket, Wordmark } from '../ticket/Ticket'
import { TicketForm } from '../ticket/TicketForm'
import { formatDuration } from '../format'
import { initialDraft, toTripInput, type TripDraft } from '../trip/draft'
import { arrivalHour, progressAt } from '../trip/progress'

type HeatState = { status: 'loading' | 'ready' | 'error'; data: Heatmap | null; error?: string }

type Props = {
  /** A trip filled in on the landing, planned as soon as the planner opens. */
  initialDraft: TripDraft | null
  onHome: () => void
}

export function Planner({ initialDraft: handoff, onHome }: Props) {
  const [draft, setDraft] = useState<TripDraft>(() => handoff ?? initialDraft())
  const [plan, setPlan] = useState<TripPlan | null>(null)
  const [planning, setPlanning] = useState(false)
  const [error, setError] = useState<string>()
  const [selected, setSelected] = useState('A')
  const [heat, setHeat] = useState<HeatState>({ status: 'loading', data: null })
  const [hour, setHour] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [focus, setFocus] = useState<{ position: LonLat; key: number } | null>(null)
  const [range, setRange] = useState<SliderRange>('trip')
  const [places, setPlaces] = useState<{ origin: string; destination: string } | null>(null)
  const [preview, setPreview] = useState<(TripPreview & { startedAt: number }) | null>(null)
  const [layers, setLayers] = useState<MapLayers>({ heatmap: true, checkpoints: true, otherRoutes: true })
  const requestRef = useRef<AbortController | null>(null)
  const draftRef = useRef(draft)
  useEffect(() => {
    draftRef.current = draft
  })

  const submit = useCallback(async () => {
    const trip = toTripInput(draftRef.current)
    const labels = {
      origin: draftRef.current.origin!.label,
      destination: draftRef.current.destination!.label,
    }
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setPlanning(true)
    setError(undefined)
    setPlaying(false)
    setPlan(null)
    setPreview(null)
    try {
      // Routes first, in a few seconds; the forecast for every checkpoint follows.
      const routes = await previewTrip(trip, controller.signal)
      setPreview({ ...routes, startedAt: Date.now() })
      setPlaces(labels)
      const result = await planTrip(trip, controller.signal)
      setPlan(result)
      setPreview(null)
      setSelected(result.recommended)
      setHour(0)
      setRange('trip')
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

  // A trip handed over from the landing is planned once, on arrival.
  const handedOff = useRef(false)
  useEffect(() => {
    if (handoff && !handedOff.current) {
      handedOff.current = true
      void submit()
    }
  }, [handoff, submit])

  const focusOn = useCallback((position: LonLat) => setFocus({ position, key: Date.now() }), [])

  // How many of the selected route's checkpoints the truck has passed at the slider hour. It
  // changes only when the truck crosses a checkpoint, so playback seldom re-renders the panel.
  const passed = useMemo(() => {
    const route = plan?.routes.find((r) => r.name === selected)
    if (!plan || !route) return 0
    const at = Date.parse(plan.departure) + hour * 3_600_000
    return route.checkpoints.filter((checkpoint) => Date.parse(checkpoint.eta) <= at).length
  }, [plan, selected, hour])

  // The slider reads as the trip: each route's arrival hour, and where the selected truck is.
  const arrivals = useMemo(
    () => plan?.routes.map((r) => ({ name: r.name, hour: arrivalHour(r, plan.departure) })) ?? [],
    [plan],
  )
  const tripHours = arrivals.length ? Math.max(...arrivals.map((arrival) => arrival.hour)) : 48
  const selectedRoute = plan?.routes.find((r) => r.name === selected)
  const progress =
    plan && selectedRoute ? progressAt(selectedRoute, Date.parse(plan.departure) + hour * 3_600_000) : null

  return (
    <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, height: '100%' }}>
      <SidePanel
        draft={draft}
        onDraft={setDraft}
        plan={plan}
        preview={preview}
        planning={planning}
        error={error}
        selected={selected}
        passed={passed}
        onSubmit={submit}
        onSelect={setSelected}
        onFocus={focusOn}
        onHome={onHome}
      />
      <Box sx={{ position: 'relative', flexGrow: 1, minHeight: { xs: '70vh', md: 0 } }}>
        <TripMap
          plan={plan}
          heatmap={heat.data}
          hour={hour}
          selectedRoute={selected}
          focus={focus}
          onSelectRoute={setSelected}
          places={places}
          layers={layers}
          preview={preview}
        />
        {preview && !plan && <Weighing preview={preview} />}
        {plan && <LayerToggles layers={layers} onChange={setLayers} />}
        {!plan && !planning && !preview && (
          <Box sx={{ position: 'absolute', top: 16, left: 16, maxWidth: 340 }}>
            <Ticket sx={{ pt: 2.5, pb: 2 }}>
              <Typography sx={{ ...display, fontSize: '1.2rem' }}>Fill the ticket to weigh routes</Typography>
              <Typography sx={{ fontFamily: font.ticket, fontSize: '0.8rem', mt: 1, color: color.inkSoft }}>
                Routes appear colored by the weather at the hour the truck reaches each stretch, with the
                corridor forecast for the 48 hours after you leave.
              </Typography>
            </Ticket>
          </Box>
        )}
        {plan && (
          <ForecastSlider
            departure={plan.departure}
            timeZone={plan.timezone}
            forecastHours={heat.data?.hours ?? 48}
            tripHours={tripHours}
            range={range}
            onRange={(next) => {
              setRange(next)
              if (next === 'trip') setHour((current) => Math.min(current, tripHours))
            }}
            arrivals={arrivals}
            selected={selected}
            progress={progress}
            distanceMiles={selectedRoute?.distance_miles ?? 0}
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
  draft: TripDraft
  onDraft: (draft: TripDraft) => void
  plan: TripPlan | null
  preview: TripPreview | null
  planning: boolean
  error?: string
  selected: string
  passed: number
  onSubmit: () => void
  onSelect: (name: string) => void
  onFocus: (position: LonLat) => void
  onHome: () => void
}

// Memoized so forecast playback, which updates the hour every frame, doesn't re-render the panel.
const SidePanel = memo(function SidePanel({
  draft,
  onDraft,
  plan,
  preview,
  planning,
  error,
  selected,
  passed,
  onSubmit,
  onSelect,
  onFocus,
  onHome,
}: PanelProps) {
  const route = plan?.routes.find((r) => r.name === selected)
  return (
    <Box
      component="aside"
      sx={{
        width: { xs: '100%', md: 460 },
        flexShrink: 0,
        height: { md: '100%' },
        overflowY: 'auto',
        bgcolor: color.ground,
        position: 'relative',
        boxShadow: { md: '6px 0 18px -10px rgba(29,31,33,.45)' },
        zIndex: 1,
      }}
    >
      <Box
        component="header"
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 2,
          bgcolor: color.asphalt,
          borderBottom: `4px solid ${color.signal}`,
          px: 2.5,
          py: 1.5,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
        }}
      >
        <Box
          component="a"
          href="/"
          onClick={(event: React.MouseEvent) => {
            event.preventDefault()
            onHome()
          }}
          aria-label="Haulcast home"
          sx={{ textDecoration: 'none' }}
        >
          <Wordmark size={24} />
        </Box>
      </Box>
      {planning && (
        <LinearProgress
          sx={{
            position: 'sticky',
            top: 52,
            zIndex: 2,
            bgcolor: color.groundDeep,
            '& .MuiLinearProgress-bar': { bgcolor: color.asphalt },
          }}
        />
      )}
      <Box sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        <Ticket>
          <Typography component="h1" sx={{ ...display, fontSize: '1.5rem', mb: 1.75 }}>
            Trip ticket
          </Typography>
          <TicketForm draft={draft} onChange={onDraft} onSubmit={onSubmit} busy={planning} stacked />
          {error && (
            <Box
              role="alert"
              sx={{
                mt: 2,
                border: `2px solid ${color.stamp}`,
                color: color.stamp,
                p: 1.5,
                fontFamily: font.ticket,
                fontSize: '0.84rem',
              }}
            >
              {error}
            </Box>
          )}
        </Ticket>
        {planning && !plan && !preview && <Printing />}
        {preview && !plan && <PreviewRoutes preview={preview} />}
        {plan && (
          <>
            <Verdict plan={plan} />
            <Box
              component="section"
              aria-label="Routes"
              sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
            >
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
            </Box>
            {route && (
              <Ticket>
                <Typography component="h2" sx={{ ...display, fontSize: '1.25rem' }}>
                  Route {route.name} checkpoints
                </Typography>
                <Typography
                  sx={{ fontFamily: font.ticket, fontSize: '0.74rem', color: color.inkSoft, mt: 0.75 }}
                >
                  Every {plan.interval_miles} mi. The dark line is where the truck is at the forecast slider's
                  hour.
                </Typography>
                <TearRule />
                <CheckpointList route={route} timeZone={plan.timezone} passed={passed} onFocus={onFocus} />
              </Ticket>
            )}
          </>
        )}
      </Box>
    </Box>
  )
})

/** The routes as soon as they are known, while their checkpoints are still being weighed. */
function PreviewRoutes({ preview }: { preview: TripPreview }) {
  return (
    <Ticket>
      <Typography component="h2" sx={{ ...display, fontSize: '1.25rem' }}>
        Routes found
      </Typography>
      <Typography sx={{ fontFamily: font.ticket, fontSize: '0.74rem', color: color.inkSoft, mt: 0.75 }}>
        Weighing {preview.checkpoints.toLocaleString('en-US')} checkpoints against the forecast…
      </Typography>
      <Box
        component="ul"
        sx={{ listStyle: 'none', m: 0, mt: 1.5, p: 0, fontFamily: font.ticket, fontSize: '0.86rem' }}
      >
        {preview.routes.map((route) => (
          <Box
            component="li"
            key={route.name}
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              py: 0.75,
              borderTop: `1px dashed ${color.rule}`,
            }}
          >
            <span>Route {route.name}</span>
            <span>
              {route.distance_miles.toLocaleString('en-US')} mi · {formatDuration(route.drive_minutes)}{' '}
              driving
            </span>
          </Box>
        ))}
      </Box>
    </Ticket>
  )
}

function Verdict({ plan }: { plan: TripPlan }) {
  return (
    <Ticket>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
        <Typography component="h2" sx={{ ...display, fontSize: '1.25rem' }}>
          Verdict
        </Typography>
        <Stamp sx={{ fontSize: '1.2rem' }}>Route {plan.recommended} · recommended</Stamp>
      </Box>
      {plan.warning && (
        <Box
          role="alert"
          sx={{
            mt: 2,
            border: `2px solid ${color.stamp}`,
            color: color.stamp,
            p: 1.25,
            fontFamily: font.ticket,
            fontSize: '0.82rem',
            fontWeight: 600,
          }}
        >
          {plan.warning}
        </Box>
      )}
      <Box
        component="ul"
        sx={{
          listStyle: 'none',
          m: 0,
          mt: 1.75,
          p: 0,
          fontFamily: font.ticket,
          fontSize: '0.84rem',
          lineHeight: 1.45,
        }}
      >
        {plan.reasons.length > 0 ? (
          plan.reasons.map((reason) => (
            <Box component="li" key={reason} sx={{ py: 0.75, borderTop: `1px dashed ${color.rule}` }}>
              {reason}
            </Box>
          ))
        ) : (
          <Box component="li" sx={{ py: 0.75, borderTop: `1px dashed ${color.rule}` }}>
            It's the only truck route for this trip.
          </Box>
        )}
      </Box>
      {plan.routes.length === 2 && (
        <Typography sx={{ fontFamily: font.ticket, fontSize: '0.74rem', color: color.inkSoft, mt: 1 }}>
          Only two distinct truck routes exist for this trip.
        </Typography>
      )}
    </Ticket>
  )
}

const feed = {
  '@keyframes ticketFeed': {
    '0%': { transform: 'translateY(-12px)', opacity: 0.4 },
    '100%': { transform: 'translateY(0)', opacity: 1 },
  },
}

/** Loading state: blank tickets feeding out of the printer while the server works. */
function Printing() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, ...feed }}>
      <Typography sx={{ fontFamily: font.ticket, fontSize: '0.84rem', color: color.asphalt }}>
        Finding truck routes and checking the forecast at each checkpoint…
      </Typography>
      {[0, 1, 2].map((index) => (
        <Box
          key={index}
          sx={{ animation: `ticketFeed 900ms cubic-bezier(.16,1,.3,1) ${index * 180}ms infinite alternate` }}
        >
          <Ticket
            sx={{ height: 96, display: 'flex', flexDirection: 'column', gap: 1.25, justifyContent: 'center' }}
          >
            {[70, 45].map((width) => (
              <Box key={width} sx={{ height: 10, width: `${width}%`, bgcolor: color.paperShade }} />
            ))}
          </Ticket>
        </Box>
      ))}
    </Box>
  )
}
