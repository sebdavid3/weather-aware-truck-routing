# API usage and limits

How the app stays inside the free limits of the APIs it calls. The limit that binds is Open-Meteo's.

## Open-Meteo limits (measured)

- Each coordinate in a multi-location request counts as one call.
- The free limits are per IP: 600 calls/minute, 5,000/hour and 10,000/day. The backend makes every call, so all users share the server's budget.
- 350 locations × 49 hours × 5 variables took about 1.8 s and returned about 900 KB. The GET URL was about 4,200 characters.

## Three endpoints

- **`POST /api/routes/preview`** returns the routes' lines, how many checkpoint cells the trip needs and about how long their forecast will take. It fetches no weather, so the planner draws the routes within seconds and shows a real countdown while the forecast loads.
- **`POST /api/routes`** returns routes, checkpoints, risk and the recommendation. It reuses the routes the preview cached.
- **`POST /api/heatmap`** returns the forecast grid for the slider. The frontend requests it after the routes arrive, so if it hits a limit the routes are already on screen. It takes the same trip and reuses the routes from the routing cache, so it makes no routing call.

## Fewer points

- Coordinates are rounded to a 0.05° grid. Each square of that grid is a "cell", about 5.5 km on a side. Rounding moves a point less than 4 km, which is close to the forecast models' resolution.
- When the three routes share cells, each cell is fetched once.
- The heatmap grid spacing grows with the corridor, so it never has more than 150 points.

## Pacing instead of refusing

- The brief offers 10-, 25- and 50-mile checkpoints for any trip, and three coast-to-coast routes at 10 miles need about 850 cells, more than a minute's 600.
- The weather client keeps a trailing one-minute count of the locations it has requested (550 allowed, leaving room for other traffic). A batch that would go over it waits until older requests age out, so a long trip takes about a minute longer instead of failing. The server runs one process, so the count sees all of its own traffic.
- If Open-Meteo still answers with its per-minute 429, because other traffic from the same IP used part of the minute, the batch waits 60 s and is sent once more. Hourly and daily limits fail at once.
- A hard cap of 1,200 cells per search remains as a guard; no US trip at 10-mile spacing reaches it.

## Cache

- **What is cached:** each entry is keyed by (cell, UTC day) and holds that day's 24 hourly values. Entries last 1 hour, because the models update about hourly.
- **Why it saves calls:** a cell's weather on a given day doesn't depend on who asks. Changing the load weight or the spacing, or toggling rest breaks, needs few or no new calls.
- **How misses are fetched:** missing (cell, day) pairs are fetched as whole days, and cells that need the same day range share a request.
- **Where it lives:** Django's in-memory cache, with room for 20,000 entries (one search writes several hundred). The server runs one process with threads, so every request shares it. With more processes it would move to Redis.

## Requests and errors

- Each GET carries at most 300 coordinates, and at most two requests run in parallel.
- **Open-Meteo 429:** the per-minute limit is waited out once (above). The hourly and daily limits are not retried: the API returns 503 with `Retry-After` set by the limit Open-Meteo names and a message saying which one it was.
- **Timeout or 5xx:** one short retry. If that also fails, the request fails with 502, as in [weather-risk-decisions.md](weather-risk-decisions.md#missing-forecast).
- A failed fetch never gets made-up data in its place.
- Tests use recorded responses and never call the API.

## Routing and geocoding

- **Routing:** one call per search returns the main route and two alternatives. When an alternative is a near-copy, up to two more calls ask for detours. A 1-hour cache keyed by origin, destination and the requested departure avoids new calls when the load weight or rest breaks change and when the heatmap loads. The provider's terms must allow this cache.
- **Geocoding:** autocomplete is what costs calls. Requests wait 300 ms after the last keystroke, need at least 3 characters, cancel any earlier request still in flight and search only the US.
- **Keys:** routing and geocoding keys live only in the backend, which proxies those calls. The basemap (OpenFreeMap) needs no key.
- **Provider:** TomTom Routing v1 in truck mode. Calls run one after another, because six parallel requests got a 429.

## Expected usage

Example: Dallas → Chicago (about 930 miles) with 25-mile spacing.

| Search | Open-Meteo calls | What the free limits allow |
|--------|------------------|----------------------------|
| New trip, cold cache | About 100 checkpoint cells + 150 heatmap points ≈ 250 | About 2 searches/minute, 20/hour, 40/day |
| Same trip again within the hour, or another load weight | None | Practically unlimited |

## Known risk

Shared hosts such as Render send traffic from IPs that other customers also use, and Open-Meteo's terms warn that they hit the limits sooner. If 429s appear that this app didn't cause, there are two ways out: Open-Meteo's paid API with a key, or a host with its own outbound IP.
