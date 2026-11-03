import { keyframes } from '@emotion/react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { useEffect, useState } from 'react'
import type { Level } from '../api'
import { color, display, font } from '../brand'
import { LEVEL_COLOR, LEVEL_LABEL } from '../risk'
import { Stamp, StationLights, TearRule, Ticket, Wordmark } from '../ticket/Ticket'
import { TicketForm } from '../ticket/TicketForm'
import { initialDraft, type TripDraft } from '../trip/draft'

type Props = {
  onPlan: (draft: TripDraft) => void
  onOpenPlanner: () => void
}

// Synthetic: a sample of what a ticket prints, not a live forecast.
const SAMPLE: { mile: number; eta: string; wind: string; rain: string; level: Level }[] = [
  { mile: 0, eta: 'Mon 7:00 PM', wind: '11 mph', rain: '0.000', level: 'low' },
  { mile: 25, eta: 'Mon 7:38 PM', wind: '16 mph', rain: '0.000', level: 'low' },
  { mile: 50, eta: 'Mon 8:01 PM', wind: '38 mph', rain: '0.120', level: 'high' },
  { mile: 75, eta: 'Mon 8:21 PM', wind: '47 mph', rain: '0.260', level: 'no_travel' },
  { mile: 100, eta: 'Mon 8:41 PM', wind: '29 mph', rain: '0.040', level: 'moderate' },
]

const STEPS = [
  [
    'Routes',
    'Up to three routes planned for trucks, not cars. A route that copies another is swapped for a real alternative.',
  ],
  ['Checkpoints', 'One at the origin, one every 10, 25 or 50 miles, one at the destination.'],
  ['Arrival', 'Each checkpoint gets the time your truck reaches it, with rest stops when you include them.'],
  ['Forecast', 'The hourly forecast for that place at that hour: sustained wind, rain and snow.'],
  ['Load', 'Over 30,000 lb, wind from 45 mph is No Travel. Over 40,000 lb, wind from 35 mph is Severe.'],
  [
    'Verdict',
    'Fewest No Travel miles, then Severe, then High, then the lowest average risk, then the shortest time. The ticket names the one that decided.',
  ],
] as const

const THRESHOLDS: [Level, string, string, string][] = [
  ['low', 'under 25 mph', 'under 0.10 in/h', 'under 0.5 in/h'],
  ['moderate', '25 mph', '0.10 in/h', '0.5 in/h'],
  ['high', '35 mph', '0.25 in/h', '1.0 in/h'],
  ['severe', '45 mph', '0.50 in/h', '2.0 in/h'],
  ['no_travel', '55 mph', 'over 1.00 in/h', 'over 3.0 in/h'],
]

const feed = keyframes`
  from { clip-path: inset(0 0 100% 0); transform: translateY(-6px); }
  to { clip-path: inset(0 0 0 0); transform: none; }
`
const stampDown = keyframes`
  0% { opacity: 0; transform: rotate(-6deg) scale(1.6); }
  70% { opacity: 1; transform: rotate(-6deg) scale(0.96); }
  100% { opacity: 1; transform: rotate(-6deg) scale(1); }
`

