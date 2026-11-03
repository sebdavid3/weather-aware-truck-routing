import Box from '@mui/material/Box'
import {
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
  setWorkerUrl,
  type GeoJSONSource,
  type LngLatBoundsLike,
  type MapLayerMouseEvent,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { useEffect, useRef, useState } from 'react'
import type { Heatmap, LonLat, TripPlan } from '../api'
import type { MapLayers } from '../components/LayerToggles'
import { formatClock, formatTime } from '../format'
import { LEVEL_LABEL } from '../risk'
import {
  SOURCES,
  checkpointFeatures,
  empty,
  heatFeatures,
  heatRadius,
  heatWeight,
  layers,
  routeFeatures,
  selectionStyle,
  stopFeatures,
  truckFeatures,
} from './layers'
import { labelAnchor, placePin, routeLabel, setLabelSelected } from './markers'

// MapLibre finds its worker next to its own module, which breaks once Vite
// bundles it; pointing at the file Vite emits fixes dev and production builds.
setWorkerUrl(workerUrl)

// OpenFreeMap needs no API key and has no usage limits.
const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/positron'

const CONTINENTAL_US: LngLatBoundsLike = [
  [-125, 24],
  [-66, 50],
]

// Panning stops at North America; the app plans US trips only.
const NORTH_AMERICA: LngLatBoundsLike = [
  [-172, 5],
  [-40, 75],
]

type Props = {
  plan: TripPlan | null
  heatmap: Heatmap | null
  hour: number
  selectedRoute: string
  focus: { position: LonLat; key: number } | null
  onSelectRoute: (name: string) => void
  places: { origin: string; destination: string } | null
  layers: MapLayers
}

export function TripMap({
  plan,
  heatmap,
  hour,
  selectedRoute,
  focus,
  onSelectRoute,
  places,
  layers: shown,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [ready, setReady] = useState(false)
  const labelsRef = useRef<{ name: string; marker: Marker }[]>([])
  const pinsRef = useRef<Marker[]>([])
  // Handlers registered once at load read the latest props through these refs.
  const planRef = useRef(plan)
  const onSelectRef = useRef(onSelectRoute)
  useEffect(() => {
    planRef.current = plan
    onSelectRef.current = onSelectRoute
  })

  useEffect(() => {
    const map = new MapLibreMap({
      container: containerRef.current!,
      style: BASEMAP_STYLE,
      bounds: CONTINENTAL_US,
      maxBounds: NORTH_AMERICA,
      renderWorldCopies: false,
      // A planner has no use for a tilted or rotated map; it only makes routes harder to read.
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: {
        compact: true,
        customAttribution:
          '<a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather by Open-Meteo.com</a> · Routes © TomTom',
      },
    })
    mapRef.current = map
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    map.touchZoomRotate.disableRotation()
    map.keyboard.disableRotation()

    map.on('load', () => {
      quietBasemap(map)
      for (const source of Object.values(SOURCES)) {
        map.addSource(source, { type: 'geojson', data: empty() })
      }
      // Below the basemap's labels, so city names stay readable over the routes.
      const firstLabel = map.getStyle().layers.find((layer) => layer.type === 'symbol')?.id
      for (const layer of layers('A')) {
        map.addLayer(layer, layer.type === 'symbol' ? undefined : firstLabel)
      }

      const pointer = () => (map.getCanvas().style.cursor = 'pointer')
      const reset = () => (map.getCanvas().style.cursor = '')
      for (const id of ['route-risk', 'checkpoints', 'stops']) {
        map.on('mouseenter', id, pointer)
        map.on('mouseleave', id, reset)
      }
      map.on('click', 'route-risk', (event) => {
        const name = event.features?.[0]?.properties.route
        if (name) onSelectRef.current(name)
      })
      map.on('click', 'checkpoints', (event) => showCheckpoint(map, event, planRef.current))
      map.on('click', 'stops', (event) => showStop(map, event, planRef.current))
      setReady(true)
    })
    return () => map.remove()
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    source(map, SOURCES.routes).setData(plan ? routeFeatures(plan) : empty())
    source(map, SOURCES.checkpoints).setData(plan ? checkpointFeatures(plan) : empty())
    source(map, SOURCES.stops).setData(plan ? stopFeatures(plan) : empty())
    if (!plan) return
    const bounds = new LngLatBounds()
    for (const route of plan.routes) {
      for (const segment of route.segments) for (const point of segment.coordinates) bounds.extend(point)
    }
    map.fitBounds(bounds, { padding: { top: 80, bottom: 220, left: 200, right: 120 }, duration: 800 })
  }, [plan, ready])

  // Route summary tickets and the two place pins, rebuilt for each new plan.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    for (const { marker } of labelsRef.current) marker.remove()
    for (const pin of pinsRef.current) pin.remove()
    labelsRef.current = []
    pinsRef.current = []
    if (!plan) return
    labelsRef.current = plan.routes.map((route) => {
      const element = routeLabel(route, route.name === plan.recommended, () =>
        onSelectRef.current(route.name),
      )
      const marker = new Marker({ element, anchor: 'left', offset: [12, 0] })
        .setLngLat(labelAnchor(route))
        .addTo(map)
      return { name: route.name, marker }
    })
    const first = plan.routes[0]
    const lastSegment = first.segments[first.segments.length - 1]
    if (places) {
      pinsRef.current = [
        new Marker({ element: placePin(places.origin, 'origin'), anchor: 'left', offset: [-7, 0] })
          .setLngLat(first.segments[0].coordinates[0])
          .addTo(map),
        new Marker({ element: placePin(places.destination, 'destination'), anchor: 'left', offset: [-7, 0] })
          .setLngLat(lastSegment.coordinates[lastSegment.coordinates.length - 1])
          .addTo(map),
      ]
    }
  }, [plan, places, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const style = selectionStyle(selectedRoute)
    map.setLayoutProperty('route-casing', 'line-sort-key', style.sortKey)
    map.setPaintProperty('route-casing', 'line-width', style.casingWidth)
    map.setPaintProperty('route-casing', 'line-opacity', style.casingOpacity)
    map.setLayoutProperty('route-risk', 'line-sort-key', style.sortKey)
    map.setPaintProperty('route-risk', 'line-width', style.lineWidth)
    map.setPaintProperty('route-risk', 'line-opacity', style.lineOpacity)
    map.setPaintProperty('checkpoints', 'circle-opacity', style.pointOpacity)
    map.setPaintProperty('checkpoints', 'circle-stroke-opacity', style.pointOpacity)
    map.setFilter('stops', style.filter)
    map.setPaintProperty('trucks', 'circle-color', style.truckColor)
    map.setPaintProperty('trucks', 'circle-radius', style.truckRadius)

    // Layer toggles: the heatmap and checkpoints by visibility, other routes by filter.
    map.setLayoutProperty('corridor-heat', 'visibility', shown.heatmap ? 'visible' : 'none')
    map.setLayoutProperty('checkpoints', 'visibility', shown.checkpoints ? 'visible' : 'none')
    const onlySelected = shown.otherRoutes ? null : style.filter
    for (const id of ['route-casing', 'route-risk', 'checkpoints', 'trucks', 'truck-labels']) {
      map.setFilter(id, onlySelected)
    }
    for (const { name, marker } of labelsRef.current) {
      setLabelSelected(marker.getElement(), name === selectedRoute)
      marker.getElement().style.display = shown.otherRoutes || name === selectedRoute ? '' : 'none'
    }
  }, [selectedRoute, shown, plan, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    source(map, SOURCES.heat).setData(heatmap ? heatFeatures(heatmap) : empty())
    if (heatmap?.points.length) map.setPaintProperty('corridor-heat', 'heatmap-radius', heatRadius(heatmap))
  }, [heatmap, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    if (heatmap) map.setPaintProperty('corridor-heat', 'heatmap-weight', heatWeight(hour, heatmap.hours))
    source(map, SOURCES.trucks).setData(plan ? truckFeatures(plan, hour) : empty())
  }, [hour, heatmap, plan, ready])

  useEffect(() => {
    if (focus && mapRef.current) {
      mapRef.current.flyTo({
        center: focus.position,
        zoom: Math.max(mapRef.current.getZoom(), 8),
        duration: 700,
      })
    }
  }, [focus])

  return <Box ref={containerRef} sx={{ position: 'absolute', inset: 0 }} />
}

