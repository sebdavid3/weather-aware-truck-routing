import Button from '@mui/material/Button'
import FormControlLabel from '@mui/material/FormControlLabel'
import InputAdornment from '@mui/material/InputAdornment'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { useState, type FormEvent } from 'react'
import type { Place, TripInput } from '../api'
import { nextHourIn, wallClockIn, zoneAbbreviation } from '../format'
import { PlaceField } from './PlaceField'

const DAY_MS = 86_400_000
const MAX_LOAD_LB = 80_000

// A trip prefilled for a first look; every field can be changed.
const DALLAS: Place = { label: 'Dallas, TX', lat: 32.777976, lon: -96.796215, timezone: 'America/Chicago' }
const CHICAGO: Place = { label: 'Chicago, IL', lat: 41.883229, lon: -87.632398, timezone: 'America/Chicago' }

type Props = {
  busy: boolean
  onSubmit: (trip: TripInput) => void
}

export function TripForm({ busy, onSubmit }: Props) {
  const [origin, setOrigin] = useState<Place | null>(DALLAS)
  const [destination, setDestination] = useState<Place | null>(CHICAGO)
  const [departure, setDeparture] = useState(() => nextHourIn(DALLAS.timezone))
  const [departureTouched, setDepartureTouched] = useState(false)
  const [load, setLoad] = useState('35000')
  const [interval, setInterval] = useState<TripInput['interval_miles']>(25)
  const [restBreaks, setRestBreaks] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [openedAt] = useState(() => Date.now())

  const timeZone = origin?.timezone ?? DALLAS.timezone
  const loadValue = Number(load)
  const loadError =
    load === '' || !Number.isInteger(loadValue) || loadValue < 0 || loadValue > MAX_LOAD_LB
      ? `Enter a whole number from 0 to ${MAX_LOAD_LB.toLocaleString('en-US')}`
      : undefined
  const sameEnds = origin && destination && origin.lat === destination.lat && origin.lon === destination.lon

  function changeOrigin(place: Place | null) {
    setOrigin(place)
    // The default departure follows the origin's clock until the user picks one.
    if (place && !departureTouched) setDeparture(nextHourIn(place.timezone))
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    setSubmitted(true)
    if (!origin || !destination || sameEnds || loadError || !departure) return
    onSubmit({
      origin: { lat: origin.lat, lon: origin.lon },
      destination: { lat: destination.lat, lon: destination.lon },
      departure,
      load_lb: loadValue,
      interval_miles: interval,
      rest_breaks: restBreaks,
    })
  }

  return (
    <Stack component="form" spacing={2} onSubmit={submit} noValidate>
      <PlaceField
        label="Origin"
        value={origin}
        onChange={changeOrigin}
        error={submitted && !origin ? 'Choose an origin' : undefined}
      />
      <PlaceField
        label="Destination"
        value={destination}
        onChange={setDestination}
        error={
          submitted && !destination
            ? 'Choose a destination'
            : sameEnds
              ? 'Choose a destination different from the origin'
              : undefined
        }
      />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <TextField
          label="Departure"
          type="datetime-local"
          value={departure}
          onChange={(event) => {
            setDeparture(event.target.value)
            setDepartureTouched(true)
          }}
          helperText={`Local time at origin (${zoneAbbreviation(timeZone)})`}
          slotProps={{
            inputLabel: { shrink: true },
            htmlInput: {
              min: wallClockIn(new Date(openedAt), timeZone),
              max: wallClockIn(new Date(openedAt + 7 * DAY_MS), timeZone),
            },
          }}
        />
        <TextField
          label="Load weight"
          type="number"
          value={load}
          onChange={(event) => setLoad(event.target.value)}
          error={Boolean(loadError)}
          helperText={loadError ?? 'Cargo only'}
          sx={{ maxWidth: { sm: 160 } }}
          slotProps={{
            input: { endAdornment: <InputAdornment position="end">lb</InputAdornment> },
            htmlInput: { min: 0, max: MAX_LOAD_LB, step: 1000 },
          }}
        />
      </Stack>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="body2" color="text.secondary">
          Weather checkpoint every
        </Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={interval}
          onChange={(_, value) => value && setInterval(value)}
          aria-label="Checkpoint interval"
        >
          {[10, 25, 50].map((miles) => (
            <ToggleButton key={miles} value={miles}>
              {miles} mi
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Stack>
      <FormControlLabel
        control={<Switch checked={restBreaks} onChange={(event) => setRestBreaks(event.target.checked)} />}
        label={
          <Typography variant="body2">
            Include driver rest breaks{' '}
            <Typography component="span" variant="caption" color="text.secondary">
              (30 min after 8 h, 10 h after 11 h driving)
            </Typography>
          </Typography>
        }
      />
      <Button type="submit" variant="contained" size="large" disabled={busy}>
        {busy ? 'Planning routes…' : 'Plan routes'}
      </Button>
    </Stack>
  )
}
