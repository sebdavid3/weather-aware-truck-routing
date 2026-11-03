import Box from '@mui/material/Box'
import type { Level } from '../api'
import { LEVEL_COLOR, LEVEL_LABEL } from '../risk'

/** A level's name next to its color dot; color is never the only cue. */
export function LevelChip({ level }: { level: Level }) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        fontSize: '0.78rem',
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      <Box component="span" sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: LEVEL_COLOR[level] }} />
      {LEVEL_LABEL[level]}
    </Box>
  )
}
