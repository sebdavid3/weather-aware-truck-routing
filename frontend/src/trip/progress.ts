import type { LonLat, RoutePlan } from '../api'

export type TruckState = 'driving' | 'break' | 'rest' | 'arrived'

export type Progress = {
  state: TruckState
  mile: number
  position: LonLat
  /** When the current stop ends, or when the truck arrived. */
  until?: number
}

type Mark = { at: number; mile: number; position: LonLat }

/**
 * Where a route's truck is at a moment: moving between checkpoints by their ETAs, and standing
 * still from the start to the end of each rest stop.
 */
export function progressAt(route: RoutePlan, at: number): Progress {
  const marks: Mark[] = [
    ...route.checkpoints.map((c) => ({ at: Date.parse(c.eta), mile: c.mile, position: c.position })),
    ...route.stops.flatMap((s) => [
      { at: Date.parse(s.start), mile: s.mile, position: s.position },
      { at: Date.parse(s.end), mile: s.mile, position: s.position },
    ]),
  ].sort((a, b) => a.at - b.at)

  const last = marks[marks.length - 1]
  if (at >= last.at) return { state: 'arrived', mile: last.mile, position: last.position, until: last.at }

  const stop = route.stops.find((s) => Date.parse(s.start) <= at && at < Date.parse(s.end))
  if (stop) return { state: stop.kind, mile: stop.mile, position: stop.position, until: Date.parse(stop.end) }

  if (at <= marks[0].at) return { state: 'driving', mile: marks[0].mile, position: marks[0].position }
  const next = marks.findIndex((mark) => mark.at >= at)
  const a = marks[next - 1]
  const b = marks[next]
  const f = b.at === a.at ? 1 : (at - a.at) / (b.at - a.at)
  return {
    state: 'driving',
    mile: a.mile + (b.mile - a.mile) * f,
    position: [
      a.position[0] + (b.position[0] - a.position[0]) * f,
      a.position[1] + (b.position[1] - a.position[1]) * f,
    ],
  }
}

/** Hours from departure until the route's truck arrives. */
export function arrivalHour(route: RoutePlan, departure: string): number {
  return (Date.parse(route.arrival) - Date.parse(departure)) / 3_600_000
}
