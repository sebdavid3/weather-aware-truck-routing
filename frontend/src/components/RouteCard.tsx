import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import type { RoutePlan } from '../api'
import { color, display, font } from '../brand'
import { formatDuration, formatTime } from '../format'
import { LEVEL_COLOR, LEVEL_LABEL, LEVELS } from '../risk'
import { Stamp } from '../ticket/Ticket'
import { RiskBar } from './RiskBar'

type Props = {
  route: RoutePlan
  recommended: boolean
  selected: boolean
  restBreaks: boolean
  timeZone: string
  onSelect: () => void
}

/** One route as a weigh ticket: every ticket shares the same ruled header and its miles per level. */
export function RouteCard({ route, recommended, selected, restBreaks, timeZone, onSelect }: Props) {
  return (
    <Box
      sx={{
        filter: selected
          ? 'drop-shadow(0 14px 18px rgba(29,31,33,.35)) drop-shadow(0 2px 3px rgba(29,31,33,.2))'
          : 'drop-shadow(0 6px 8px rgba(29,31,33,.22))',
        transform: selected ? 'translateY(-2px)' : 'none',
        transition: 'transform 200ms cubic-bezier(.16,1,.3,1), filter 200ms',
      }}
    >
      <ButtonBase
        onClick={onSelect}
        aria-pressed={selected}
        className="ticket-paper"
        sx={{
          // ButtonBase's own transparent background would otherwise win over the paper class.
          bgcolor: color.paper,
          display: 'block',
          width: '100%',
          textAlign: 'left',
          px: 2,
          pt: 2.25,
          pb: 1.75,
          fontFamily: font.ticket,
          color: color.ink,
          outline: selected ? `2px solid ${color.ink}` : 'none',
          outlineOffset: -6,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box
            sx={{
              ...display,
              fontSize: '1.2rem',
            }}
          >
            Route {route.name}
          </Box>
          <Box sx={{ fontSize: '0.78rem', color: color.inkSoft }}>#{route.rank}</Box>
          {recommended && (
            <Box sx={{ ml: 'auto' }}>
              <Stamp sx={{ fontSize: '0.95rem' }}>Recommended</Stamp>
            </Box>
          )}
        </Box>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            mt: 1.5,
            border: `1.5px solid ${color.ink}`,
            '& > div': { px: 1, py: 0.75 },
            '& > div + div': { borderLeft: `1.5px solid ${color.ink}` },
          }}
        >
          <Cell label="Miles" value={route.distance_miles.toLocaleString('en-US')} />
          <Cell
            label={restBreaks ? 'Total time' : 'Drive time'}
            value={formatDuration(route.duration_minutes)}
          />
          <Cell label="Avg risk" value={route.average_risk.toFixed(1)} />
        </Box>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            borderInline: `1.5px solid ${color.ink}`,
            borderBottom: `1.5px solid ${color.ink}`,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {LEVELS.map((level, index) => (
            <Box
              key={level}
              sx={{
                px: 0.75,
                py: 0.6,
                borderLeft: index ? `1px solid ${color.rule}` : 'none',
                opacity: route.miles_by_level[level] ? 1 : 0.45,
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  fontSize: '0.6rem',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: color.inkSoft,
                  whiteSpace: 'nowrap',
                }}
              >
                <Box
                  component="span"
                  sx={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    bgcolor: LEVEL_COLOR[level],
                    flexShrink: 0,
                  }}
                />
                {LEVEL_LABEL[level]}
              </Box>
              <Box
                sx={{
                  fontWeight: 700,
                  fontSize: '0.92rem',
                  color: level === 'no_travel' && route.miles_by_level[level] ? color.stamp : color.ink,
                }}
              >
                {route.miles_by_level[level].toLocaleString('en-US')}
              </Box>
            </Box>
          ))}
        </Box>
        <Box sx={{ mt: 1.25 }}>
          <RiskBar miles={route.miles_by_level} />
        </Box>
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            mt: 1,
            fontSize: '0.74rem',
            color: color.inkSoft,
            gap: 1,
          }}
        >
          <span>
            Arrives {formatTime(route.arrival, timeZone)}
            {restBreaks && route.stops.length > 0 && ` · ${route.stops.length} stops`}
          </span>
          <span>Worst: {LEVEL_LABEL[route.worst_level]}</span>
        </Box>
      </ButtonBase>
    </Box>
  )
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Box
        sx={{ fontSize: '0.6rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: color.inkSoft }}
      >
        {label}
      </Box>
      <Box sx={{ fontWeight: 700, fontSize: '1rem', fontVariantNumeric: 'tabular-nums' }}>{value}</Box>
    </div>
  )
}
