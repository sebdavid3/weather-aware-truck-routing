# Weather-Aware Truck Routing

A React + Django app that recommends the safest truck route between two US locations, based on the forecast along each route, the load weight and travel time.

## Run locally

Requirements: [uv](https://docs.astral.sh/uv/) and Node.js 22 or later.

Backend (http://127.0.0.1:8000):

```bash
cd backend
cp .env.example .env
uv run python manage.py runserver
```

Frontend (http://localhost:5173, proxies `/api` to the backend):

```bash
cd frontend
npm install
npm run dev
```

## Checks

```bash
cd backend && uv run pytest && uv run ruff check . && uv run ruff format --check .
```

```bash
cd frontend && npm run lint && npm run build
```

## Design notes

- [Weather risk decisions](docs/weather-risk-decisions.md)
- [API usage and limits](docs/api-usage.md)
