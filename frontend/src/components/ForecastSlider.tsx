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
import { color, font } from '../brand'
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
      elevation={0}
      sx={{
        position: 'absolute',
        left: 16,
        right: 16,
        bottom: 28,
        mx: 'auto',
        maxWidth: 720,
        px: 2,
        py: 1.25,
        // The scale house's readout: asphalt panel, signal-yellow figures.
        bgcolor: color.asphalt,
        color: color.paper,
        borderTop: `4px solid ${color.signal}`,
        boxShadow: '0 12px 28px -10px rgba(29,31,33,.6)',
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
          sx={{ color: color.signal, '&.Mui-disabled': { color: color.inkFaint } }}
        >
          {playing ? <PauseIcon /> : <PlayArrowIcon />}
        </IconButton>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Stack direction="row" sx={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
            <Typography
              sx={{
                fontFamily: font.ticket,
                fontWeight: 700,
                fontSize: '0.95rem',
                color: color.signal,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              +{Math.floor(hour)} h · {formatTime(at, timeZone)}
            </Typography>
            <Typography
              variant="caption"
              sx={{ fontFamily: font.ticket, color: status === 'error' ? '#ffb4ad' : color.paperShade }}
            >
              {status === 'loading' && (
                <>
                  <CircularProgress size={10} sx={{ mr: 0.75, color: color.signal }} />
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
      </Stack>
      <Stack direction="row" spacing={1.5} sx={{ justifyContent: 'center', mt: 1.5, flexWrap: 'wrap' }}>
        {LEVELS.map((level) => (
          <Stack key={level} direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: LEVEL_COLOR[level] }} />
            <Typography variant="caption" sx={{ fontFamily: font.ticket, color: color.paperShade }}>
              {LEVEL_LABEL[level]}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Paper>
  )
}
