import Autocomplete from '@mui/material/Autocomplete'
import CircularProgress from '@mui/material/CircularProgress'
import TextField from '@mui/material/TextField'
import { useEffect, useState } from 'react'
import { searchPlaces, type Place } from '../api'
import { font } from '../brand'

const DEBOUNCE_MS = 300
const MIN_QUERY = 3

type Props = {
  label: string // Read by screen readers; the ticket box prints its own visible label.
  value: Place | null
  onChange: (place: Place | null) => void
  error?: string
}

/** US place search; waits for a pause in typing and cancels stale requests. */
export function PlaceField({ label, value, onChange, error }: Props) {
  const [input, setInput] = useState(value?.label ?? '')
  const [results, setResults] = useState<{ query: string; places: Place[] }>({ query: '', places: [] })
  const [searchError, setSearchError] = useState<string>()

  const query = input.trim()
  // Nothing to search while the text is short or is the chosen place itself.
  const idle = query.length < MIN_QUERY || query === value?.label
  const loading = !idle && results.query !== query
  const options = idle ? (value ? [value] : []) : results.places

  useEffect(() => {
    if (idle) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      searchPlaces(query, controller.signal)
        .then(({ places }) => {
          setResults({ query, places })
          setSearchError(undefined)
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          setResults({ query, places: [] })
          setSearchError((error as Error).message)
        })
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, idle])

  return (
    <Autocomplete
      value={value}
      inputValue={input}
      options={options}
      filterOptions={(places) => places}
      getOptionLabel={(place) => place.label}
      isOptionEqualToValue={(a, b) => a.lat === b.lat && a.lon === b.lon}
      onChange={(_, place) => onChange(place)}
      onInputChange={(_, text) => setInput(text)}
      loading={loading}
      noOptionsText={input.trim().length < MIN_QUERY ? 'Type at least 3 characters' : 'No US places found'}
      renderInput={(params) => (
        <TextField
          {...params}
          variant="standard"
          placeholder="City, address or place"
          error={Boolean(error || searchError)}
          helperText={error ?? searchError}
          slotProps={{
            ...params.slotProps,
            htmlInput: { ...params.slotProps.htmlInput, 'aria-label': label },
            input: {
              ...params.slotProps.input,
              disableUnderline: true,
              endAdornment: (
                <>
                  {loading && <CircularProgress color="inherit" size={14} />}
                  {params.slotProps.input.endAdornment}
                </>
              ),
            },
          }}
          sx={{
            '& .MuiInputBase-root': { fontFamily: font.ticket, fontWeight: 600, fontSize: '1.02rem' },
            '& .MuiFormHelperText-root': { fontFamily: font.ticket, mx: 0 },
          }}
        />
      )}
    />
  )
}
