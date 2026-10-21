# API Pulse

API Pulse is a React/Vite dashboard backed by FastAPI, SQLAlchemy, and SQLite.
The frontend makes checks on demand, the API saves each received result, and
the dashboard displays recent saved history.

## Features

- Backend availability indicator and database readiness endpoint.
- Single website checks and batches of up to 10 URLs.
- Response categories: HTTP 2xx/3xx are healthy, 4xx are degraded, 5xx are
  down, and checks without an HTTP response are shown as no response.
- Summary metrics and recent history with URL search, response filtering,
  response-time sorting, pagination, and CSV export.
- Light, dark, and system themes, a responsive layout, keyboard-visible focus,
  a skip link, and status labels that do not rely on color alone.
- Real website examples in the batch form; the results are live only when a
  user runs the check.

## Deploy the backend to Render

1. Push this repository to GitHub.
2. In Render, create a **Blueprint** from the repository. Render reads
   `render.yaml` and installs the backend dependencies from
   `requirements-render.txt`.
3. The persistent disk requires a paid Render web-service plan. Keep the disk
   mounted at `/var/data`; the database is stored at
   `/var/data/health_monitor.db`.
4. Wait for the service deployment to finish. Copy the service's public URL
   from Render; this Blueprint defines a service named `api-pulse-api`, so its
   URL may differ from an already deployed Render service. Verify the service
   root, `/ready`, and `/docs` load, then test `/health/history`.

The default production frontend origin is
`https://api-pulse-peach.vercel.app`. If the frontend uses a different or
custom domain, update `FRONTEND_ORIGINS` in the Render service settings with
the exact origin(s), separated by commas, and redeploy the API.

## Deploy the frontend to Vercel

1. Import the same GitHub repository into Vercel.
2. Set **Root Directory** to `frontend`. Vercel should detect Vite; use
   `npm run build` as the build command and `dist` as the output directory.
3. Add the environment variable `VITE_API_URL` with the URL of the deployed
   Render service, using the exact public URL copied from Render.
   Configure it for Production (and Preview too if previews should use the
   production API).
4. Deploy or redeploy the frontend after setting the variable.

The frontend uses the local FastAPI URL during development and the configured
`VITE_API_URL` in deployment. Its production fallback is the Render URL above.

## Verify the connection

1. Open the Render service root; it should report that the API is running.
2. Open `https://<your-render-service>/health/history`; it should return JSON.
3. Open the Vercel site and confirm the API status shows **Online**.
4. Run one single-site check and one batch check, then refresh history.
5. Run another check after a Render redeploy and confirm previous rows remain.
   This confirms the database is using the persistent disk.

The batch form starts with Google, Wikipedia, YouTube, Amazon, Apple,
Microsoft, and Netflix as example sites. These are editable, and each check
reports the live result at the time you run it.

## Local development

From the repository root, install the backend dependencies and start FastAPI:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-render.txt
uvicorn scripts.main:app --reload
```

In a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

The backend defaults to a local SQLite file. Set `DATABASE_URL` to change its
location, and set `FRONTEND_ORIGINS` to a comma-separated list of browser
origins allowed to call the API.

## API and safety notes

- `GET /` is the liveness endpoint. `GET /ready` checks database connectivity
  and returns HTTP 503 if the database is unavailable.
- `GET /health?url=...`, `POST /health/batch`, and
  `GET /health/history?limit=...` provide the check and history operations.
- Outbound checks accept HTTP/HTTPS URLs, reject embedded credentials and
  non-public IP/DNS destinations, disable environment proxy use, limit
  redirects, and validate each redirect destination. Batch work is limited to
  five concurrent checks.
- DNS is validated immediately before each HTTP request, but the HTTP client
  resolves the hostname again for its connection. IP pinning is not implemented,
  so DNS rebinding protection is incomplete; do not expose this API as a
  security boundary for untrusted callers.
- History search, filtering, sorting, and pagination operate on the latest 100
  records fetched by the dashboard; pagination is currently client-side.
- Theme selection is stored in browser local storage. No account/authentication
  or rate limiting is currently provided for the API or stored history. It is
  not suitable as a public, untrusted URL-checking service without additional
  access control, rate limiting, and IP-pinned outbound connections.
- History uses a horizontally scrollable data table on small screens. A
  dedicated mobile card layout, command palette, pulse strips, chart, social
  preview image, and scheduled monitoring are not implemented yet.

## Monitoring behavior

Deployment keeps the API and database on Render rather than on your laptop, so
they remain available when the laptop is off. Website checks are currently
triggered by someone using the dashboard; the app does not yet run scheduled
checks of saved websites while nobody has the dashboard open.
