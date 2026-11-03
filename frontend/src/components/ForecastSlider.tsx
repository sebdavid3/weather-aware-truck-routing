import PauseIcon from '@mui/icons-material/Pause'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Slider from '@mui/material/Slider'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useEffect, useRef } from 'react'
import { formatTime } from '../format'
import { LEVEL_COLOR, LEVEL_LABEL, LEVELS } from '../risk'

const HOURS_PER_SECOND = 3 // Playback speed: the 48 hours take 16 seconds.
const STEP = 0.25

type Props = {
  departure: string
  timeZone: string
  hours: number
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
  hours,
  hour,
  onHour,
  playing,
  onPlaying,
  status,
  error,
}: Props) {
  const hourRef = useRef(hour)
  useEffect(() => {
    hourRef.current = hour
  })

  useEffect(() => {
    if (!playing) return
    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      const next = hourRef.current + ((now - last) / 1000) * HOURS_PER_SECOND
      last = now
      if (next >= hours) {
        onHour(hours)
        onPlaying(false)
        return
      }
      onHour(next)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, hours, onHour, onPlaying])

  const at = new Date(Date.parse(departure) + hour * 3_600_000).toISOString()

  return (
    <Paper
      elevation={3}
      sx={{
        position: 'absolute',
        left: 16,
        right: 16,
        bottom: 28,
        mx: 'auto',
        maxWidth: 720,
        px: 2,
        py: 1.25,
      }}
    >
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
        <IconButton
          aria-label={playing ? 'Pause forecast' : 'Play forecast'}
          onClick={() => {
            if (playing) {
              // Stop on a slider step, so the label, the thumb and the map show the same hour.
              onHour(Math.round(hour / STEP) * STEP)
            } else if (hour >= hours) {
              onHour(0)
            }
            onPlaying(!playing)
          }}
          disabled={status !== 'ready'}
          color="primary"
        >
          {playing ? <PauseIcon /> : <PlayArrowIcon />}
        </IconButton>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Stack direction="row" sx={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
            <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              +{Math.floor(hour)} h · {formatTime(at, timeZone)}
            </Typography>
            <Typography variant="caption" color={status === 'error' ? 'error' : 'text.secondary'}>
              {status === 'loading' && (
                <>
                  <CircularProgress size={10} sx={{ mr: 0.75 }} />
                  Loading corridor forecast…
                </>
              )}
              {status === 'error' && (error ?? 'Corridor forecast unavailable')}
              {status === 'ready' && 'Corridor risk after departure'}
            </Typography>
          </Stack>
          <Slider
            size="small"
            min={0}
            max={hours}
            step={STEP}
            value={hour}
            onChange={(_, value) => {
              onPlaying(false)
              onHour(value as number)
            }}
            marks={Array.from({ length: hours / 6 + 1 }, (_, i) => ({ value: i * 6, label: `${i * 6}h` }))}
            aria-label="Hours after departure"
            sx={{
              mt: 0.5,
              mb: -0.5,
              '& .MuiSlider-markLabel': { fontSize: '0.68rem' },
              // MUI eases the thumb and track over 150 ms. Playback moves them every frame, which
              // restarts that easing before it gets anywhere, so the thumb froze near its start.
              '& .MuiSlider-thumb, & .MuiSlider-track': { transition: 'none' },
            }}
          />
        </Box>
      </Stack>
      <Stack direction="row" spacing={1.5} sx={{ justifyContent: 'center', mt: 1.5, flexWrap: 'wrap' }}>
        {LEVELS.map((level) => (
          <Stack key={level} direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: LEVEL_COLOR[level] }} />
            <Typography variant="caption">{LEVEL_LABEL[level]}</Typography>
          </Stack>
        ))}
      </Stack>
    </Paper>
  )
}
