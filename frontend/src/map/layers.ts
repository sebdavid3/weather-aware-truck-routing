// GeoJSON builders and MapLibre layer definitions for the trip map.

import type { FeatureCollection } from 'geojson'
import type { ExpressionSpecification, LayerSpecification } from 'maplibre-gl'
import type { Heatmap, LonLat, RoutePlan, TripPlan } from '../api'
import { LEVEL_COLOR } from '../risk'

export const SOURCES = {
  heat: 'corridor-heat',
  routes: 'routes',
  checkpoints: 'checkpoints',
  stops: 'stops',
  trucks: 'trucks',
} as const

type Collection = FeatureCollection

export const empty = (): Collection => ({ type: 'FeatureCollection', features: [] })

export function routeFeatures(plan: TripPlan): Collection {
  return {
    type: 'FeatureCollection',
    features: plan.routes.flatMap((route) =>
      route.segments.map((segment) => ({
        type: 'Feature' as const,
        properties: { route: route.name, level: segment.level },
        geometry: { type: 'LineString' as const, coordinates: segment.coordinates },
      })),
    ),
  }
}

export function checkpointFeatures(plan: TripPlan): Collection {
  return {
    type: 'FeatureCollection',
    features: plan.routes.flatMap((route) =>
      route.checkpoints.map((checkpoint, index) => ({
        type: 'Feature' as const,
        properties: { route: route.name, index, level: checkpoint.level },
        geometry: { type: 'Point' as const, coordinates: checkpoint.position },
      })),
    ),
  }
}

export function stopFeatures(plan: TripPlan): Collection {
  return {
    type: 'FeatureCollection',
    features: plan.routes.flatMap((route) =>
      route.stops.map((stop, index) => ({
        type: 'Feature' as const,
        properties: { route: route.name, index, kind: stop.kind },
        geometry: { type: 'Point' as const, coordinates: stop.position },
      })),
    ),
  }
}

/** Corridor points with one property per hour, h0…h48, so a paint expression can pick the hour. */
export function heatFeatures(heatmap: Heatmap): Collection {
  return {
    type: 'FeatureCollection',
    features: heatmap.points.map((point, index) => ({
      type: 'Feature' as const,
      properties: Object.fromEntries(heatmap.levels[index].map((level, hour) => [`h${hour}`, level])),
      geometry: { type: 'Point' as const, coordinates: point },
    })),
  }
}

export function truckFeatures(plan: TripPlan, hour: number): Collection {
  const at = Date.parse(plan.departure) + hour * 3_600_000
  return {
    type: 'FeatureCollection',
    features: plan.routes.map((route) => ({
      type: 'Feature' as const,
      properties: { route: route.name },
      geometry: { type: 'Point' as const, coordinates: truckPosition(route, at) },
    })),
  }
}

/** Where the truck is at a moment: between checkpoints by time, standing still during stops. */
export function truckPosition(route: RoutePlan, at: number): LonLat {
  const timeline: [number, LonLat][] = [
    ...route.checkpoints.map((c): [number, LonLat] => [Date.parse(c.eta), c.position]),
    ...route.stops.flatMap((s): [number, LonLat][] => [
      [Date.parse(s.start), s.position],
      [Date.parse(s.end), s.position],
    ]),
  ].sort((a, b) => a[0] - b[0])
  if (at <= timeline[0][0]) return timeline[0][1]
  for (let i = 1; i < timeline.length; i++) {
    const [t1, p1] = timeline[i]
    if (at <= t1) {
      const [t0, p0] = timeline[i - 1]
      const f = t1 === t0 ? 1 : (at - t0) / (t1 - t0)
      return [p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f]
    }
  }
  return timeline[timeline.length - 1][1]
}

const levelColor: ExpressionSpecification = [
  'match',
  ['get', 'level'],
  'low',
  LEVEL_COLOR.low,
  'moderate',
  LEVEL_COLOR.moderate,
  'high',
  LEVEL_COLOR.high,
  'severe',
  LEVEL_COLOR.severe,
  'no_travel',
  LEVEL_COLOR.no_travel,
  '#888888',
]

/**
 * Heatmap weight at a fractional hour, blending the two hours around it so
 * playback moves smoothly instead of jumping each hour. Low is faint, so the
 * corridor stays visible when the weather is calm.
 */
export function heatWeight(hour: number, maxHour: number): ExpressionSpecification {
  const low = Math.min(Math.floor(hour), maxHour)
  const high = Math.min(low + 1, maxHour)
  const f = hour - low
  const weightAt = (h: number): ExpressionSpecification => [
    'match',
    ['get', `h${h}`],
    0,
    0.15,
    1,
    0.3,
    2,
    0.55,
    3,
    0.8,
    4,
    1,
    0,
  ]
  return ['+', ['*', 1 - f, weightAt(low)], ['*', f, weightAt(high)]]
}

