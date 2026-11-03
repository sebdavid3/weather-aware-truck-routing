import PauseIcon from '@mui/icons-material/Pause'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Slider from '@mui/material/Slider'
import Stack from '@mui/material/Stack'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { useEffect, useRef } from 'react'
import { color, font } from '../brand'
import { formatClock, formatTime } from '../format'
import { LEVEL_COLOR, LEVEL_LABEL, LEVELS } from '../risk'
import type { Progress } from '../trip/progress'

const STEP = 0.25
const PLAYBACK_SECONDS = 16 // Any range plays through in the same time.

export type SliderRange = 'trip' | 'forecast'

type Props = {
  departure: string
  timeZone: string
  /** Hours of corridor forecast available after departure (48). */
  forecastHours: number
  /** Hours until the last route arrives; the "trip" range ends there. */
  tripHours: number
  range: SliderRange
  onRange: (range: SliderRange) => void
  arrivals: { name: string; hour: number }[]
  selected: string
  progress: Progress | null
  distanceMiles: number
  hour: number
  onHour: (hour: number) => void
  playing: boolean
  onPlaying: (playing: boolean) => void
  status: 'loading' | 'ready' | 'error'
  error?: string
}

export function ForecastSlider({
  departure,
  timeZone,
  forecastHours,
  tripHours,
  range,
  onRange,
  arrivals,
  selected,
  progress,
  distanceMiles,
  hour,
  onHour,
  playing,
  onPlaying,
  status,
  error,
}: Props) {
  const max = range === 'trip' ? Math.min(forecastHours, Math.ceil(tripHours / STEP) * STEP) : forecastHours
  const hourRef = useRef(hour)
  useEffect(() => {
    hourRef.current = hour
  })

  useEffect(() => {
    if (!playing) return
    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      const next = hourRef.current + ((now - last) / 1000) * (max / PLAYBACK_SECONDS)
      last = now
      if (next >= max) {
        onHour(max)
        onPlaying(false)
        return
      }
      onHour(next)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, max, onHour, onPlaying])

  const at = Date.parse(departure) + hour * 3_600_000
  const step = max <= 12 ? 2 : max <= 30 ? 4 : 6
  const marks = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => ({
    value: i * step,
    label: `${i * step}h`,
  }))

  return (
    <Paper
      elevation={0}
      sx={{
        position: 'absolute',
        left: 16,
        right: 16,
        bottom: 28,
        mx: 'auto',
        maxWidth: 760,
        px: 2,
        py: 1.25,
        // The scale house's readout: asphalt panel, signal-yellow figures.
        bgcolor: color.asphalt,
        color: color.paper,
        borderTop: `4px solid ${color.signal}`,
        boxShadow: '0 12px 28px -10px rgba(29,31,33,.6)',
      }}
    >
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
        <IconButton
          aria-label={playing ? 'Pause forecast' : 'Play forecast'}
          onClick={() => {
            if (playing) {
              // Stop on a slider step, so the label, the thumb and the map show the same hour.
              onHour(Math.round(hour / STEP) * STEP)
            } else if (hour >= max) {
              onHour(0)
            }
            onPlaying(!playing)
          }}
          sx={{ color: color.signal, mt: 0.25 }}
        >
          {playing ? <PauseIcon /> : <PlayArrowIcon />}
        </IconButton>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Stack
            direction="row"
            spacing={1.5}
            sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 0.75 }}
          >
            <Typography
              sx={{
                fontFamily: font.ticket,
                fontWeight: 700,
                fontSize: '0.95rem',
                color: color.signal,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              +{formatHours(hour)} · {formatTime(new Date(at).toISOString(), timeZone)}
            </Typography>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={range}
              onChange={(_, value: SliderRange | null) => {
                if (!value) return
                onPlaying(false)
                onRange(value)
              }}
              aria-label="Slider range"
              sx={{
                '& .MuiToggleButton-root': {
                  color: color.paperShade,
                  borderColor: color.asphaltSoft,
                  fontSize: '0.7rem',
                  py: 0.25,
                  px: 1,
                  '&.Mui-selected, &.Mui-selected:hover': { bgcolor: color.signal, color: color.asphalt },
                },
              }}
            >
              <ToggleButton value="trip">Trip · {formatHours(tripHours)}</ToggleButton>
              <ToggleButton value="forecast">48 h forecast</ToggleButton>
            </ToggleButtonGroup>
          </Stack>
          <Typography sx={{ fontFamily: font.ticket, fontSize: '0.74rem', color: color.paperShade, mt: 0.5 }}>
            {describe(selected, progress, distanceMiles, timeZone)}
          </Typography>
          <Box sx={{ position: 'relative', mt: 2.5 }}>
            {/* Each route's arrival, flagged on the track so the hours read as the trip. Flags
                that would overlap step to the left instead of covering each other. */}
            {placeFlags(
              arrivals.filter((arrival) => arrival.hour <= max),
              max,
            ).map(({ name, hour: at, left }) => (
              <Box
                key={name}
                title={`Route ${name} arrives at +${formatHours(at)}`}
                sx={{
                  position: 'absolute',
                  top: -20,
                  left: `${left}%`,
                  transform: 'translateX(-50%)',
                  minWidth: 16,
                  textAlign: 'center',
                  fontFamily: font.ticket,
                  fontSize: '0.64rem',
                  fontWeight: 700,
                  lineHeight: 1,
                  py: 0.25,
                  color: name === selected ? color.asphalt : color.paperShade,
                  bgcolor: name === selected ? color.signal : color.asphaltSoft,
                  pointerEvents: 'none',
                  '&::after': {
                    content: '""',
                    position: 'absolute',
                    left: '50%',
                    bottom: -4,
                    transform: 'translateX(-50%)',
                    borderInline: '4px solid transparent',
                    borderTop: `4px solid ${name === selected ? color.signal : color.asphaltSoft}`,
                  },
                }}
              >
                {name}
              </Box>
            ))}
            <Slider
              size="small"
              min={0}
              max={max}
              step={STEP}
              value={Math.min(hour, max)}
              onChange={(_, value) => {
                onPlaying(false)
                onHour(value as number)
              }}
              marks={marks}
              aria-label="Hours after departure"
              getAriaValueText={(value) => `${formatHours(value)} after departure`}
              sx={{
                mb: -0.5,
                color: color.signal,
                '& .MuiSlider-rail': { bgcolor: color.paperShade, opacity: 0.35 },
                '& .MuiSlider-mark': { bgcolor: color.paperShade },
                '& .MuiSlider-markLabel': {
                  fontFamily: font.ticket,
                  fontSize: '0.66rem',
                  color: color.paperShade,
                },
                '& .MuiSlider-thumb': { boxShadow: `0 0 0 3px ${color.asphalt}` },
                // MUI eases the thumb and track over 150 ms. Playback moves them every frame, which
                // restarts that easing before it gets anywhere, so the thumb froze near its start.
                '& .MuiSlider-thumb, & .MuiSlider-track': { transition: 'none' },
              }}
            />
          </Box>
        </Box>
      </Stack>
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ justifyContent: 'center', alignItems: 'center', mt: 1.25, flexWrap: 'wrap' }}
      >
        {LEVELS.map((level) => (
          <Stack key={level} direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: LEVEL_COLOR[level] }} />
            <Typography variant="caption" sx={{ fontFamily: font.ticket, color: color.paperShade }}>
              {LEVEL_LABEL[level]}
            </Typography>
          </Stack>
        ))}
        {status !== 'ready' && (
          <Typography
            variant="caption"
            sx={{ fontFamily: font.ticket, color: status === 'error' ? '#ffb4ad' : color.paperShade }}
          >
            {status === 'loading' ? (
              <>
                <CircularProgress size={10} sx={{ mr: 0.75, color: color.signal }} />
                Loading corridor forecast…
              </>
            ) : (
              (error ?? 'Corridor forecast unavailable')
            )}
          </Typography>
        )}
      </Stack>
    </Paper>
  )
}

