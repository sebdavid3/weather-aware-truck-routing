import Box from '@mui/material/Box'
import Tooltip from '@mui/material/Tooltip'
import type { Level } from '../api'
import { LEVEL_COLOR, LEVEL_LABEL, LEVELS } from '../risk'

/** A route's miles per level as one stacked bar. */
export function RiskBar({ miles }: { miles: Record<Level, number> }) {
  const total = LEVELS.reduce((sum, level) => sum + miles[level], 0) || 1
  return (
    <Box
      sx={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', bgcolor: 'divider' }}
      role="img"
      aria-label={LEVELS.filter((level) => miles[level])
        .map((level) => `${miles[level]} miles ${LEVEL_LABEL[level]}`)
        .join(', ')}
    >
      {LEVELS.filter((level) => miles[level] > 0).map((level) => (
        <Tooltip key={level} title={`${LEVEL_LABEL[level]}: ${miles[level].toLocaleString('en-US')} mi`}>
          <Box sx={{ width: `${(miles[level] / total) * 100}%`, bgcolor: LEVEL_COLOR[level] }} />
        </Tooltip>
      ))}
    </Box>
  )
}
