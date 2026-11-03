import { createTheme } from '@mui/material/styles'

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1f4e79' },
    background: { default: '#f4f5f7', paper: '#ffffff' },
    text: { primary: '#1b2430', secondary: '#5b6573' },
    divider: '#e3e6ea',
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif',
    h1: { fontSize: '1.15rem', fontWeight: 700, letterSpacing: '-0.01em' },
    h2: { fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' },
    body2: { fontSize: '0.84rem' },
    caption: { fontSize: '0.74rem' },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { textTransform: 'none', fontWeight: 600 } },
    },
    MuiToggleButton: {
      styleOverrides: { root: { textTransform: 'none', fontWeight: 600, paddingBlock: 6 } },
    },
    MuiTextField: { defaultProps: { size: 'small', fullWidth: true } },
    MuiPaper: { defaultProps: { elevation: 0 } },
    MuiChip: { styleOverrides: { root: { fontWeight: 600 } } },
  },
})
