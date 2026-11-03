import Box from '@mui/material/Box'
import { color, font } from '../brand'

export type MapLayers = { heatmap: boolean; checkpoints: boolean; otherRoutes: boolean }

const OPTIONS: { key: keyof MapLayers; label: string }[] = [
  { key: 'heatmap', label: 'Corridor heatmap' },
  { key: 'checkpoints', label: 'Checkpoints' },
  { key: 'otherRoutes', label: 'Other routes' },
]

/** Show or hide the map's layers, so each one can be read on its own. */
export function LayerToggles({
  layers,
  onChange,
}: {
  layers: MapLayers
  onChange: (layers: MapLayers) => void
}) {
  return (
    <Box
      component="fieldset"
      sx={{
        position: 'absolute',
        top: 12,
        left: 12,
        m: 0,
        px: 1.5,
        py: 1,
        border: 0,
        bgcolor: color.paper,
        boxShadow: '0 6px 14px -6px rgba(29,31,33,.35)',
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        fontFamily: font.ticket,
        fontSize: '0.74rem',
      }}
    >
      <Box
        component="legend"
        sx={{ p: 0, mb: 0.25, fontSize: '0.62rem', letterSpacing: '0.1em', color: color.inkSoft }}
      >
        MAP LAYERS
      </Box>
      {OPTIONS.map(({ key, label }) => (
        <Box
          component="label"
          key={key}
          sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer' }}
        >
          <Box
            component="input"
            type="checkbox"
            checked={layers[key]}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              onChange({ ...layers, [key]: event.target.checked })
            }
            sx={{ m: 0, width: 15, height: 15, accentColor: color.ink }}
          />
          {label}
        </Box>
      ))}
    </Box>
  )
}
