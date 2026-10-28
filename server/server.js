/**
 * BestSea API: Express backend
 * Serves the climatology seed data and computes comfort rankings
 * server-side, mirroring the frontend math exactly.
 */

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const fs = require("fs");
const path = require("path");

const { DEFAULT_PREF, rangeAvg, comfort, band, withOffset } = require("./lib/climate");

// ---------- data ----------
const SEED = JSON.parse(
  fs.readFileSync(path.join(__dirname, "data", "bestsea-seed.json"), "utf-8")
);

// region per country (eu = Europe, me = Middle East & Gulf)
const REGION = {
  Greece: "eu", "Türkiye": "eu", Italy: "eu", Croatia: "eu", Montenegro: "eu",
  France: "eu", Spain: "eu", Cyprus: "eu", Bulgaria: "eu", Romania: "eu",
  Georgia: "eu", Poland: "eu", Germany: "eu", Lithuania: "eu", Netherlands: "eu",
  Portugal: "eu", Switzerland: "eu", Hungary: "eu",
  Egypt: "me", Jordan: "me", Oman: "me", UAE: "me", Qatar: "me",
};

// international airport in/right by the resort town (null = doesn't qualify)
const AIRPORT = {
  "Cyclades": "JMK · JTR", "Halkidiki": null, "Bodrum & Çeşme": "BJV", "Crete (north)": "HER · CHQ",
  "Ionian Islands": "CFU · ZTH", "Salento": null,
  "Dalmatia": "SPU · DBV", "Riviera Romagnola": "RMI", "Budva Riviera": "TIV",
  "Amalfi Coast & Capri": null, "Sardinia": "OLB · CAG", "Northern Sicily": "PMO",
  "Côte d'Azur": "NCE", "Portofino & Cinque Terre": null,
  "Mallorca & Ibiza": "PMI · IBZ", "Costa Blanca": "ALC", "Costa Brava": "GRO",
  "Costa del Sol": "AGP", "Almería coast": "LEI",
  "Turkish Riviera": "AYT", "Paphos & Ayia Napa": "PFO · LCA", "North Coast": "DBB",
  "Bulgarian Riviera": "VAR · BOJ", "Mamaia": null, "Batumi": "BUS",
  "Marmara Islands & Erdek": null,
  "Tricity": "GDN", "Rügen & Usedom": null, "Curonian Spit": "PLQ",
  "Dutch coast": "AMS", "Sylt": null,
  "Algarve": "FAO", "Lisbon Coast": "LIS", "Galicia": null,
  "Tenerife": "TFS · TFN", "Gran Canaria": "LPA", "Fuerteventura & Lanzarote": "FUE · ACE",
  "Hurghada & El Gouna": "HRG", "Marsa Alam": "RMF",
  "Sharm el-Sheikh": "SSH", "Dahab": null, "Aqaba": "AQJ",
  "Salalah (Dhofar)": "SLL", "Ash Sharqiyah coast": null,
  "Dubai": "DXB", "Abu Dhabi": "AUH", "Doha": "DOH",
  "Muscat": "MCT", "Fujairah": null,
  "Montreux & Lausanne": "GVA", "Garda shores": "VRN", "Balaton shores": null,
};

// ---------- app & security ----------
const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(helmet()); // secure HTTP headers
app.use(
  cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : "*",
    methods: ["GET", "POST"],
  })
);
app.use(express.json({ limit: "10kb" })); // small body limit

// global rate limit: 100 requests / 15 min per IP
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, slow down." },
  })
);

// ---------- validation helpers ----------
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(s, name, errors) {
  if (!s || !ISO_DATE.test(s)) {
    errors.push(`${name} must be an ISO date (YYYY-MM-DD)`);
    return null;
  }
  const d = new Date(s + "T12:00:00Z");
  if (isNaN(d)) {
    errors.push(`${name} is not a valid date`);
    return null;
  }
  return d;
}

function parsePref(s, errors) {
  if (s === undefined) return DEFAULT_PREF;
  const p = parseFloat(s);
  if (isNaN(p) || p < 20 || p > 30) {
    errors.push("pref must be a number between 20 and 30 (°C)");
    return null;
  }
  return p;
}

// ---------- routes ----------
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", version: SEED.metadata.version, seas: SEED.seas.length });
});

