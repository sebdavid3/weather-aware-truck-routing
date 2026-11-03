# Weather-Aware Truck Routing

A React + Django app that helps a truck driver pick the safest of three routes. It checks the forecast at each checkpoint for the hour the truck gets there, applies the load-weight rules, and recommends a route that balances weather risk and travel time.

**Live app:** _link added at deployment_ · **Walkthrough:** _Loom link_

## What it does

The app is branded **Haulcast**. The landing page at `/` explains it and holds the trip form; the planner at `/plan` shows the results.

1. You enter an origin, a destination, a departure time and the load weight. You can also pick the checkpoint spacing (10, 25 or 50 miles) and include the federal hours-of-service rest breaks.
2. TomTom returns up to three distinct truck routes.
3. Each route gets checkpoints at its start, every N miles and at its end. Each checkpoint has an ETA from TomTom's travel times, plus rest stops if you included them.
4. Open-Meteo gives the hourly forecast at each checkpoint, sampled at the hour the truck arrives.
5. Each checkpoint is classified Low to No Travel by wind, rain, snow and the load rules.
6. Routes are ranked by No Travel miles, Severe miles, High miles, average risk and travel time, in that order. The app explains which criterion decided.
7. The map shows every route colored by risk, the checkpoints and the stops. A heatmap shows corridor risk for 0–48 hours after departure, with a slider and playback. The trucks' positions move with the slider.

## Design decisions

The brief leaves several things open. Each decision and its reason is in [docs/weather-risk-decisions.md](docs/weather-risk-decisions.md). The main ones:

- **Rain is `rain + showers`, not `precipitation`.** Open-Meteo's `precipitation` already includes snow as water, so snow would count twice.
- **Threshold edges:** lower bounds are inclusive and No Travel is strict for rain and snow. So 1.00 in/h of rain is Severe, and 34.5 mph of wind (between the brief's integer ranges) is Moderate.
- **Which forecast hour a checkpoint uses:** rain, snow and gusts are totals over the preceding hour, so a checkpoint takes the value stamped at the end of the hour that contains its ETA. Wind is instantaneous, so it is interpolated within that hour.
- **Time zones:** the departure is local time at the origin. All math runs in UTC, and times are shown in the origin's zone. A test covers the 1 November DST change.
- **Ranking at display precision:** criteria are compared at the precision the UI shows (whole miles, average risk to 1 decimal). Without this, average risk almost never ties and travel time would never count. No Travel miles come first: the brief's list leaves them out, but a route with No Travel miles must not beat one whose worst level is Severe.
- **Load weight is not sent to TomTom.** Its `vehicleWeight` is gross vehicle weight; the brief's load weight drives the risk rules only.
- **Rest breaks are optional and off by default,** so the default ETAs match the brief. Turning them on moves later checkpoints to other hours, and often to other weather.

## Staying inside free API limits

Open-Meteo counts each coordinate as one call, and its free limits (600/minute, 5,000/hour, 10,000/day) are per server IP. [docs/api-usage.md](docs/api-usage.md) has the details:

- Points snap to a 0.05° grid. Routes that share a road share forecasts, and the cache keeps each cell's day for an hour.
- One search uses at most 400 checkpoint cells plus 150 heatmap points, under the per-minute limit. A longer trip at 10-mile spacing gets a clear 422 that suggests a longer interval.
- A 429 is never retried; the API answers 503 with `Retry-After`. Timeouts and 5xx get one retry.
- TomTom is asked for 2 alternatives, not 5. Measured on four trips, that gave the same three routes in half the time.

## Architecture

```
frontend/  React 19 + TypeScript + MUI + MapLibre (Vite)
backend/   Django 6 + DRF, no database
  planner/
    risk.py        thresholds and load rules (pure)
    ranking.py     route summaries, order and explanations (pure)
    trip.py        checkpoints, ETAs, rest stops, time zones (pure)
    geometry.py    distances, positions, simplification (pure)
    weather.py     Open-Meteo client: cells, cache, batches, sampling
    routing.py     TomTom client: truck routes, distinct alternatives, detours
    geocoding.py   TomTom Search for the place fields
    corridor.py    heatmap lattice
    planning.py    puts the pieces together for the endpoints
    views.py       HTTP: POST /api/routes, POST /api/heatmap, GET /api/places
```

The domain modules know nothing about HTTP or Django, and the clients take their HTTP client and cache as arguments. That keeps the tests fast and offline.

In production Django serves the built frontend with WhiteNoise, so the app and its API share one origin and need no CORS.

## Run locally

Requirements: [uv](https://docs.astral.sh/uv/), Node.js 22+ and a free [TomTom API key](https://developer.tomtom.com/) with the Routing and Search APIs.

```bash
cd backend
cp .env.example .env    # then set TOMTOM_API_KEY
uv run python manage.py runserver
```

```bash
cd frontend
npm install
npm run dev             # http://localhost:5173, proxies /api to Django
```

## Tests and checks

```bash
cd backend && uv run pytest && uv run ruff check . && uv run ruff format --check .
```

```bash
cd frontend && npm run lint && npm run format:check && npm run build
```

The backend suite has about 140 tests. It covers every threshold edge, the load rules, the sampling hours, the DST change, rest-break ETAs, ranking and explanations, the clients' cache, batching and error handling, and the endpoints. The tests run against fake Open-Meteo and TomTom servers and never touch the network.

## Deploy

The `Dockerfile` builds the frontend and runs Django with gunicorn: one process with threads, so the in-memory cache is shared by all requests. `render.yaml` describes a Render web service. Set `TOMTOM_API_KEY` in the host's environment; `DJANGO_SECRET_KEY` and `DJANGO_ALLOWED_HOSTS` are required when `DJANGO_DEBUG` is not `true`.

## Limitations and next steps

- Rest stops happen wherever the truck reaches its hours limit. A real planner would look for truck stops.
- Free hosting shares outbound IPs, which can hit Open-Meteo's per-IP limits sooner. A paid Open-Meteo key or a dedicated IP fixes that.
- The cache lives in memory, so it resets on restart. With more than one server process it would move to Redis.
- Hourly forecasts lose skill after a few days, so departures are limited to the next 7 days.

## Attribution

Weather data by [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0). Routing and search by TomTom. Map tiles by [OpenFreeMap](https://openfreemap.org/), with data © OpenMapTiles and © OpenStreetMap contributors.