/**
 * Quiets the basemap so the routes and the heatmap carry the color: the palette's grays for
 * land and water, no small-town or minor labels, and interstates kept legible with their shields.
 */
function quietBasemap(map: MapLibreMap) {
  const has = (id: string) => Boolean(map.getLayer(id))
  for (const id of [
    'label_other',
    'label_village',
    'landcover_wood',
    'landcover_ice_shelf',
    'landcover_glacier',
    'park',
  ]) {
    if (has(id)) map.setLayoutProperty(id, 'visibility', 'none')
  }
  if (has('background')) map.setPaintProperty('background', 'background-color', '#eef0f0')
  if (has('water')) map.setPaintProperty('water', 'fill-color', '#cdd5d9')
  if (has('highway_motorway_casing')) map.setPaintProperty('highway_motorway_casing', 'line-color', '#b4b9bd')
  if (has('highway_motorway_inner')) map.setPaintProperty('highway_motorway_inner', 'line-color', '#ffffff')
}

function source(map: MapLibreMap, id: string): GeoJSONSource {
  return map.getSource(id) as GeoJSONSource
}

function showCheckpoint(map: MapLibreMap, event: MapLayerMouseEvent, plan: TripPlan | null) {
  const properties = event.features?.[0]?.properties
  const route = plan?.routes.find((r) => r.name === properties?.route)
  const checkpoint = route?.checkpoints[properties?.index]
  if (!plan || !route || !checkpoint) return
  const drivers = (['wind', 'rain', 'snow'] as const)
    .filter((condition) => checkpoint.levels[condition] === checkpoint.level && checkpoint.level !== 'low')
    .join(' and ')
  const lines = [
    `Route ${route.name} · mile ${Math.round(checkpoint.mile)}`,
    `${LEVEL_LABEL[checkpoint.level]}${drivers ? ` (${drivers})` : ''}`,
    `ETA ${formatTime(checkpoint.eta, plan.timezone)}`,
    `Wind ${checkpoint.wind_mph} mph, gusts ${checkpoint.gust_mph} mph`,
    `Rain ${checkpoint.rain_in_per_hr} in/h · Snow ${checkpoint.snow_in_per_hr} in/h`,
  ]
  popup(map, checkpoint.position, lines)
}

function showStop(map: MapLibreMap, event: MapLayerMouseEvent, plan: TripPlan | null) {
  const properties = event.features?.[0]?.properties
  const route = plan?.routes.find((r) => r.name === properties?.route)
  const stop = route?.stops[properties?.index]
  if (!plan || !route || !stop) return
  popup(map, stop.position, [
    `Route ${route.name} · mile ${Math.round(stop.mile)}`,
    stop.kind === 'rest' ? '10-hour rest' : '30-minute break',
    `${formatClock(stop.start, plan.timezone)} – ${formatTime(stop.end, plan.timezone)}`,
  ])
}

function popup(map: MapLibreMap, at: LonLat, lines: string[]) {
  // Built from text nodes, so nothing from the API is ever parsed as HTML.
  const content = document.createElement('div')
  content.style.font = '12.5px/1.5 "Overpass Mono", ui-monospace, monospace'
  content.style.color = '#22232a'
  lines.forEach((text, index) => {
    const line = document.createElement('div')
    line.textContent = text
    if (index < 2) line.style.fontWeight = '600'
    content.append(line)
  })
  new Popup({ closeButton: true, maxWidth: '280px' }).setLngLat(at).setDOMContent(content).addTo(map)
}
