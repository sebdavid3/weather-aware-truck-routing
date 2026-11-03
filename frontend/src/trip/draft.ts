import type { Place, TripInput } from '../api'
import { nextHourIn } from '../format'

export const MAX_LOAD_LB = 80_000

/** What the trip form holds while someone fills it in; shared by the landing and the planner. */
export type TripDraft = {
  origin: Place | null
  destination: Place | null
  departure: string // Wall-clock time at the origin, "YYYY-MM-DDTHH:mm".
  departureTouched: boolean
  load: string
  interval: TripInput['interval_miles']
  restBreaks: boolean
}

// A trip prefilled for a first look; every field can be changed.
const DALLAS: Place = { label: 'Dallas, TX', lat: 32.777976, lon: -96.796215, timezone: 'America/Chicago' }
const CHICAGO: Place = { label: 'Chicago, IL', lat: 41.883229, lon: -87.632398, timezone: 'America/Chicago' }

export function initialDraft(): TripDraft {
  return {
    origin: DALLAS,
    destination: CHICAGO,
    departure: nextHourIn(DALLAS.timezone),
    departureTouched: false,
    load: '35000',
    interval: 25,
    restBreaks: false,
  }
}

export type DraftErrors = Partial<Record<'origin' | 'destination' | 'departure' | 'load', string>>

export function draftErrors(draft: TripDraft): DraftErrors {
  const errors: DraftErrors = {}
  if (!draft.origin) errors.origin = 'Choose an origin'
  if (!draft.destination) errors.destination = 'Choose a destination'
  else if (
    draft.origin &&
    draft.origin.lat === draft.destination.lat &&
    draft.origin.lon === draft.destination.lon
  ) {
    errors.destination = 'Choose a destination different from the origin'
  }
  if (!draft.departure) errors.departure = 'Choose a departure time'
  const load = Number(draft.load)
  if (draft.load === '' || !Number.isInteger(load) || load < 0 || load > MAX_LOAD_LB) {
    errors.load = `Enter a whole number from 0 to ${MAX_LOAD_LB.toLocaleString('en-US')}`
  }
  return errors
}

/** The API request for a draft that has no errors. */
export function toTripInput(draft: TripDraft): TripInput {
  return {
    origin: { lat: draft.origin!.lat, lon: draft.origin!.lon },
    destination: { lat: draft.destination!.lat, lon: draft.destination!.lon },
    departure: draft.departure,
    load_lb: Number(draft.load),
    interval_miles: draft.interval,
    rest_breaks: draft.restBreaks,
  }
}

/** A new origin moves the default departure to its clock until someone picks a time. */
export function withOrigin(draft: TripDraft, origin: Place | null): TripDraft {
  const departure = origin && !draft.departureTouched ? nextHourIn(origin.timezone) : draft.departure
  return { ...draft, origin, departure }
}
