# Weather risk decisions

How the app reads the parts of the brief that are silent or ambiguous. Each rule has its reason.

## Weather inputs (Open-Meteo)

- **Rain (in/h)** = `round(rain + showers, 3)`. Not `precipitation`: it includes the water equivalent of snowfall, so snow would count twice. The rounding normalizes to the API's 3-decimal resolution.
- **Snow (in/h)** = `snowfall`, requested with `precipitation_unit=inch`.
- **Wind (mph)** = sustained `wind_speed_10m`, requested with `wind_speed_unit=mph`. Gusts are shown but not classified, because the thresholds read as sustained wind.
- **Timestamps** are requested with `timeformat=unixtime` (UTC). With an IANA `timezone`, Open-Meteo applies one fixed UTC offset to the whole response, so local labels after a DST change are off by an hour (checked for America/Chicago on 2026-11-01).

## Sampling a checkpoint at its ETA

- A checkpoint uses the hour window that contains its ETA: `[floor(ETA), floor(ETA) + 1h)`.
- **Rain and snow:** the value stamped at the end of that window, because Open-Meteo reports them as totals over the preceding hour. An ETA of 10:20 uses the 11:00 value, which covers 10:00 to 11:00.
- **Wind:** linear interpolation between the window's start and end values, because wind speed is instantaneous. The result is rounded to 1 decimal, like the API.
- The heatmap uses the same rule, so the map and the checkpoint list never disagree about the same place and time.

## Classification

Checked from the top; the first match wins.

| Level     | Wind (mph) | Rain (in/h) | Snow (in/h) |
|-----------|------------|-------------|-------------|
| No Travel | ≥ 55       | > 1.00      | > 3.0       |
| Severe    | ≥ 45       | ≥ 0.50      | ≥ 2.0       |
| High      | ≥ 35       | ≥ 0.25      | ≥ 1.0       |
| Moderate  | ≥ 25       | ≥ 0.10      | ≥ 0.5       |
| Low       | otherwise  | otherwise   | otherwise   |

The brief's integer wind ranges (25–34, 35–44) leave gaps for 1-decimal values such as 34.5, and its rain and snow ranges share endpoints. Here lower bounds are inclusive. No Travel is strict for rain and snow (`>`), so Severe includes 1.00 in/h of rain and 3.0 in/h of snow. These edges are real: 0.50 and 1.00 in/h of rain arrive exactly from the API (12.7 and 25.4 mm). 0.10 and 0.25 never do.

The load rules can only raise the wind level:

- Wind ≥ 45 and < 55 with a load > 30,000 lb → No Travel.
- Wind ≥ 35 and < 45 with a load > 40,000 lb → Severe.

A checkpoint's level is the worst of wind (after the load rules), rain and snow.

## Checkpoints and miles

- Checkpoints sit at mile 0, every N miles (N = 10, 25 or 50) and at the destination.
- Each checkpoint covers half the distance to each neighbor, so the covered miles add up to the route length.
- Average risk is the mile-weighted mean of level scores: Low 0, Moderate 1, High 2, Severe 3, No Travel 4.

## Departure time

- The departure is entered as local time at the origin, using the origin's time zone (found from its coordinates with `timezonefinder`). It is not the browser's zone, because whoever plans the trip may be somewhere else.
- A time inside the repeated fall-back hour resolves to its first occurrence (`fold=0`).
- All computation runs in UTC. ETAs are shown in the origin's time zone with its abbreviation.
- The valid departure window runs from now (15 minutes of tolerance) to now + 7 days. A departure outside it returns 400. Open-Meteo forecasts 16 days ahead, so 7 days leaves room for a long trip plus the 48 h slider, and hourly forecasts lose skill beyond a week.

## Driver rest breaks (optional)

A toggle, off by default, adds the federal hours-of-service (HOS) limits for property-carrying drivers to the ETAs. When it is off, ETAs are the routing API's driving time, as the brief describes. When it is on, long trips get the stops a real driver must take, which moves later checkpoints to other hours and other weather.

The model:

- The driver starts fresh: 10 hours off duty before departure, with the full 70-hour/8-day cycle available.
- Only driving time counts. Loading, fueling and inspections are not modeled.
- There is a 30-minute break after every 8 hours of driving.
- There is a 10-hour rest after every 11 hours of driving. The 14-hour window never binds here, because 11 h of driving plus one break is 11.5 h on duty.
- The 70-hour limit never binds either: a coast-to-coast trip is under 50 hours of driving.
- Sleeper-berth splits and the adverse driving conditions exception are not modeled.
- A stop happens wherever the truck is when it reaches the limit. The app does not look for truck stops.

ETA from driving time `d`:

```
elapsed(d) = d + 0.5 h × (breaks before d) + 10 h × (rests before d)
```