export function Landing({ onPlan, onOpenPlanner }: Props) {
  const [draft, setDraft] = useState(initialDraft)

  return (
    <Box sx={{ minHeight: '100%', bgcolor: color.ground }}>
      <SignBand onOpenPlanner={onOpenPlanner} />
      <Box
        component="main"
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) minmax(0, 560px) minmax(0, 1fr)' },
          columnGap: { lg: 6 },
          px: { xs: 2, sm: 4 },
          pt: { xs: 3, md: 3 },
          pb: 6,
          alignItems: 'start',
        }}
      >
        <WallNote
          title="The weather at the hour you get there"
          sx={{ order: { xs: 2, lg: 0 }, textAlign: { lg: 'right' }, mt: { xs: 5, lg: 18 } }}
        >
          Each checkpoint is checked against the forecast for the hour your truck reaches it, not the hour you
          leave the yard.
        </WallNote>
        <Box sx={{ order: 1, width: '100%', maxWidth: 560, mx: 'auto' }}>
          <Ticket>
            <Typography
              component="h1"
              sx={{ ...display, fontSize: { xs: '2.3rem', sm: '2.65rem' }, textWrap: 'balance' }}
            >
              Weigh your route against the weather
            </Typography>
            <Typography
              sx={{
                fontFamily: font.body,
                lineHeight: 1.5,
                fontSize: '1.02rem',
                mt: 1.25,
                mb: 2.5,
                color: color.inkSoft,
                maxWidth: '56ch',
              }}
            >
              Up to three truck routes, each checked mile by mile against the forecast for when your truck is
              there, then ranked by risk and time.
            </Typography>
            <TicketForm draft={draft} onChange={setDraft} onSubmit={() => onPlan(draft)} />
            <SampleTicket />
          </Ticket>
        </Box>
        <WallNote title="Heavier load, lower wind limit" sx={{ order: 3, mt: { xs: 4, lg: 34 } }}>
          With more than 30,000 lb on board, 45 mph of wind already means No Travel. Every ticket says which
          rule decided.
        </WallNote>
      </Box>
      <HowItWeighs />
      <CloseBand onOpenPlanner={onOpenPlanner} />
    </Box>
  )
}

function SignBand({ onOpenPlanner }: { onOpenPlanner: () => void }) {
  return (
    <Box
      component="header"
      sx={{
        bgcolor: color.asphalt,
        color: color.paper,
        px: { xs: 2, sm: 4 },
        py: 1.75,
        borderBottom: `6px solid ${color.signal}`,
        display: 'flex',
        alignItems: 'center',
        gap: { xs: 2, sm: 3 },
        flexWrap: 'wrap',
      }}
    >
      <Wordmark />
      <Box
        sx={{
          fontFamily: font.sign,
          fontWeight: 700,
          letterSpacing: '0.14em',
          fontSize: '0.95rem',
          color: color.paperShade,
          display: { xs: 'none', sm: 'block' },
        }}
      >
        ALL TRIPS WEIGH THE WEATHER
      </Box>
      <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 3 }}>
        <Box sx={{ display: { xs: 'none', md: 'block' } }}>
          <StationLights labels />
        </Box>
        <Box
          component="a"
          href="/plan"
          onClick={(event: React.MouseEvent) => {
            event.preventDefault()
            onOpenPlanner()
          }}
          sx={{
            fontFamily: font.sign,
            fontWeight: 700,
            letterSpacing: '0.08em',
            color: color.signal,
            fontSize: '1.05rem',
          }}
        >
          OPEN THE PLANNER
        </Box>
      </Box>
    </Box>
  )
}

function WallNote({ title, children, sx }: { title: string; children: React.ReactNode; sx?: object }) {
  return (
    <Box
      sx={{
        maxWidth: { xs: 560, lg: 300 },
        mx: { xs: 'auto', lg: 0 },
        justifySelf: { lg: 'end' },
        mt: { xs: 4, lg: 0 },
        width: '100%',
        ...sx,
      }}
    >
      <Typography
        component="h2"
        sx={{ ...display, fontSize: '1.45rem', color: color.asphalt, textWrap: 'balance' }}
      >
        {title}
      </Typography>
      <Typography
        sx={{ fontFamily: font.body, fontSize: '1rem', lineHeight: 1.5, mt: 1, color: color.asphalt }}
      >
        {children}
      </Typography>
    </Box>
  )
}