/**
 * A heatmap radius of 2.2 lattice spacings at every zoom, so neighboring points
 * blend into a band. Pixels per meter double with each zoom level.
 */
export function heatRadius(heatmap: Heatmap): ExpressionSpecification {
  const meanLat = heatmap.points.reduce((sum, [, lat]) => sum + lat, 0) / heatmap.points.length
  const metersPerPixelAtZoom0 = 156_543.03 * Math.cos((meanLat * Math.PI) / 180)
  const radiusAtZoom0 = (2.2 * heatmap.spacing_miles * 1609.344) / metersPerPixelAtZoom0
  return ['interpolate', ['exponential', 2], ['zoom'], 0, radiusAtZoom0, 9, radiusAtZoom0 * 512]
}

/** Paint values that set the selected route apart; shared by the layers and selection updates. */
export function selectionStyle(name: string) {
  const isSelected: ExpressionSpecification = ['==', ['get', 'route'], name]
  const pick = (yes: number | string, no: number | string): ExpressionSpecification => [
    'case',
    isSelected,
    yes,
    no,
  ]
  return {
    filter: isSelected,
    sortKey: pick(1, 0),
    casingWidth: pick(9, 5),
    casingOpacity: pick(1, 0.6),
    lineWidth: pick(5.5, 3),
    lineOpacity: pick(1, 0.45),
    pointOpacity: pick(1, 0.35),
    truckColor: pick('#1d1f21', '#575a63'),
    truckRadius: pick(10, 8),
  }
}

export function layers(selectedRoute: string): LayerSpecification[] {
  const style = selectionStyle(selectedRoute)
  return [
    {
      id: 'corridor-heat',
      type: 'heatmap',
      source: SOURCES.heat,
      paint: {
        'heatmap-weight': heatWeight(0, 48),
        // Points sit on a square lattice; with the radius 2.2 times the spacing,
        // this intensity makes the density along a route about equal to its weight.
        'heatmap-intensity': 1.4,
        'heatmap-radius': 20,
        // The radius stops growing at zoom 9, so the band fades out before it breaks into dots;
        // up close the colored checkpoints carry the detail.
        'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0.75, 9.5, 0.4, 10.5, 0],
        'heatmap-color': [
          'interpolate',
          ['linear'],
          ['heatmap-density'],
          0,
          'rgba(0,0,0,0)',
          0.05,
          hexToRgba(LEVEL_COLOR.low, 0.2),
          0.15,
          hexToRgba(LEVEL_COLOR.low, 0.45),
          0.3,
          LEVEL_COLOR.moderate,
          0.55,
          LEVEL_COLOR.high,
          0.8,
          LEVEL_COLOR.severe,
          1,
          LEVEL_COLOR.no_travel,
        ],
      },
    },
    {
      id: 'route-casing',
      type: 'line',
      source: SOURCES.routes,
      layout: { 'line-join': 'round', 'line-cap': 'round', 'line-sort-key': style.sortKey },
      paint: {
        'line-color': '#ffffff',
        'line-width': style.casingWidth,
        'line-opacity': style.casingOpacity,
      },
    },
    {
      id: 'route-risk',
      type: 'line',
      source: SOURCES.routes,
      layout: { 'line-join': 'round', 'line-cap': 'round', 'line-sort-key': style.sortKey },
      paint: {
        'line-color': levelColor,
        'line-width': style.lineWidth,
        'line-opacity': style.lineOpacity,
      },
    },
    {
      id: 'checkpoints',
      type: 'circle',
      source: SOURCES.checkpoints,
      paint: {
        'circle-color': levelColor,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 2.5, 8, 5, 12, 7],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
        'circle-opacity': style.pointOpacity,
        'circle-stroke-opacity': style.pointOpacity,
      },
    },
    {
      id: 'stops',
      type: 'circle',
      source: SOURCES.stops,
      filter: style.filter,
      paint: {
        'circle-color': '#ffffff',
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 4, 10, 8],
        'circle-stroke-color': '#1b2430',
        'circle-stroke-width': 2.5,
      },
    },
    {
      id: 'trucks',
      type: 'circle',
      source: SOURCES.trucks,
      paint: {
        'circle-color': style.truckColor,
        'circle-radius': style.truckRadius,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    },
    {
      id: 'truck-labels',
      type: 'symbol',
      source: SOURCES.trucks,
      layout: {
        'text-field': ['get', 'route'],
        'text-font': ['Noto Sans Bold'],
        'text-size': 11,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: { 'text-color': '#f2c230' },
    },
  ]
}

function hexToRgba(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16)
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`
}
