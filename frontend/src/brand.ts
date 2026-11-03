// The scale-house world, kept businesslike: concrete-gray ground, an asphalt
// sign band, white ticket paper with one ink, scale-house yellow as the signal
// accent, and stamp red kept for the one action that commits and the verdict.

export const color = {
  ground: '#e4e6e7',
  groundDeep: '#d3d6d8',
  signal: '#f2c230',
  asphalt: '#1d1f21',
  asphaltSoft: '#33363a',
  paper: '#ffffff',
  paperShade: '#f0f1ef',
  ink: '#22232a',
  inkSoft: '#575a63',
  inkFaint: '#8a8d94',
  rule: '#cfd2d4',
  stamp: '#c8312b',
  stampDeep: '#a52620',
} as const

export const font = {
  sign: '"Barlow Condensed", "Arial Narrow", sans-serif',
  body: '"Overpass", "Segoe UI", system-ui, sans-serif',
  ticket: '"Overpass Mono", ui-monospace, Consolas, monospace',
} as const

/** Display headings: Overpass heavy, sentence case. Highway-sign caps stay in small labels. */
export const display = {
  fontFamily: font.body,
  fontWeight: 800,
  letterSpacing: '-0.02em',
  lineHeight: 1.05,
} as const