/** The printed sample: lines feed out one by one, the stamp lands last, and a now marker walks the lines. */
function SampleTicket() {
  const [now, setNow] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setNow((index) => (index + 1) % SAMPLE.length), 1400)
    return () => clearInterval(timer)
  }, [])

  return (
    <Box aria-label="Sample ticket with synthetic data">
      <TearRule>Sample ticket · Dallas to Chicago · synthetic</TearRule>
      <Box
        sx={{
          fontFamily: font.ticket,
          fontSize: { xs: '0.78rem', sm: '0.86rem' },
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <Row head cells={['MI', 'ETA (CST)', 'WIND', 'RAIN', 'LEVEL']} />
        {SAMPLE.map((line, index) => (
          <Box
            key={line.mile}
            sx={{ animation: `${feed} 420ms cubic-bezier(.16,1,.3,1) ${300 + index * 160}ms both` }}
          >
            <Row
              now={index === now}
              passed={index < now}
              cells={[String(line.mile), line.eta, line.wind, line.rain, LEVEL_LABEL[line.level]]}
              level={line.level}
            />
          </Box>
        ))}
      </Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          mt: 1.5,
          gap: 2,
          flexWrap: { xs: 'wrap', sm: 'nowrap' },
        }}
      >
        <Typography
          sx={{ fontFamily: font.ticket, fontSize: '0.74rem', color: color.inkSoft, maxWidth: '27ch' }}
        >
          25 fewer No Travel miles than Route B. 1 h 10 min faster than Route C.
        </Typography>
        <Stamp
          sx={{
            fontSize: '1.5rem',
            flexShrink: 0,
            animation: `${stampDown} 500ms cubic-bezier(.16,1,.3,1) 1.4s both`,
          }}
        >
          Route A · recommended
        </Stamp>
      </Box>
    </Box>
  )
}

function Row({
  cells,
  head = false,
  now = false,
  passed = false,
  level,
}: {
  cells: string[]
  head?: boolean
  now?: boolean
  passed?: boolean
  level?: Level
}) {
  return (
    <Box
      sx={{
        display: 'grid',
        // Phones drop the rain column so every line stays on one row.
        gridTemplateColumns: { xs: '2.6em 1fr 4.4em 7em', sm: '3em 1fr 4.6em 4.8em 7.4em' },
        alignItems: 'center',
        columnGap: 1,
        px: 0.75,
        py: 0.6,
        borderBottom: `1px dashed ${color.rule}`,
        fontWeight: head ? 700 : 500,
        fontSize: head ? '0.68rem' : undefined,
        letterSpacing: head ? '0.08em' : undefined,
        color: now ? color.paper : head ? color.inkSoft : color.ink,
        bgcolor: now ? color.ink : 'transparent',
        opacity: passed ? 0.72 : 1,
        transition: 'opacity 400ms',
      }}
    >
      {cells.map((cell, index) => (
        <Box
          key={index}
          component="span"
          sx={{
            display: { xs: index === 3 ? 'none' : 'flex', sm: 'flex' },
            alignItems: 'center',
            gap: 0.75,
            minWidth: 0,
            whiteSpace: 'nowrap',
          }}
        >
          {index === 4 && level && (
            <Box
              component="span"
              sx={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                bgcolor: LEVEL_COLOR[level],
                flexShrink: 0,
                boxShadow: now ? `0 0 0 1.5px ${color.paper}` : 'none',
              }}
            />
          )}
          {cell}
        </Box>
      ))}
    </Box>
  )
}

