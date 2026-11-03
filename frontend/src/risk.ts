import type { Level } from './api'

export const LEVELS: Level[] = ['low', 'moderate', 'high', 'severe', 'no_travel']

export const LEVEL_LABEL: Record<Level, string> = {
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  severe: 'Severe',
  no_travel: 'No Travel',
}

// Green to purple; each step stays distinguishable for common color blindness
// because lightness falls as risk rises.
export const LEVEL_COLOR: Record<Level, string> = {
  low: '#3a9d5d',
  moderate: '#e9b949',
  high: '#ec7c2e',
  severe: '#d03b3b',
  no_travel: '#6b2a8c',
}

export const levelFromIndex = (index: number): Level => LEVELS[index]
