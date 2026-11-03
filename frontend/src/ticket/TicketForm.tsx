import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import { useState, type FormEvent, type ReactNode } from 'react'
import { color, font } from '../brand'
import { PlaceField } from '../components/PlaceField'
import { wallClockIn, zoneAbbreviation } from '../format'
import { MAX_LOAD_LB, draftErrors, withOrigin, type DraftErrors, type TripDraft } from '../trip/draft'

const DAY_MS = 86_400_000

type Props = {
  draft: TripDraft
  onChange: (draft: TripDraft) => void
  onSubmit: () => void
  busy?: boolean
  /** One box per row, for narrow columns like the planner's side panel. */
  stacked?: boolean
}

/** The trip form printed as a weigh ticket's header boxes. */
export function TicketForm({ draft, onChange, onSubmit, busy = false, stacked = false }: Props) {
  const [submitted, setSubmitted] = useState(false)
  const [openedAt] = useState(() => Date.now())
  const errors = draftErrors(draft)
  // Before the first submit, only mistakes the user just typed are shown.
  const shown: DraftErrors = submitted
    ? errors
    : {
        destination: draft.destination ? errors.destination : undefined,
        load: draft.load !== '' ? errors.load : undefined,
      }
  const timeZone = draft.origin?.timezone ?? 'America/Chicago'

  function submit(event: FormEvent) {
    event.preventDefault()
    setSubmitted(true)
    if (Object.keys(errors).length === 0) onSubmit()
  }

  return (
    <Box component="form" onSubmit={submit} noValidate>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: stacked ? '1fr' : '1fr 1fr' },
          border: `1.5px solid ${color.ink}`,
          '& > *': { borderBottom: `1.5px solid ${color.ink}` },
          '& > *:nth-of-type(odd)': { borderRight: { sm: stacked ? 'none' : `1.5px solid ${color.ink}` } },
        }}
      >
        <Field label="Origin" error={shown.origin}>
          <PlaceField
            label="Origin"
            value={draft.origin}
            onChange={(place) => onChange(withOrigin(draft, place))}
          />
        </Field>
        <Field label="Destination" error={shown.destination}>
          <PlaceField
            label="Destination"
            value={draft.destination}
            onChange={(place) => onChange({ ...draft, destination: place })}
          />
        </Field>
        <Field
          label={`Depart · ${zoneAbbreviation(timeZone)} at origin`}
          htmlFor="ticket-departure"
          error={shown.departure}
        >
          <Box
            component="input"
            id="ticket-departure"
            type="datetime-local"
            value={draft.departure}
            min={wallClockIn(new Date(openedAt), timeZone)}
            max={wallClockIn(new Date(openedAt + 7 * DAY_MS), timeZone)}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              onChange({ ...draft, departure: event.target.value, departureTouched: true })
            }
            sx={inputSx}
          />
        </Field>
        <Field label="Checkpoint every">
          <ToggleButtonGroup
            size="small"
            exclusive
            value={draft.interval}
            onChange={(_, value) => value && onChange({ ...draft, interval: value })}
            aria-label="Checkpoint every"
            sx={{ mt: 0.5 }}
          >
            {[10, 25, 50].map((miles) => (
              <ToggleButton key={miles} value={miles} sx={{ px: 1.5 }}>
                {miles} mi
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Field>
        <Field label="Load weight · cargo" htmlFor="ticket-load" error={shown.load} readout>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
            <Box
              component="input"
              id="ticket-load"
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_LOAD_LB}
              step={1000}
              value={draft.load}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                onChange({ ...draft, load: event.target.value })
              }
              sx={{
                ...inputSx,
                color: color.signal,
                caretColor: color.signal,
                fontSize: '1.9rem',
                fontWeight: 700,
                letterSpacing: '0.04em',
                width: '100%',
                MozAppearance: 'textfield',
                '&::-webkit-outer-spin-button, &::-webkit-inner-spin-button': {
                  WebkitAppearance: 'none',
                  m: 0,
                },
              }}
            />
            <Box component="span" sx={{ fontFamily: font.ticket, color: color.signal, fontWeight: 600 }}>
              lb
            </Box>
          </Box>
        </Field>
        <Field label="Driver rest breaks">
          <Box
            component="label"
            sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start', cursor: 'pointer', mt: 0.5 }}
          >
            <Box
              component="input"
              type="checkbox"
              checked={draft.restBreaks}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                onChange({ ...draft, restBreaks: event.target.checked })
              }
              sx={{ width: 18, height: 18, m: 0, mt: '2px', accentColor: color.ink, flexShrink: 0 }}
            />
            <Box component="span" sx={{ fontFamily: font.ticket, fontSize: '0.8rem', lineHeight: 1.45 }}>
              30 min after 8 h and 10 h after 11 h of driving
            </Box>
          </Box>
        </Field>
      </Box>
      <Button
        type="submit"
        fullWidth
        disabled={busy}
        sx={{
          mt: 2,
          py: 1.4,
          fontSize: '1.25rem',
          color: color.paper,
          bgcolor: color.stamp,
          '&:hover': { bgcolor: color.stampDeep },
          '&.Mui-disabled': { bgcolor: color.inkFaint, color: color.paper },
        }}
      >
        {busy ? 'Weighing routes…' : 'Weigh my routes'}
      </Button>
    </Box>
  )
}

const inputSx = {
  display: 'block',
  border: 0,
  outline: 'none',
  background: 'transparent',
  p: 0,
  mt: 0.5,
  fontFamily: font.ticket,
  fontWeight: 600,
  fontSize: '1.02rem',
  color: color.ink,
  colorScheme: 'light',
  '&:focus-visible': { boxShadow: `0 2px 0 ${color.ink}` },
  '&::-webkit-calendar-picker-indicator': { opacity: 0.6, cursor: 'pointer' },
} as const

function Field({
  label,
  htmlFor,
  error,
  readout = false,
  children,
}: {
  label: string
  htmlFor?: string
  error?: string
  readout?: boolean
  children: ReactNode
}) {
  return (
    <Box sx={{ px: 1.5, py: 1.25, minWidth: 0, bgcolor: readout ? color.asphalt : 'transparent' }}>
      <Box
        component={htmlFor ? 'label' : 'div'}
        htmlFor={htmlFor}
        sx={{
          display: 'block',
          fontFamily: font.ticket,
          fontSize: '0.68rem',
          fontWeight: 600,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: readout ? color.signal : color.inkSoft,
        }}
      >
        {label}
      </Box>
      {children}
      {error && (
        <Box
          role="alert"
          sx={{
            mt: 0.5,
            fontFamily: font.ticket,
            fontSize: '0.72rem',
            color: readout ? '#ffb4ad' : color.stamp,
          }}
        >
          {error}
        </Box>
      )}
    </Box>
  )
}
