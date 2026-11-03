import Box from '@mui/material/Box'
import {
  LngLatBounds,
  Map as MapLibreMap,
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

// MapLibre finds its worker next to its own module, which breaks once Vite
// bundles it; pointing at the file Vite emits fixes dev and production builds.
setWorkerUrl(workerUrl)

// OpenFreeMap needs no API key and has no usage limits.
const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/positron'

const CONTINENTAL_US: LngLatBoundsLike = [
  [-125, 24],
  [-66, 50],
]

type Props = {
  plan: TripPlan | null
  heatmap: Heatmap | null
  hour: number
  selectedRoute: string
  focus: { position: LonLat; key: number } | null
  onSelectRoute: (name: string) => void
}

export function TripMap({ plan, heatmap, hour, selectedRoute, focus, onSelectRoute }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [ready, setReady] = useState(false)
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
      attributionControl: {
        compact: true,
        customAttribution:
          '<a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather by Open-Meteo.com</a> · Routes © TomTom',
      },
    })
    mapRef.current = map
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')

    map.on('load', () => {
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
    map.fitBounds(bounds, { padding: { top: 60, bottom: 180, left: 60, right: 60 }, duration: 800 })
  }, [plan, ready])

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
  }, [selectedRoute, ready])

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