app.get("/api/meta", (_req, res) => {
  res.json(SEED.metadata);
});

app.get("/api/seas", (_req, res) => {
  res.json(
    SEED.seas.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      region: s.region,
      destinations: s.destinations.length,
    }))
  );
});

app.get("/api/seas/:id", (req, res) => {
  const sea = SEED.seas.find((s) => s.id === req.params.id);
  if (!sea) return res.status(404).json({ error: "Sea not found" });
  res.json({
    ...sea,
    destinations: sea.destinations.map((d) => ({
      ...d,
      geo_region: REGION[d.country] || null,
      intl_airport: AIRPORT[d.area] || null,
    })),
  });
});

/**
 * GET /api/rankings
 *   ?from=YYYY-MM-DD   required
 *   &to=YYYY-MM-DD     required
 *   &pref=26.5         optional, 20–30 °C
 *   &region=all|eu|me  optional
 *   &airport=true      optional, only destinations with intl airport in town
 */
app.get("/api/rankings", (req, res) => {
  const errors = [];
  const from = parseDate(req.query.from, "from", errors);
  const to = parseDate(req.query.to, "to", errors);
  const pref = parsePref(req.query.pref, errors);
  const region = req.query.region || "all";
  if (!["all", "eu", "me"].includes(region)) errors.push("region must be all, eu or me");
  const airportOnly = req.query.airport === "true";
  if (errors.length) return res.status(400).json({ errors });

  const [start, end] = to < from ? [to, from] : [from, to];

  const results = SEED.seas
    .map((s) => {
      const avg = rangeAvg(s.monthly_sst_c, start, end);
      const dests = s.destinations
        .filter(
          (d) =>
            (region === "all" || REGION[d.country] === region) &&
            (!airportOnly || AIRPORT[d.area])
        )
        .map((d) => {
          const local = rangeAvg(withOffset(s.monthly_sst_c, d.monthly_sst_offset_c), start, end);
          return {
            country: d.country,
            area: d.area,
            resorts: d.resorts,
            tourism_score: d.tourism_score,
            water_temp_c: +local.toFixed(1),
            comfort: +comfort(local, pref).toFixed(1),
            band: band(local, pref),
            intl_airport: AIRPORT[d.area] || null,
            note: d.note || null,
          };
        })
        .sort((a, b) => b.tourism_score - a.tourism_score);
      return {
        id: s.id,
        name: s.name,
        type: s.type,
        region: s.region,
        water_temp_c: +avg.toFixed(1),
        comfort: +comfort(avg, pref).toFixed(1),
        band: band(avg, pref),
        destinations: dests,
      };
    })
    .filter((s) => s.destinations.length > 0)
    .sort((a, b) => b.comfort - a.comfort || b.water_temp_c - a.water_temp_c);

  res.json({
    query: { from: req.query.from, to: req.query.to, pref, region, airport: airportOnly },
    disclaimer: "Climatology averages (NOAA OISST style), not live measurements.",
    count: results.length,
    rankings: results,
  });
});

/**
 * POST /api/consent: anonymous consent record, GDPR-style.
 * Body: { analytics: boolean, version: string }
 * Stores NO personal data: no IP, no user agent, no identifiers.
 */
const consentLimiter = rateLimit({ windowMs: 60 * 1000, max: 5 });
app.post("/api/consent", consentLimiter, (req, res) => {
  const { analytics, version } = req.body || {};
  if (typeof analytics !== "boolean" || typeof version !== "string" || version.length > 20) {
    return res.status(400).json({ error: "Body must be { analytics: boolean, version: string }" });
  }
  const record = { analytics, version, at: new Date().toISOString() };
  fs.appendFile(
    path.join(__dirname, "data", "consent-log.jsonl"),
    JSON.stringify(record) + "\n",
    () => {} // best-effort; endpoint stays fast even if disk write fails
  );
  res.status(201).json({ recorded: true });
});

// ---------- 404 & error handling (no stack traces leak) ----------
app.use((_req, res) => res.status(404).json({ error: "Not found" }));
app.use((err, _req, res, _next) => {
  console.error(err); // full detail server-side only
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`BestSea API listening on :${PORT}`));

module.exports = app;
