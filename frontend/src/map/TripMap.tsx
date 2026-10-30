import Box from '@mui/material/Box'
import {
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
  type LngLatBoundsLike,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { useEffect, useRef } from 'react'

// MapLibre finds its worker next to its own module, which breaks once Vite
// bundles it; pointing at the file Vite emits fixes dev and production builds.
setWorkerUrl(workerUrl)

// OpenFreeMap needs no API key and has no usage limits.
const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/positron'

const CONTINENTAL_US: LngLatBoundsLike = [
  [-125, 24],
  [-66, 50],
]

export function TripMap() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const map = new MapLibreMap({
      container: containerRef.current!,
      style: BASEMAP_STYLE,
      bounds: CONTINENTAL_US,
    })
    map.addControl(new NavigationControl(), 'top-right')
    return () => map.remove()
  }, [])

  return <Box ref={containerRef} sx={{ position: 'absolute', inset: 0 }} />
}
