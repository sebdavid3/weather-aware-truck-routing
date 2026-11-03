// HTML markers drawn over the map: each route's summary ticket, and the trip's two ends.
// Built from text nodes, so nothing from the API is ever parsed as HTML.

import type { LonLat, RoutePlan } from '../api'
import { color } from '../brand'
import { formatDuration } from '../format'

const TICKET_FONT = '600 12px/1.35 "Overpass Mono", ui-monospace, monospace'

/** A small ticket with the route's letter, miles and time; clicking it selects the route. */
export function routeLabel(route: RoutePlan, recommended: boolean, onSelect: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.setAttribute('aria-label', `Select route ${route.name}`)
  Object.assign(button.style, {
    font: TICKET_FONT,
    padding: '5px 8px',
    border: `1.5px solid ${color.ink}`,
    borderRadius: '2px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    textAlign: 'left',
    boxShadow: '0 4px 10px -4px rgba(29,31,33,.45)',
  })
  const title = document.createElement('div')
  title.textContent = `Route ${route.name} · ${route.distance_miles.toLocaleString('en-US')} mi · ${formatDuration(route.duration_minutes)}`
  button.append(title)
  if (recommended) {
    const tag = document.createElement('div')
    tag.textContent = 'RECOMMENDED'
    Object.assign(tag.style, {
      color: color.stamp,
      fontWeight: '700',
      fontSize: '10px',
      letterSpacing: '0.08em',
    })
    button.append(tag)
  }
  button.addEventListener('click', (event) => {
    event.stopPropagation()
    onSelect()
  })
  return button
}

/** Restyle a route label for the current selection. */
export function setLabelSelected(element: HTMLElement, selected: boolean) {
  Object.assign(element.style, {
    background: selected ? color.asphalt : color.paper,
    color: selected ? color.signal : color.ink,
    borderColor: selected ? color.asphalt : color.ink,
    zIndex: selected ? '2' : '1',
  })
}

/** A pin for the origin or the destination, with the place's name beside it. */
export function placePin(label: string, end: 'origin' | 'destination'): HTMLDivElement {
  const pin = document.createElement('div')
  Object.assign(pin.style, { display: 'flex', alignItems: 'center', gap: '6px', pointerEvents: 'none' })
  const dot = document.createElement('div')
  Object.assign(dot.style, {
    width: '14px',
    height: '14px',
    borderRadius: end === 'origin' ? '50%' : '2px',
    background: color.asphalt,
    border: `3px solid ${color.signal}`,
    boxSizing: 'border-box',
  })
  const name = document.createElement('div')
  name.textContent = `${end === 'origin' ? 'From' : 'To'} ${label}`
  Object.assign(name.style, {
    font: '700 12px/1 "Overpass", system-ui, sans-serif',
    color: color.asphalt,
    background: color.paper,
    padding: '4px 6px',
    borderRadius: '2px',
    boxShadow: '0 2px 6px -2px rgba(29,31,33,.4)',
    whiteSpace: 'nowrap',
  })
  pin.append(dot, name)
  return pin
}

/** Where a route's label sits: its middle checkpoint, the stretch where routes are most apart. */
export function labelAnchor(route: RoutePlan): LonLat {
  return route.checkpoints[Math.floor(route.checkpoints.length / 2)].position
}
