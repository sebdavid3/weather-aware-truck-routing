import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Typography from '@mui/material/Typography'
import type { Checkpoint, RoutePlan, Stop } from '../api'
import { formatClock } from '../format'
import { LevelChip } from './LevelChip'

type Row = { kind: 'checkpoint'; at: string; item: Checkpoint } | { kind: 'stop'; at: string; item: Stop }

type Props = {
  route: RoutePlan
  timeZone: string
  onFocus: (position: [number, number]) => void
}

/** The selected route's checkpoints in driving order, with rest stops between them. */
export function CheckpointList({ route, timeZone, onFocus }: Props) {
  const rows: Row[] = [
    ...route.checkpoints.map((item): Row => ({ kind: 'checkpoint', at: item.eta, item })),
    ...route.stops.map((item): Row => ({ kind: 'stop', at: item.start, item })),
  ].sort((a, b) => a.at.localeCompare(b.at))

  return (
    <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {rows.map((row) =>
        row.kind === 'stop' ? (
          <StopRow key={`stop-${row.at}`} stop={row.item} timeZone={timeZone} onFocus={onFocus} />
        ) : (
          <CheckpointRow
            key={`cp-${row.item.mile}`}
            checkpoint={row.item}
            timeZone={timeZone}
            onFocus={onFocus}
          />
        ),
      )}
    </Box>
  )
}

const rowSx = {
  display: 'grid',
  gridTemplateColumns: '52px 1fr auto',
  alignItems: 'center',
  columnGap: 1,
  width: '100%',
  textAlign: 'left',
  px: 1,
  py: 0.75,
  borderRadius: 1,
  '&:hover': { bgcolor: 'action.hover' },
} as const

function CheckpointRow({
  checkpoint,
  timeZone,
  onFocus,
}: {
  checkpoint: Checkpoint
  timeZone: string
  onFocus: Props['onFocus']
}) {
  const rain = checkpoint.rain_in_per_hr
  const snow = checkpoint.snow_in_per_hr
  return (
    <li>
      <ButtonBase sx={rowSx} onClick={() => onFocus(checkpoint.position)}>
        <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          mi {Math.round(checkpoint.mile)}
        </Typography>
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {formatClock(checkpoint.eta, timeZone)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Wind {checkpoint.wind_mph.toFixed(0)} mph (gusts {checkpoint.gust_mph.toFixed(0)})
            {rain > 0 && ` · Rain ${rain.toFixed(2)} in/h`}
            {snow > 0 && ` · Snow ${snow.toFixed(2)} in/h`}
          </Typography>
        </Box>
        <LevelChip level={checkpoint.level} />
      </ButtonBase>
    </li>
  )
}

function StopRow({ stop, timeZone, onFocus }: { stop: Stop; timeZone: string; onFocus: Props['onFocus'] }) {
  return (
    <li>
      <ButtonBase sx={{ ...rowSx, bgcolor: 'action.hover' }} onClick={() => onFocus(stop.position)}>
        <Typography variant="caption" color="text.secondary">
          mi {Math.round(stop.mile)}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {stop.kind === 'rest' ? '10 h rest' : '30 min break'} · {formatClock(stop.start, timeZone)} –{' '}
          {formatClock(stop.end, timeZone)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Parked
        </Typography>
      </ButtonBase>
    </li>
  )
}