Breaks fall at driving hours 8, 19, 30, … and rests at 11, 22, 33, … "Before" is strict, so a checkpoint reached at exactly 8 h of driving gets its ETA before the break, and a trip that ends at exactly 11 h needs no rest.

- Weather is classified only at checkpoints, while the truck drives; the truck is parked during stops.
- The duration used for ranking is the total elapsed time, stops included. `elapsed` always grows with driving time, so the toggle never reverses two routes' order by duration. It can change the recommendation only through the weather at the shifted ETAs.
- Stops appear on the map and in the checkpoint timeline, with start and end times.
- The departure window stays the same. With stops, 45 h of driving takes about 87 h (3.6 days), which still ends inside the 16-day forecast.

## Missing forecast

There is no "unknown" level. Validation keeps every ETA inside the forecast. If a value is still missing (provider error, null), the request fails with 502 and a clear message instead of ranking routes with gaps.

## Recommendation

Routes are sorted ascending by this key. The sort is stable, so full ties keep the routing API's order.

```
(no_travel_miles, severe_miles, high_miles, avg_risk, duration_minutes)
```

- **No Travel miles come first.** The brief's list leaves them out, but a route with No Travel miles must not beat one whose worst level is Severe.
- **Precision:** each key is compared at the precision the UI shows: miles as whole numbers, average risk to 1 decimal, duration in minutes. A difference the user can't see doesn't decide the ranking. Without this, average risk is continuous and almost never ties, so travel time would never count, even though the brief asks to balance risk and travel time.
- **Rounding:** the backend rounds these values and sends them as they are displayed; the frontend does not round again. One rounding rule means the ranking and the display can't diverge.
- **Warning:** if the recommended route still has No Travel miles, the UI warns that no route is safe at that departure time.
- **Explanation:** the UI states the criterion that decided, for example "Same Severe miles as A; 25 fewer High miles".

## Forecast slider

- Hour 0 is the departure. The range is 0–48 h after departure, labeled with the clock time in the origin's zone.
- At slider hour `h`, every heatmap point is sampled at `departure + h` with the checkpoint rule above.

## Test cases

Classification:

| Input | Expected |
|-------|----------|
| Wind 24.9 / 25.0 | Low / Moderate |
| Wind 34.9 / 35.0 | Moderate / High |
| Wind 44.9 / 45.0 | High / Severe |
| Wind 54.9 / 55.0 | Severe / No Travel |
| Rain 0.099 / 0.10 | Low / Moderate |
| Rain 0.249 / 0.25 | Moderate / High |
| Rain 0.499 / 0.50 | High / Severe |
| Rain 1.00 / 1.004 | Severe / No Travel |
| Rain 0.252 + showers 0.248 | Severe (sum is 0.50) |
| Snow 0.49 / 0.5 | Low / Moderate |
| Snow 0.99 / 1.0 | Moderate / High |
| Snow 1.99 / 2.0 | High / Severe |
| Snow 3.0 / 3.01 | Severe / No Travel |

Load rules:

| Input | Expected |
|-------|----------|
| Wind 45.0, 30,000 lb / 30,001 lb | Severe / No Travel |
| Wind 35.0, 40,000 lb / 40,001 lb | High / Severe |
| Wind 44.9, 40,001 lb | Severe |
| Wind 34.9, 50,000 lb | Moderate |
| Wind 55.0, 0 lb | No Travel |

Time:

| Input | Expected |
|-------|----------|
| Departure 2026-10-31 22:00 America/Chicago, 6 h drive | Arrival 2026-11-01 03:00 CST (09:00 UTC) |
| Departure 2026-11-01 01:30 America/Chicago | 06:30 UTC (first occurrence, CDT) |
| ETA 10:20 | Rain from the 11:00 value; wind one third of the way from 10:00 to 11:00 |
| Departure 20 min ago / 10 min ago | 400 / accepted |
| Departure now + 7 days + 1 min | 400 |

Rest breaks:

| Input | Expected ETA after departure |
|-------|------------------------------|
| Breaks off, 8 h 01 min of driving | 8 h 01 min |
| Breaks on, 7 h 59 min / 8 h 00 min / 8 h 01 min of driving | 7 h 59 min / 8 h 00 min / 8 h 31 min |
| Breaks on, 11 h 00 min / 11 h 01 min of driving | 11 h 30 min / 21 h 31 min |
| Breaks on, 19 h 01 min of driving | 30 h 01 min |
| Breaks on, 45 h of driving | 87 h |
| Breaks on, every minute of driving from 0 to 60 h | Strictly increasing ETA |

Ranking:

| Input | Expected |
|-------|----------|
| A has 10 No Travel miles; B has 0 No Travel and 50 Severe | B |
| Same No Travel, Severe and High miles; average risk 0.82 and 0.79 (both 0.8); A is 3 h faster | A |
| Average risk 0.86 and 0.79 (0.9 and 0.8) | The 0.79 route, whatever the travel times |
