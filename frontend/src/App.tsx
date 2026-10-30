import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import { useEffect, useState } from 'react'
import { fetchHealth } from './api'
import { TripMap } from './map/TripMap'

type ApiStatus = 'checking' | 'up' | 'down'

function App() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking')

  useEffect(() => {
    const controller = new AbortController()
    fetchHealth(controller.signal)
      .then(() => setApiStatus('up'))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.error(error)
          setApiStatus('down')
        }
      })
    return () => controller.abort()
  }, [])

  return (
    <Box sx={{ position: 'relative', height: '100%' }}>
      <TripMap />
      <Chip
        label={`API: ${apiStatus}`}
        color={apiStatus === 'up' ? 'success' : apiStatus === 'down' ? 'error' : 'default'}
        sx={{ position: 'absolute', top: 16, left: 16 }}
      />
    </Box>
  )
}

export default App
