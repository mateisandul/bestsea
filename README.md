# 🌊 BestSea

Find the most comfortable sea to swim in on your holiday dates.

BestSea ranks 22 seas and lakes (52 destinations) by a **comfort score** derived
from water temperature: not raw heat. Overheating is penalized ~3× harder than
being slightly cool, so a fresh 24°C sea outranks a 28.5°C one. Users can set
their own preferred temperature, filter by region (Europe / Middle East & Gulf)
and by "international airport in town", and expand each sea into destination
cards ranked by tourism quality.

## Repository layout

```
bestsea/
├── web/       React + Vite frontend (static site, no backend required)
│   └── src/App.jsx      the whole app: data, comfort math, UI, legal pages
├── server/    Optional Express API (serves the same data + math over HTTP)
│   ├── server.js        endpoints, security middleware, validation
│   ├── lib/climate.js   interpolation + comfort curve (mirrors frontend)
│   └── data/bestsea-seed.json   climatology seed dataset
├── LICENSE    MIT: put your name in
└── README.md
```

## Quick start

**Frontend** (this alone is a fully working site):

```bash
cd web
npm install
npm run dev        # local dev at http://localhost:5173
npm run build      # production build in web/dist/
```

**Backend** (optional):

```bash
cd server
npm install
npm start          # API at http://localhost:3000
```

## Deploying

- **Frontend**: any static host. Vercel/Netlify: point at `web/`, build command
  `npm run build`, output `dist/`. Done: the site works standalone because the
  data and math are embedded.
- **Backend** (when you want it): Render / Fly.io / Railway, root `server/`,
  start command `npm start`. Set `CORS_ORIGIN` to your frontend's domain.
  Endpoints are documented in `server/README.md`.

## How the ranking works

- Water temps are **long-term monthly climatology averages** (NOAA OISST
  style), interpolated day-by-day across the selected date range.
- Comfort curve: ±1°C around the preferred temp (default 26.5°C) scores 100;
  cooler loses 5 pts/°C for 2.5°, then 10 pts/°C; warmer loses 14 pts/°C.
- Bands: Perfect · Fresh but great · Warm · Bathwater · Bracing · Cold -
  all shift with the user's preferred temperature.
- Destinations within a sea rank by editorial tourism score
  (infrastructure 25%, food/sights/safety 20% each, flight access 15%).

## ⚠️ Before you actually launch

1. **Data**: temperatures are hand-curated approximations, clearly marked with
   TODOs. Replace with real NOAA OISST v2.1 climatology (free) before claiming
   accuracy. The seed JSON documents the exact conventions to regenerate.
2. **Legal**: the Terms/Privacy/Disclaimer texts are sensible placeholders -
   get a lawyer's review, add your operator identity & contact (an Impressum is
   legally required in e.g. Germany), governing law, and effective dates.
3. **Consent**: the app currently sets no cookies and sends no analytics. If
   you add real analytics, load the script **only after** consent: the gate
   already stores the choice in `localStorage` under `bestsea:consent`.
4. **Privacy claims**: `web` stores everything locally; `server` stores no
   personal data (no IPs, no user agents). Keep it that way, or update the
   privacy policy when it changes.
5. **Fonts**: the app loads Bricolage Grotesque / Instrument Sans from Google
   Fonts, which sends visitor IPs to Google (a German court has treated this as
   a GDPR issue). For an EU launch, self-host the font files (e.g. via
   Fontsource) and remove the @import. The privacy policy currently discloses
   the Google Fonts request honestly.
6. **Airport/tourism data**: editorial judgments: review them (e.g. the
   "intl airport in town" bar is deliberately strict: Constanța's small CND
   doesn't qualify).

## License

MIT: see [LICENSE](LICENSE). Rename, reskin, launch. 🚀
