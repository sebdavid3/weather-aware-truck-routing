import Box, { type BoxProps } from '@mui/material/Box'
import type { ReactNode } from 'react'
import { color, font } from '../brand'
import type { Level } from '../api'
import { LEVEL_COLOR, LEVEL_LABEL, LEVELS } from '../risk'

/** A sheet of thermal paper with a perforated top edge, lifted off the wall. */
export function Ticket({ children, sx, ...props }: BoxProps) {
  return (
    // The mask that punches the perforation also clips shadows, so the lift lives on a wrapper.
    <Box
      sx={{ filter: 'drop-shadow(0 10px 14px rgba(29,31,33,.28)) drop-shadow(0 1px 2px rgba(29,31,33,.18))' }}
    >
      <Box className="ticket-paper" sx={{ px: { xs: 2, sm: 3 }, pt: 3, pb: 2.5, ...sx }} {...props}>
        {children}
      </Box>
    </Box>
  )
}

/** A rule across the ticket with a label printed into it, like a receipt's section break. */
export function TearRule({ children }: { children?: ReactNode }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        my: 2,
        fontFamily: font.ticket,
        fontSize: '0.72rem',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: color.inkSoft,
        '&::before, &::after': { content: '""', flex: 1, borderTop: `1.5px dashed ${color.rule}` },
      }}
    >
      {children}
    </Box>
  )
}

/** The verdict stamp. Stamp red otherwise marks only the commit action and errors. */
export function Stamp({ children, sx }: { children: ReactNode; sx?: BoxProps['sx'] }) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-block',
        border: `3px solid ${color.stamp}`,
        color: color.stamp,
        fontFamily: font.sign,
        fontWeight: 800,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        lineHeight: 1,
        px: 1,
        py: 0.5,
        borderRadius: '3px',
        transform: 'rotate(-6deg)',
        mixBlendMode: 'multiply',
        ...sx,
      }}
    >
      {children}
    </Box>
  )
}

/** The scale house's five lights, one per risk level, each named. */
export function StationLights({ labels = false }: { labels?: boolean }) {
  return (
    <Box sx={{ display: 'flex', gap: labels ? 1.75 : 0.75, alignItems: 'center', flexWrap: 'wrap' }}>
      {LEVELS.map((level: Level) => (
        <Box key={level} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Box
            sx={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              bgcolor: LEVEL_COLOR[level],
              boxShadow: `0 0 0 2px ${color.asphaltSoft}`,
            }}
            aria-hidden
          />
          {labels && (
            <Box component="span" sx={{ fontFamily: font.ticket, fontSize: '0.72rem', color: 'inherit' }}>
              {LEVEL_LABEL[level]}
            </Box>
          )}
        </Box>
      ))}
    </Box>
  )
}

/** HAULCAST in highway-sign caps. */
export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <Box
      component="span"
      sx={{
        fontFamily: font.sign,
        fontWeight: 800,
        fontSize: size,
        letterSpacing: '0.12em',
        lineHeight: 1,
        color: color.signal,
      }}
    >
      HAULCAST
    </Box>
  )
}
