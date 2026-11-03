import { keyframes } from '@emotion/react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { useEffect, useState } from 'react'
import type { TripPreview } from '../api'
import { color, font } from '../brand'

const sweep = keyframes`
  from { transform: translateX(-100%); }
  to { transform: translateX(250%); }
`

type Props = { preview: TripPreview & { startedAt: number } }

/**
 * Sits where the forecast slider will appear while the checkpoints are weighed: a countdown
 * when the free weather plan makes the trip wait, a working bar when it is quick.
 */
export function Weighing({ preview }: Props) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [])

  const total = preview.wait_seconds
  const elapsed = (now - preview.startedAt) / 1000
  const long = total >= 15
  const left = Math.max(0, Math.ceil(total - elapsed))
  const share = long ? Math.min(1, elapsed / total) : 0

  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{
        position: 'absolute',
        left: 16,
        right: 16,
        bottom: 28,
        mx: 'auto',
        maxWidth: 760,
        px: 2.5,
        py: 1.75,
        bgcolor: color.asphalt,
        color: color.paper,
        borderTop: `4px solid ${color.signal}`,
        boxShadow: '0 12px 28px -10px rgba(29,31,33,.6)',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 2,
          alignItems: 'baseline',
          flexWrap: 'wrap',
        }}
      >
        <Typography
          sx={{ fontFamily: font.ticket, fontWeight: 700, color: color.signal, fontSize: '0.95rem' }}
        >
          Weighing {preview.checkpoints.toLocaleString('en-US')} checkpoints
        </Typography>
        <Typography
          sx={{
            fontFamily: font.ticket,
            fontSize: '0.84rem',
            color: color.paperShade,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {long ? (left > 0 ? `about ${left} s left` : 'finishing…') : 'a few seconds'}
        </Typography>
      </Box>
      <Box sx={{ position: 'relative', height: 6, mt: 1.25, bgcolor: color.asphaltSoft, overflow: 'hidden' }}>
        {long ? (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              width: `${share * 100}%`,
              bgcolor: color.signal,
              transition: 'width 250ms linear',
            }}
          />
        ) : (
          <Box
            sx={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              width: '40%',
              bgcolor: color.signal,
              animation: `${sweep} 1.1s ease-in-out infinite`,
            }}
          />
        )}
      </Box>
      <Typography sx={{ fontFamily: font.ticket, fontSize: '0.74rem', color: color.paperShade, mt: 1.25 }}>
        {long
          ? `The free weather plan checks about 550 points a minute, so this trip takes a little longer. The routes are already on the map.`
          : 'Checking the forecast at each checkpoint for the hour the truck gets there.'}
      </Typography>
    </Box>
  )
}