/** Arrival flags in track percent, nudged left so neighbors at least 3.2% apart stay readable. */
function placeFlags(arrivals: { name: string; hour: number }[], max: number) {
  const sorted = [...arrivals].sort((a, b) => b.hour - a.hour)
  let previous = Infinity
  return sorted.map((arrival) => {
    const left = Math.min((arrival.hour / max) * 100, previous - 3.2)
    previous = left
    return { ...arrival, left }
  })
}

function formatHours(hours: number): string {
  const whole = Math.floor(hours + 1e-9)
  const minutes = Math.round((hours - whole) * 60)
  if (minutes === 60) return `${whole + 1} h`
  return minutes ? `${whole} h ${minutes} min` : `${whole} h`
}

function describe(selected: string, progress: Progress | null, distance: number, timeZone: string): string {
  if (!progress) return ''
  const where = `mile ${Math.round(progress.mile).toLocaleString('en-US')} of ${distance.toLocaleString('en-US')}`
  const until = progress.until ? formatClock(new Date(progress.until).toISOString(), timeZone) : ''
  switch (progress.state) {
    case 'arrived':
      return `Route ${selected} arrived at ${until}. Later hours show the corridor forecast only.`
    case 'rest':
      return `Route ${selected} · ${where} · 10 h rest until ${until}`
    case 'break':
      return `Route ${selected} · ${where} · 30 min break until ${until}`
    default:
      return `Route ${selected} · ${where} · driving`
  }
}
