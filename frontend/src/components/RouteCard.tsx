import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { RoutePlan } from '../api'
import { formatDuration, formatMiles, formatTime } from '../format'
import { LEVEL_LABEL } from '../risk'
import { RiskBar } from './RiskBar'

type Props = {
  route: RoutePlan
  recommended: boolean
  selected: boolean
  restBreaks: boolean
  timeZone: string
  onSelect: () => void
}

export function RouteCard({ route, recommended, selected, restBreaks, timeZone, onSelect }: Props) {
  const miles = route.miles_by_level
  return (
    <ButtonBase
      onClick={onSelect}
      aria-pressed={selected}
      sx={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        p: 1.5,
        borderRadius: 2,
        border: 1,
        borderColor: selected ? 'primary.main' : 'divider',
        boxShadow: selected ? (theme) => `inset 0 0 0 1px ${theme.palette.primary.main}` : 'none',
        bgcolor: 'background.paper',
        transition: 'border-color 120ms, box-shadow 120ms',
        '&:hover': { borderColor: selected ? 'primary.main' : 'text.secondary' },
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
        <Box
          sx={{
            width: 26,
            height: 26,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            fontWeight: 700,
            fontSize: '0.85rem',
            color: '#fff',
            bgcolor: selected ? 'primary.main' : 'text.secondary',
          }}
        >
          {route.name}
        </Box>
        <Typography sx={{ fontWeight: 700, flexGrow: 1 }}>
          {formatMiles(route.distance_miles)} · {formatDuration(route.duration_minutes)}
        </Typography>
        {recommended ? (
          <Chip size="small" color="success" label="Recommended" />
        ) : (
          <Typography variant="caption" color="text.secondary">
            #{route.rank}
          </Typography>
        )}
      </Stack>
      <RiskBar miles={miles} />
      <Stack direction="row" sx={{ justifyContent: 'space-between', mt: 1, color: 'text.secondary' }}>
        <Typography variant="caption">
          Severe {miles.severe} mi · High {miles.high} mi
          {miles.no_travel > 0 && (
            <Box component="span" sx={{ color: 'error.main', fontWeight: 700 }}>
              {' '}
              · No Travel {miles.no_travel} mi
            </Box>
          )}
        </Typography>
        <Typography variant="caption">Avg risk {route.average_risk.toFixed(1)}</Typography>
      </Stack>
      <Stack direction="row" sx={{ justifyContent: 'space-between', mt: 0.5, color: 'text.secondary' }}>
        <Typography variant="caption">
          Arrives {formatTime(route.arrival, timeZone)}
          {restBreaks && route.stops.length > 0 && ` · ${route.stops.length} stops`}
        </Typography>
        <Typography variant="caption">Worst: {LEVEL_LABEL[route.worst_level]}</Typography>
      </Stack>
    </ButtonBase>
  )
}
