import { createTheme } from '@mui/material/styles'
import { color, font } from './brand'

export const theme = createTheme({
  palette: {
    mode: 'light',
    // Ink is the working color; stamp red is applied by hand to the one commit action.
    primary: { main: color.asphalt, contrastText: color.signal },
    error: { main: color.stamp },
    background: { default: color.ground, paper: color.paper },
    text: { primary: color.ink, secondary: color.inkSoft },
    divider: color.rule,
  },
  shape: { borderRadius: 2 },
  typography: {
    fontFamily: font.body,
    h1: { fontFamily: font.sign, fontWeight: 800, fontSize: '2rem', lineHeight: 1, letterSpacing: '0.01em' },
    h2: {
      fontFamily: font.sign,
      fontWeight: 700,
      fontSize: '1rem',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
    },
    body2: { fontSize: '0.86rem' },
    caption: { fontSize: '0.75rem' },
    button: { fontFamily: font.sign, fontWeight: 700, letterSpacing: '0.08em' },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { borderRadius: 2 } },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          fontFamily: font.ticket,
          fontWeight: 600,
          textTransform: 'none',
          paddingBlock: 4,
          color: color.ink,
          borderColor: color.ink,
          '&.Mui-selected, &.Mui-selected:hover': { backgroundColor: color.ink, color: color.paper },
        },
      },
    },
    MuiPaper: { defaultProps: { elevation: 0 } },
    MuiAutocomplete: {
      styleOverrides: {
        paper: { fontFamily: font.ticket, border: `1px solid ${color.ink}`, borderRadius: 2 },
        option: { fontSize: '0.9rem' },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: { fontFamily: font.ticket, backgroundColor: color.asphalt, color: color.paper },
      },
    },
  },
})