function HowItWeighs() {
  return (
    <Box component="section" aria-labelledby="how-heading" sx={{ px: { xs: 2, sm: 4 }, pb: 8 }}>
      <Box sx={{ maxWidth: 760, mx: 'auto' }}>
        <Ticket sx={{ px: { xs: 2.5, sm: 5 }, pt: 4.5, pb: 4 }}>
          <Typography
            id="how-heading"
            component="h2"
            sx={{ ...display, fontSize: { xs: '1.9rem', sm: '2.3rem' } }}
          >
            How a route gets weighed
          </Typography>
          <Box component="dl" sx={{ m: 0, mt: 3 }}>
            {STEPS.map(([term, text]) => (
              <Box
                key={term}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: '9.5em 1fr' },
                  columnGap: 3,
                  py: 1.5,
                  borderTop: `1.5px dashed ${color.rule}`,
                }}
              >
                <Box
                  component="dt"
                  sx={{
                    fontFamily: font.ticket,
                    fontWeight: 700,
                    fontSize: '0.8rem',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    pt: '3px',
                  }}
                >
                  {term}
                </Box>
                <Box
                  component="dd"
                  sx={{ m: 0, fontFamily: font.body, fontSize: '1.02rem', lineHeight: 1.5, maxWidth: '62ch' }}
                >
                  {text}
                </Box>
              </Box>
            ))}
          </Box>
          <TearRule>Fine print · where each level starts</TearRule>
          <Box
            component="table"
            sx={{
              width: '100%',
              borderCollapse: 'collapse',
              fontFamily: font.ticket,
              fontSize: { xs: '0.74rem', sm: '0.84rem' },
              fontVariantNumeric: 'tabular-nums',
              '& th, & td': { textAlign: 'left', py: 0.75, pr: 1, borderBottom: `1px dashed ${color.rule}` },
              '& th': { fontSize: '0.68rem', letterSpacing: '0.08em', color: color.inkSoft },
            }}
          >
            <thead>
              <tr>
                <th>LEVEL</th>
                <th>WIND FROM</th>
                <th>RAIN FROM</th>
                <th>SNOW FROM</th>
              </tr>
            </thead>
            <tbody>
              {THRESHOLDS.map(([level, wind, rain, snow]) => (
                <tr key={level}>
                  <td>
                    <Box
                      component="span"
                      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, fontWeight: 700 }}
                    >
                      <Box
                        component="span"
                        sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: LEVEL_COLOR[level] }}
                      />
                      {LEVEL_LABEL[level]}
                    </Box>
                  </td>
                  <td>{wind}</td>
                  <td>{rain}</td>
                  <td>{snow}</td>
                </tr>
              ))}
            </tbody>
          </Box>
          <Typography sx={{ fontFamily: font.ticket, fontSize: '0.78rem', color: color.inkSoft, mt: 1.5 }}>
            A checkpoint takes the worst of its wind, rain and snow. Gusts are printed but do not set the
            level.
          </Typography>
          <TearRule>The next 48 hours</TearRule>
          <Typography sx={{ fontFamily: font.body, fontSize: '1.02rem', lineHeight: 1.5, maxWidth: '62ch' }}>
            Past the ticket, the planner paints the weather over the whole corridor for the 48 hours after you
            leave. Play it and watch each truck move along its route while storms move across it.
          </Typography>
        </Ticket>
      </Box>
    </Box>
  )
}

function CloseBand({ onOpenPlanner }: { onOpenPlanner: () => void }) {
  return (
    <Box
      component="footer"
      sx={{ bgcolor: color.asphalt, color: color.paperShade, px: { xs: 2, sm: 4 }, py: { xs: 5, sm: 6 } }}
    >
      <Box
        sx={{
          maxWidth: 760,
          mx: 'auto',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 3,
          justifyContent: 'space-between',
        }}
      >
        <Typography
          component="p"
          sx={{ ...display, fontSize: { xs: '1.9rem', sm: '2.2rem' }, color: color.paper }}
        >
          Every trip gets weighed
        </Typography>
        <Button
          onClick={onOpenPlanner}
          sx={{
            px: 3,
            py: 1.25,
            fontSize: '1.15rem',
            color: color.asphalt,
            bgcolor: color.signal,
            '&:hover': { bgcolor: '#d9ab1f' },
          }}
        >
          Open the planner
        </Button>
      </Box>
      <Typography
        sx={{
          maxWidth: 760,
          mx: 'auto',
          mt: 4,
          fontFamily: font.ticket,
          fontSize: '0.72rem',
          lineHeight: 1.6,
          color: color.inkFaint,
        }}
      >
        Weather by{' '}
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
          Open-Meteo.com
        </a>{' '}
        (CC BY 4.0). Routes and place search by TomTom. Map tiles by OpenFreeMap, data © OpenMapTiles and
        OpenStreetMap contributors. Forecasts are forecasts: check conditions before you drive.
      </Typography>
    </Box>
  )
}
