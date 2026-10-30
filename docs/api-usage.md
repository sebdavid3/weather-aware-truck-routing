# API usage and limits

How the app stays inside the free limits of the APIs it calls. The limit that binds is Open-Meteo's.

## Open-Meteo limits (measured)

- Each coordinate in a multi-location request counts as one call.
- The free limits are per IP: 600 calls/minute, 5,000/hour and 10,000/day. The backend makes every call, so all users share the server's budget.
- 350 locations × 49 hours × 5 variables took about 1.8 s and returned about 900 KB. The GET URL was about 4,200 characters.

## Two endpoints

- **`POST /api/routes`** returns routes, checkpoints, risk and the recommendation.
- **`POST /api/heatmap`** returns the forecast grid for the slider. The frontend requests it after the routes arrive, so if it hits a limit the routes are already on screen. It takes the same trip and reuses the routes from the routing cache, so it makes no routing call.

## Fewer points

- Coordinates are rounded to a 0.05° grid. Each square of that grid is a "cell", about 5.5 km on a side. Rounding moves a point less than 4 km, which is close to the forecast models' resolution.
- When the three routes share cells, each cell is fetched once.
- The heatmap grid spacing grows with the corridor, so it never has more than 150 points.

## Per-search cap

- A search may use at most 400 checkpoint cells and 150 heatmap points. That totals 550, under the 600/minute limit, so a single search can't use up a minute's budget.
- The cap counts every cell, cached or not, so the same search always gets the same answer.
- A search over the cap gets a 422 suggesting 25- or 50-mile spacing. A long route at 10-mile spacing is the usual case.

## Cache

- **What is cached:** each entry is keyed by (cell, UTC day) and holds that day's 24 hourly values. Entries last 1 hour, because the models update about hourly.
- **Why it saves calls:** a cell's weather on a given day doesn't depend on who asks. Changing the load weight or the spacing, or toggling rest breaks, needs few or no new calls.
- **How misses are fetched:** missing (cell, day) pairs are fetched as whole days, and cells that need the same day range share a request.
- **Where it lives:** Django's cache API. Redis in production, local memory in development and tests.

## Requests and errors

- Each GET carries at most 300 coordinates, and at most two requests run in parallel.
- **Open-Meteo 429:** no retry. The API returns 503 with `Retry-After` set by the limit Open-Meteo names (minute, hour or day) and a message saying which one it was.
- **Timeout or 5xx:** one short retry. If that also fails, the request fails with 502, as in [weather-risk-decisions.md](weather-risk-decisions.md#missing-forecast).
- A failed fetch never gets made-up data in its place.
- Tests use recorded responses and never call the API.

## Routing and geocoding

- **Routing:** one call per search returns all three alternatives. A 1-hour cache keyed by origin and destination avoids a second call when the load weight or rest breaks change and when the heatmap loads. If the provider uses departure time for traffic, the departure is part of the key too. The provider's terms must allow this cache.
- **Geocoding:** autocomplete is what costs calls. Requests wait 300 ms after the last keystroke, need at least 3 characters, cancel any earlier request still in flight and search only the US.
- **Keys:** routing and geocoding keys live only in the backend, which proxies those calls. The basemap key is public by nature, so it is restricted by domain.
- **Provider:** the routing provider is still open (Mapbox or TomTom). This plan works with either.

## Expected usage

Example: Dallas → Chicago (about 930 miles) with 25-mile spacing.

| Search | Open-Meteo calls | What the free limits allow |
|--------|------------------|----------------------------|
| New trip, cold cache | About 100 checkpoint cells + 150 heatmap points ≈ 250 | About 2 searches/minute, 20/hour, 40/day |
| Same trip again, or another load weight | Almost none | Practically unlimited |

## Known risk

Shared hosts such as Render send traffic from IPs that other customers also use, and Open-Meteo's terms warn that they hit the limits sooner. If 429s appear that this app didn't cause, there are two ways out: Open-Meteo's paid API with a key, or a host with its own outbound IP.
