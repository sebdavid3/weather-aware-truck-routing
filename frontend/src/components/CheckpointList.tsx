import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import { memo } from 'react'
import type { Checkpoint, RoutePlan, Stop } from '../api'
import { color, font } from '../brand'
import { formatClock } from '../format'
import { LEVEL_COLOR, LEVEL_LABEL } from '../risk'

type Row =
  | { kind: 'checkpoint'; at: string; item: Checkpoint; index: number }
  | { kind: 'stop'; at: string; item: Stop }

type Props = {
  route: RoutePlan
  timeZone: string
  /** Checkpoints the truck has passed at the forecast slider's hour. */
  passed: number
  onFocus: (position: [number, number]) => void
}

/**
 * The selected route's ticket lines in driving order, rest stops between them. The truck's
 * current line is printed dark and the lines behind it fade, like used thermal paper.
 */
export function CheckpointList({ route, timeZone, passed, onFocus }: Props) {
  const rows: Row[] = [
    ...route.checkpoints.map((item, index): Row => ({ kind: 'checkpoint', at: item.eta, item, index })),
    ...route.stops.map((item): Row => ({ kind: 'stop', at: item.start, item })),
  ].sort((a, b) => a.at.localeCompare(b.at))

  return (
    <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0, fontFamily: font.ticket }}>
      <Box
        component="li"
        aria-hidden
        sx={{ ...gridSx, fontSize: '0.62rem', letterSpacing: '0.08em', color: color.inkSoft, pb: 0.5 }}
      >
        <span>MI</span>
        <span>ETA · WIND / GUSTS</span>
        <span>LEVEL</span>
      </Box>
      {rows.map((row, index) => {
        if (row.kind === 'stop') {
          return <StopRow key={`stop-${index}`} stop={row.item} timeZone={timeZone} onFocus={onFocus} />
        }
        return (
          <CheckpointRow
            key={`checkpoint-${index}`}
            checkpoint={row.item}
            timeZone={timeZone}
            now={row.index === passed - 1}
            behind={row.index < passed - 1}
            onFocus={onFocus}
          />
        )
      })}
    </Box>
  )
}

const gridSx = {
  display: 'grid',
  gridTemplateColumns: '3.4em 1fr 7.2em',
  alignItems: 'center',
  columnGap: 1,
  px: 0.75,
} as const

const rowSx = {
  ...gridSx,
  width: '100%',
  textAlign: 'left',
  py: 0.75,
  fontFamily: font.ticket,
  borderTop: `1px dashed ${color.rule}`,
  transition: 'opacity 400ms',
} as const

const CheckpointRow = memo(function CheckpointRow({
  checkpoint,
  timeZone,
  now,
  behind,
  onFocus,
}: {
  checkpoint: Checkpoint
  timeZone: string
  now: boolean
  behind: boolean
  onFocus: Props['onFocus']
}) {
  const rain = checkpoint.rain_in_per_hr
  const snow = checkpoint.snow_in_per_hr
  return (
    <li>
      <ButtonBase
        sx={{
          ...rowSx,
          bgcolor: now ? color.ink : 'transparent',
          color: now ? color.paper : color.ink,
          opacity: behind ? 0.72 : 1,
          '&:hover': { bgcolor: now ? color.ink : color.paperShade },
        }}
        aria-current={now ? 'step' : undefined}
        onClick={() => onFocus(checkpoint.position)}
      >
        <Box component="span" sx={{ fontSize: '0.8rem', fontVariantNumeric: 'tabular-nums' }}>
          {Math.round(checkpoint.mile)}
        </Box>
        <Box component="span" sx={{ minWidth: 0 }}>
          <Box component="span" sx={{ display: 'block', fontWeight: 600, fontSize: '0.84rem' }}>
            {formatClock(checkpoint.eta, timeZone)}
          </Box>
          <Box component="span" sx={{ display: 'block', fontSize: '0.72rem' }}>
            {checkpoint.wind_mph.toFixed(1)} / {checkpoint.gust_mph.toFixed(1)} mph
            {rain > 0 && ` · rain ${rain.toFixed(3)}`}
            {snow > 0 && ` · snow ${snow.toFixed(3)}`}
          </Box>
        </Box>
        <Box
          component="span"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.75,
            fontSize: '0.78rem',
            fontWeight: 700,
          }}
        >
          <Box
            component="span"
            sx={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              bgcolor: LEVEL_COLOR[checkpoint.level],
              flexShrink: 0,
              boxShadow: now ? `0 0 0 1.5px ${color.paper}` : 'none',
            }}
          />
          {LEVEL_LABEL[checkpoint.level]}
        </Box>
      </ButtonBase>
    </li>
  )
})

function StopRow({ stop, timeZone, onFocus }: { stop: Stop; timeZone: string; onFocus: Props['onFocus'] }) {
  return (
    <li>
      <ButtonBase
        sx={{ ...rowSx, bgcolor: color.paperShade, '&:hover': { bgcolor: color.rule } }}
        onClick={() => onFocus(stop.position)}
      >
        <Box component="span" sx={{ fontSize: '0.8rem' }}>
          {Math.round(stop.mile)}
        </Box>
        <Box component="span" sx={{ fontWeight: 600, fontSize: '0.8rem' }}>
          {stop.kind === 'rest' ? '10 h rest' : '30 min break'} · {formatClock(stop.start, timeZone)} –{' '}
          {formatClock(stop.end, timeZone)}
        </Box>
        <Box component="span" sx={{ fontSize: '0.74rem', color: color.inkSoft }}>
          Parked
        </Box>
      </ButtonBase>
    </li>
  )
}
