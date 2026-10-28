# BestSea API

Express backend for BestSea. Serves the climatology seed dataset and computes
comfort rankings server-side with the exact same math as the frontend.

> **Data TODO:** temperatures in `data/bestsea-seed.json` are hand-curated
> climatology averages (NOAA OISST style). Swap in real OISST v2.1 basin means
> and coastal-station offsets before production use.

## Run

```bash
npm install
npm start            # listens on :3000 (or PORT env var)
```

Environment variables:

| Var           | Default | Meaning                                    |
| ------------- | ------- | ------------------------------------------ |
| `PORT`        | `3000`  | Listen port                                |
| `CORS_ORIGIN` | `*`     | Comma-separated list of allowed origins    |

## Endpoints

### `GET /api/health`
Liveness check → `{ status, version, seas }`

### `GET /api/meta`
Dataset metadata (conventions, weights, TODO note).

### `GET /api/seas`
Lightweight list of all water bodies.

### `GET /api/seas/:id`
Full record for one sea/lake, including destinations with
`geo_region` (`eu`/`me`) and `intl_airport` annotations.

### `GET /api/rankings`
The main endpoint. Computes the comfort ranking for a date range.

Query params:

| Param     | Required | Example      | Notes                                   |
| --------- | -------- | ------------ | --------------------------------------- |
| `from`    | yes      | `2026-06-11` | ISO date                                |
| `to`      | yes      | `2026-06-17` | ISO date (swapped if before `from`)     |
| `pref`    | no       | `23`         | Preferred water temp °C, 20–30, default 26.5 |
| `region`  | no       | `eu`         | `all` \| `eu` \| `me`                   |
| `airport` | no       | `true`       | Only destinations with an intl airport in town |

Example:

```bash
curl "http://localhost:3000/api/rankings?from=2026-06-11&to=2026-06-17&region=eu&airport=true"
```

Response: seas sorted by `comfort` descending, each with `water_temp_c`, `band`
(Perfect / Fresh but great / Warm / Bathwater / Bracing / Cold) and its
destinations sorted by `tourism_score`. Seas with no destinations matching the
filters are omitted.

### `POST /api/consent`
Anonymous consent record (GDPR-style). Body: `{ "analytics": false, "version": "1.0" }`.
Deliberately stores **no** IP, user agent or identifiers: just the boolean,
version and timestamp, appended to `data/consent-log.jsonl`.

## Security measures

- **helmet**: secure HTTP headers (CSP, no-sniff, frame denial, etc.)
- **Rate limiting**: 100 req / 15 min per IP globally; 5 req / min on consent
- **CORS**: locked to `CORS_ORIGIN` in production
- **Input validation**: strict ISO dates, bounded `pref`, enum `region`; bad input → 400 with reasons
- **Body limit**: JSON bodies capped at 10 kB
- **No leaks**: stack traces logged server-side only; clients get generic 500s; `x-powered-by` disabled
- **Anonymous by design**: the only POST endpoint stores no personal data

## Wiring the frontend

Deploy anywhere Node runs (Render, Fly.io, Railway, a VPS). Then replace the
frontend's embedded `SEAS` array with a fetch:

```js
const res = await fetch(`${API_URL}/api/rankings?from=${from}&to=${to}&pref=${pref}&region=${region}&airport=${airportOnly}`);
const { rankings } = await res.json();
```

Set `CORS_ORIGIN` to the frontend's origin when you do.
