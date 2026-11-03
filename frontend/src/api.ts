// Types mirror the Django responses in backend/planner/planning.py.

export type Level = 'low' | 'moderate' | 'high' | 'severe' | 'no_travel'

export type LonLat = [number, number]

export type Place = {
  label: string
  lat: number
  lon: number
  timezone: string
}

export type TripInput = {
  origin: { lat: number; lon: number }
  destination: { lat: number; lon: number }
  departure: string // Wall-clock time at the origin, "YYYY-MM-DDTHH:mm".
  load_lb: number
  interval_miles: 10 | 25 | 50
  rest_breaks: boolean
}

export type Checkpoint = {
  mile: number
  position: LonLat
  eta: string
  level: Level
  levels: { wind: Level; rain: Level; snow: Level }
  wind_mph: number
  gust_mph: number
  rain_in_per_hr: number
  snow_in_per_hr: number
}

export type Stop = {
  kind: 'break' | 'rest'
  start: string
  end: string
  mile: number
  position: LonLat
}

export type RoutePlan = {
  name: string
  rank: number
  distance_miles: number
  drive_minutes: number
  duration_minutes: number
  arrival: string
  miles_by_level: Record<Level, number>
  average_risk: number
  worst_level: Level
  segments: { level: Level; coordinates: LonLat[] }[]
  checkpoints: Checkpoint[]
  stops: Stop[]
}

export type TripPlan = {
  departure: string
  timezone: string
  load_lb: number
  interval_miles: number
  rest_breaks: boolean
  recommended: string
  reasons: string[]
  warning: string | null
  routes: RoutePlan[]
}

/** The routes before their weather, so the map has something to show while the forecast loads. */
export type TripPreview = {
  departure: string
  timezone: string
  checkpoints: number // Distinct forecast points across all routes.
  to_fetch: number // Of those, how many are not cached yet.
  wait_seconds: number // About how long the forecast will take, within the free plan's limits.
  routes: { name: string; distance_miles: number; drive_minutes: number; line: LonLat[] }[]
}

export type Heatmap = {
  departure: string
  hours: number
  spacing_miles: number // Distance between neighboring corridor points.
  points: LonLat[]
  levels: number[][] // levels[point][hour], 0 (Low) to 4 (No Travel).
}

export class ApiError extends Error {}

export function searchPlaces(query: string, signal: AbortSignal): Promise<{ places: Place[] }> {
  return request(`/api/places?q=${encodeURIComponent(query)}`, { signal })
}

export function planTrip(trip: TripInput, signal?: AbortSignal): Promise<TripPlan> {
  return post('/api/routes', trip, signal)
}

export function previewTrip(trip: TripInput, signal?: AbortSignal): Promise<TripPreview> {
  return post('/api/routes/preview', trip, signal)
}

export function fetchHeatmap(trip: TripInput, signal?: AbortSignal): Promise<Heatmap> {
  return post('/api/heatmap', trip, signal)
}

function post<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
}

async function request<T>(url: string, init: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (init.signal?.aborted) throw error
    throw new ApiError('Can’t reach the server. Check your connection and try again.')
  }
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new ApiError(errorMessage(body))
  return body as T
}

function errorMessage(body: unknown): string {
  if (body && typeof body === 'object') {
    // The API's own errors, already written for the person planning the trip.
    if ('detail' in body && typeof body.detail === 'string') return body.detail
    // DRF validation errors: { field: ["message"] } or { field: { nested: [...] } }.
    const messages = Object.values(body).flatMap(flatten)
    if (messages.length) return messages.join(' ')
  }
  return 'Something went wrong. Try again in a moment.'
}

function flatten(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(flatten)
  if (value && typeof value === 'object') return Object.values(value).flatMap(flatten)
  return []
}
