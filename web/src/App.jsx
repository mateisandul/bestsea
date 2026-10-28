import { useEffect, useMemo, useState } from "react";

/* ============================================================
   BestSea: ranked by swim comfort, with filters
   TODO: temps are hand-curated climatology (NOAA OISST style);
   swap in real OISST v2.1 basin means + station offsets later.

   Comfort curve (asymmetric; overheating penalized hardest):
     25.5–27.5°C -> 100 | 23–25.5 -> −5/°C | <23 -> −10/°C (from 87.5)
     >27.5 -> −14/°C | clamped at 0

   Filters:
     region  - Europe / Middle East & Gulf (tagged per country)
     airport - destination has an international airport in/right by
               the resort town (ap = IATA code(s), null = doesn't qualify)
   ============================================================ */

// ---------- temperature math ----------
const DAYS_BEFORE = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
const ANCHOR = [15, 45, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];
const doyOf = (d) => DAYS_BEFORE[d.getMonth()] + Math.min(d.getDate(), 31);

function tempOnDay(doy, m) {
  let d = doy < ANCHOR[0] ? doy + 365 : doy;
  for (let i = 0; i < 12; i++) {
    const a0 = ANCHOR[i];
    const a1 = i === 11 ? ANCHOR[0] + 365 : ANCHOR[i + 1];
    if (d >= a0 && d <= a1) {
      const t = (d - a0) / (a1 - a0);
      return m[i] + t * (m[(i + 1) % 12] - m[i]);
    }
  }
  return m[0];
}

function rangeAvg(m, start, end) {
  let s = new Date(start), e = new Date(end);
  if (e < s) [s, e] = [e, s];
  let sum = 0, n = 0;
  const d = new Date(s);
  while (d <= e && n < 400) {
    sum += tempOnDay(doyOf(d), m);
    n++;
    d.setDate(d.getDate() + 1);
  }
  return n ? sum / n : NaN;
}

const withOffset = (m, off) => (off ? m.map((v, i) => v + (off[i] || 0)) : m);
const sparse = (o) => {
  const a = new Array(12).fill(0);
  if (o) for (const k of Object.keys(o)) a[+k] = o[k];
  return a;
};

// ---------- comfort score (the ranking key) ----------
// The curve is defined around a preferred temperature (default 26.5°C,
// i.e. a 25.5–27.5 plateau). Changing the preference shifts the whole
// curve and all band labels with it.
const DEFAULT_PREF = 26.5;

function comfort(t, pref = DEFAULT_PREF) {
  const u = t - (pref - DEFAULT_PREF); // shift into the default frame
  let s;
  if (u >= 25.5 && u <= 27.5) s = 100;
  else if (u >= 23 && u < 25.5) s = 100 - 5 * (25.5 - u);
  else if (u < 23) s = 87.5 - 10 * (23 - u);
  else s = 100 - 14 * (u - 27.5);
  return Math.max(0, s);
}

function band(t, pref = DEFAULT_PREF) {
  const u = t - (pref - DEFAULT_PREF);
  if (u >= 29) return { label: "Bathwater", c: "#C74A2E", bg: "#FAE7E1" };
  if (u >= 27.5) return { label: "Warm", c: "#D68A2D", bg: "#FBF0DD" };
  if (u >= 25.5) return { label: "Perfect", c: "#0E9E77", bg: "#E0F5EC" };
  if (u >= 23) return { label: "Fresh but great", c: "#1493A6", bg: "#E2F2F4" };
  if (u >= 20) return { label: "Bracing", c: "#3D7FB5", bg: "#E6EFF7" };
  return { label: "Cold", c: "#5E718F", bg: "#EAEDF3" };
}

// ---------- "by sea" mode helpers ----------
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEK_DOYS = Array.from({ length: 52 }, (_, w) => 7 * w + 4); // week midpoints

function doyLabel(doy) {
  let m = 0;
  for (let i = 11; i >= 0; i--) if (doy > DAYS_BEFORE[i]) { m = i; break; }
  return `${MONTH_ABBR[m]} ${Math.min(Math.max(1, doy - DAYS_BEFORE[m]), 31)}`;
}

// longest contiguous stretch of weeks at/near the year's best score (wraps Dec->Jan)
function bestWindow(scores) {
  const max = Math.max(...scores);
  const thr = max >= 90 ? 90 : max - 3;
  const ext = scores.concat(scores);
  let best = { len: 0, start: 0 };
  let i = 0;
  while (i < 52) {
    if (ext[i] >= thr) {
      let j = i;
      while (j < i + 52 && ext[j] >= thr) j++;
      if (j - i > best.len) best = { len: j - i, start: i };
      i = j;
    } else i++;
  }
  if (!best.len) return null;
  return {
    from: doyLabel(WEEK_DOYS[best.start % 52]),
    to: doyLabel(WEEK_DOYS[(best.start + best.len - 1) % 52]),
    max,
  };
}

// ---------- tourism & geography ----------
const W = { i: 0.25, f: 0.2, s: 0.2, sa: 0.2, fl: 0.15 };
const score = ([i, f, s, sa, fl]) => i * W.i + f * W.f + s * W.s + sa * W.sa + fl * W.fl;

const FLAGS = {
  Greece: "🇬🇷", "Türkiye": "🇹🇷", Italy: "🇮🇹", Croatia: "🇭🇷", Montenegro: "🇲🇪",
  France: "🇫🇷", Spain: "🇪🇸", Cyprus: "🇨🇾", Egypt: "🇪🇬", Bulgaria: "🇧🇬",
  Romania: "🇷🇴", Georgia: "🇬🇪", Poland: "🇵🇱", Germany: "🇩🇪", Lithuania: "🇱🇹",
  Netherlands: "🇳🇱", Portugal: "🇵🇹", Jordan: "🇯🇴", Oman: "🇴🇲", UAE: "🇦🇪",
  Qatar: "🇶🇦", Switzerland: "🇨🇭", Hungary: "🇭🇺",
};

// region per country: eu = Europe, me = Middle East & Gulf
const REGION = {
  Greece: "eu", "Türkiye": "eu", Italy: "eu", Croatia: "eu", Montenegro: "eu",
  France: "eu", Spain: "eu", Cyprus: "eu", Bulgaria: "eu", Romania: "eu",
  Georgia: "eu", Poland: "eu", Germany: "eu", Lithuania: "eu", Netherlands: "eu",
  Portugal: "eu", Switzerland: "eu", Hungary: "eu",
  Egypt: "me", Jordan: "me", Oman: "me", UAE: "me", Qatar: "me",
};

// ap = international airport in/right by the resort town (null = doesn't qualify)
const D = (country, area, sc, why, ap = null, off = null) =>
  ({ country, area, sc: score(sc), why, ap, off: off ? sparse(off) : null });

// ---------- legal content ----------
const LEGAL = {
  terms: {
    title: "Terms of Service",
    body: [
      ["1. Acceptance", "By using BestSea you agree to these terms. If you do not agree, please do not use the service."],
      ["2. What BestSea is", "BestSea is a trip-planning aid. It ranks seas, lakes and destinations using long-term water temperature averages (climatology) and editorial tourism scores. It is not a booking service and does not sell travel."],
      ["3. No guarantees", "Water temperatures shown are historical averages, not forecasts or live measurements. Actual conditions vary by year, week and beach. Tourism scores and airport information are editorial judgments and may be outdated or wrong. Always verify conditions, safety advisories and travel requirements with official sources before booking or swimming."],
      ["4. Acceptable use", "You may use BestSea for personal, non-commercial trip planning. You may not scrape, resell or misrepresent the data as live measurements, or attempt to disrupt the service."],
      ["5. Limitation of liability", "To the maximum extent permitted by law, BestSea is provided \u201cas is\u201d without warranties of any kind. We are not liable for decisions made based on the information shown, including travel bookings, swimming conditions or health outcomes."],
      ["6. Changes", "We may update these terms and the service at any time. Continued use after changes means you accept the updated terms."],
    ],
  },
  privacy: {
    title: "Privacy Policy",
    body: [
      ["What we collect", "BestSea has no accounts and collects no personal data. Your settings (dates, filters, preferred temperature, unit) and your consent choice are stored only in this app's private storage on your device."],
      ["What we don't do", "No data is sent to third parties. There is no advertising, no tracking pixels, and no sale of data, because there is nothing to sell."],
      ["Optional analytics", "If you enable the analytics option, an anonymous flag records that preference. In this version no usage data is actually transmitted anywhere; the toggle only stores your choice for future versions."],
      ["Your controls", "You can reopen Cookie & Consent settings from the footer at any time to change or withdraw your consent. Withdrawing consent clears the stored preference."],
      ["Data location & security", "Everything you enter stays on your device in app-scoped storage. The one external request this app makes is loading its fonts from Google Fonts; like any web request, that exposes your IP address to the font server. None of your settings, dates or choices are ever transmitted anywhere."],
    ],
  },
  disclaimer: {
    title: "Data Disclaimer",
    body: [
      ["Climatology, not live data", "Temperatures are long-term monthly averages in the style of NOAA OISST, interpolated day by day. A specific week in a specific year can differ noticeably from the average."],
      ["Editorial scores", "Tourism scores (infrastructure, food, sights, safety, flight access) are subjective editorial ratings, not official statistics."],
      ["Safety first", "Nothing here is safety advice. Check local flags, currents, jellyfish and weather warnings before entering any water."],
    ],
  },
};

// ---------- data (climatology seed) ----------
const SEAS = [
  { id: "aegean", name: "Aegean Sea", type: "sea",
    m: [15, 14.5, 15, 16, 19, 22.5, 24.5, 25, 24, 21.5, 19, 16.5],
    dests: [
      D("Greece", "Cyclades", [9, 9, 10, 9, 8], "Iconic whitewashed islands with world-class beaches and nightlife", "JMK · JTR", { 6: -1.5, 7: -2, 8: -1 }),
      D("Greece", "Halkidiki", [8, 9, 7, 9, 7], "Pine-backed sandy coves with calm, shallow water", null, { 6: 0.5, 7: 1, 8: 0.5 }),
      D("Türkiye", "Bodrum & Çeşme", [8, 9, 8, 8, 8], "Chic marinas and beach clubs at Turkish prices", "BJV", { 6: 0.5, 7: 0.5 }),
      D("Greece", "Crete (north)", [8, 9, 9, 9, 8], "Huge resort choice plus Venetian towns and serious food", "HER · CHQ"),
    ] },
  { id: "ionian", name: "Ionian Sea", type: "sea",
    m: [15.5, 15, 15.5, 16.5, 19, 23, 25.5, 26.5, 25.5, 22.5, 19.5, 17],
    dests: [
      D("Greece", "Ionian Islands", [8, 9, 9, 9, 8], "Turquoise coves and lush green islands, from Corfu to Zakynthos", "CFU · ZTH"),
      D("Italy", "Salento", [8, 10, 8, 9, 7], "Baroque towns, Caribbean-blue water, Italy's best food value", null, { 7: 0.5 }),
    ] },
  { id: "adriatic", name: "Adriatic Sea", type: "sea",
    m: [13.5, 13, 13.5, 15, 18.5, 23, 25.5, 26, 24, 20.5, 17.5, 15],
    dests: [
      D("Croatia", "Dalmatia", [9, 8, 10, 9, 8], "Island-hopping between UNESCO old towns", "SPU · DBV"),
      D("Italy", "Riviera Romagnola", [9, 9, 7, 9, 8], "Classic family beach strip with endless lidos and warm shallow water", "RMI", { 0: -1, 1: -1, 5: 1, 6: 1.5, 7: 1.5, 8: 0.5 }),
      D("Montenegro", "Budva Riviera", [7, 8, 8, 8, 6], "Adriatic beaches without Adriatic prices", "TIV"),
    ] },
  { id: "tyrrhenian", name: "Tyrrhenian Sea", type: "sea",
    m: [14.5, 14, 14, 15.5, 18, 22.5, 25.5, 26.5, 25, 22, 18.5, 16],
    dests: [
      D("Italy", "Amalfi Coast & Capri", [9, 10, 10, 9, 8], "The Med's most dramatic coastline, food to match"),
      D("Italy", "Sardinia", [9, 9, 9, 9, 7], "Some of Europe's clearest water and whitest sand", "OLB · CAG"),
      D("Italy", "Northern Sicily", [8, 10, 9, 8, 8], "Beach days plus Palermo street food and Aeolian trips", "PMO", { 7: 0.5 }),
    ] },
  { id: "ligurian", name: "Ligurian Sea", type: "sea",
    m: [13.5, 13, 13.5, 14.5, 17, 21, 23.5, 24.5, 23, 20.5, 17.5, 15],
    dests: [
      D("France", "Côte d'Azur", [10, 9, 9, 9, 9], "Glamour, art towns and effortless flight connections", "NCE", { 7: 0.5 }),
      D("Italy", "Portofino & Cinque Terre", [8, 9, 10, 9, 7], "Postcard harbours and cliff-path swimming coves"),
    ] },
  { id: "balearic", name: "Balearic Sea", type: "sea",
    m: [14.5, 14, 14.5, 15.5, 18, 22, 25, 26.5, 25.5, 22.5, 19, 16.5],
    dests: [
      D("Spain", "Mallorca & Ibiza", [9, 9, 8, 9, 9], "Everything from party to hideaway, superb air links", "PMI · IBZ", { 7: 0.5 }),
      D("Spain", "Costa Blanca", [9, 8, 7, 9, 8], "Reliable sun and long sandy beaches at great value", "ALC", { 7: 1, 8: 0.5 }),
      D("Spain", "Costa Brava", [8, 9, 8, 9, 8], "Rocky coves, Dalí country and Catalan food", "GRO", { 6: -0.5, 7: -0.5 }),
    ] },
  { id: "alboran", name: "Alborán Sea", type: "sea",
    m: [15.5, 15, 15.5, 16, 17.5, 20, 22, 23, 22.5, 20.5, 18, 16.5],
    dests: [
      D("Spain", "Costa del Sol", [9, 8, 8, 9, 9], "Year-round season with polished resort infrastructure", "AGP"),
      D("Spain", "Almería coast", [7, 7, 8, 9, 6], "Wild protected beaches in Spain's sunniest corner", "LEI", { 7: 0.5 }),
    ] },
  { id: "levantine", name: "Eastern Mediterranean", type: "sea",
    m: [17.5, 17, 17.5, 18.5, 21, 24.5, 27.5, 29, 28.5, 26, 22.5, 19.5],
    dests: [
      D("Türkiye", "Turkish Riviera", [9, 8, 9, 8, 9], "Huge all-inclusive value with ancient ruins on the beach", "AYT", { 7: 0.5 }),
      D("Cyprus", "Paphos & Ayia Napa", [8, 8, 8, 9, 8], "Long warm season, safe and easy for families", "PFO · LCA"),
      D("Egypt", "North Coast", [7, 7, 6, 7, 6], "Where Cairo summers: white sand and fast-growing resorts", "DBB", { 6: -1, 7: -1, 8: -0.5 }),
    ] },
  { id: "black", name: "Black Sea", type: "sea",
    m: [8.5, 7.5, 8, 10.5, 15, 21, 24.5, 25.5, 23, 18.5, 14, 10.5],
    dests: [
      D("Bulgaria", "Bulgarian Riviera", [7, 7, 6, 8, 7], "The most affordable beach holiday in the EU", "VAR · BOJ"),
      D("Romania", "Mamaia", [7, 7, 5, 8, 6], "Romania's lively summer beach strip"),
      D("Georgia", "Batumi", [6, 8, 7, 7, 5], "Subtropical boomtown with a mountain backdrop", "BUS"),
    ] },
  { id: "marmara", name: "Sea of Marmara", type: "sea",
    m: [10, 9, 9.5, 11.5, 15.5, 20.5, 23.5, 24.5, 22.5, 18.5, 14.5, 11.5],
    dests: [
      D("Türkiye", "Marmara Islands & Erdek", [6, 8, 6, 8, 6], "Low-key island escapes a short hop from Istanbul"),
    ] },
  { id: "baltic", name: "Baltic Sea", type: "sea",
    m: [3.5, 2.5, 3, 5.5, 10, 15, 18.5, 18.5, 15.5, 11.5, 8, 5],
    dests: [
      D("Poland", "Tricity (Sopot)", [8, 8, 7, 9, 7], "Elegant pier town with wide white Baltic sand", "GDN", { 6: 0.5 }),
      D("Germany", "Rügen & Usedom", [8, 7, 7, 9, 6], "Chalk cliffs and grand old seaside resorts"),
      D("Lithuania", "Curonian Spit", [7, 7, 8, 9, 5], "UNESCO dunes and pine forest, blissfully quiet", "PLQ"),
    ] },
  { id: "northsea", name: "North Sea", type: "sea",
    m: [7, 6, 6.5, 8.5, 11.5, 14.5, 17, 17.5, 16, 13.5, 10.5, 8.5],
    dests: [
      D("Netherlands", "Dutch coast", [9, 8, 7, 9, 9], "Broad beaches minutes from Amsterdam", "AMS"),
      D("Germany", "Sylt", [8, 8, 6, 9, 6], "Germany's glamour island: dunes, oysters, wind"),
    ] },
  { id: "atl-iberia", name: "Atlantic · Iberian Coast", type: "sea",
    m: [15, 14.5, 15, 15.5, 16.5, 18, 19.5, 20, 19.5, 18.5, 17, 15.5],
    dests: [
      D("Portugal", "Algarve", [9, 9, 8, 9, 8], "Golden cliffs and the warmest Atlantic water in Iberia", "FAO", { 5: 1, 6: 1.5, 7: 2, 8: 1.5 }),
      D("Portugal", "Lisbon Coast", [9, 10, 9, 9, 9], "Surf-and-city combo with superb food", "LIS"),
      D("Spain", "Galicia", [7, 10, 8, 9, 6], "Spectacular wild beaches and seafood heaven", null, { 6: -1, 7: -1.5, 8: -1 }),
    ] },
  { id: "canary", name: "Atlantic · Canary Islands", type: "sea",
    m: [19.5, 18.5, 18.5, 19, 20, 21, 22, 23, 23.5, 23, 21.5, 20],
    dests: [
      D("Spain", "Tenerife", [9, 8, 8, 9, 9], "Winter-sun capital with pleasant water all year round", "TFS · TFN"),
      D("Spain", "Gran Canaria", [9, 8, 7, 9, 9], "Maspalomas dunes and an eternal-spring climate", "LPA"),
      D("Spain", "Fuerteventura & Lanzarote", [8, 7, 7, 9, 8], "Endless sand and volcanic surf beaches", "FUE · ACE"),
    ] },
  { id: "redsea", name: "Red Sea", type: "sea",
    m: [22.5, 22, 22.5, 24, 26, 27.5, 28.5, 29, 28.5, 27.5, 25.5, 23.5],
    dests: [
      D("Egypt", "Hurghada & El Gouna", [8, 7, 8, 8, 8], "Reef diving and winter sun at unbeatable cost", "HRG"),
      D("Egypt", "Marsa Alam", [7, 6, 9, 8, 6], "Pristine reefs, dugongs and turtle bays", "RMF"),
    ] },
  { id: "aqaba", name: "Gulf of Aqaba", type: "sea",
    m: [21.5, 21, 21.5, 22.5, 24, 25.5, 27, 28, 27.5, 26.5, 24.5, 22.5],
    dests: [
      D("Egypt", "Sharm el-Sheikh", [8, 7, 9, 8, 8], "World-class reefs with big-resort comfort", "SSH", { 6: 0.5, 7: 0.5 }),
      D("Egypt", "Dahab", [6, 7, 9, 8, 6], "Laid-back diver town with the Blue Hole at the door"),
      D("Jordan", "Aqaba", [7, 7, 8, 8, 7], "Reefs plus Petra and Wadi Rum day trips", "AQJ"),
    ] },
  { id: "arabian", name: "Arabian Sea (Oman)", type: "sea",
    m: [25.5, 25.5, 26.5, 28, 29.5, 30, 29.5, 29, 29, 28.5, 27, 26],
    dests: [
      D("Oman", "Salalah (Dhofar)", [8, 8, 9, 9, 7], "Green monsoon hills and empty white beaches", "SLL", { 5: -3, 6: -5, 7: -5.5, 8: -4, 9: -1.5 }),
      D("Oman", "Ash Sharqiyah coast", [5, 6, 8, 9, 5], "Turtle-nesting beaches where desert meets sea", null, { 6: -2, 7: -2, 8: -1 }),
    ] },
  { id: "gulf", name: "Persian Gulf", type: "sea",
    m: [21, 20.5, 22, 25, 29, 31.5, 33, 33.5, 32.5, 30, 26.5, 23],
    dests: [
      D("UAE", "Dubai", [10, 9, 8, 9, 10], "Polished urban beaches on an unbeatable flight hub", "DXB"),
      D("UAE", "Abu Dhabi", [10, 9, 8, 9, 9], "Calm white-sand island beaches and top hotels", "AUH", { 6: 0.5 }),
      D("Qatar", "Doha", [9, 8, 7, 9, 8], "Museums, souqs and quiet Gulf beaches", "DOH"),
    ] },
  { id: "gulfoman", name: "Gulf of Oman", type: "sea",
    m: [23.5, 23.5, 25, 27.5, 30, 31.5, 31, 30, 30, 29.5, 27, 24.5],
    dests: [
      D("Oman", "Muscat", [8, 8, 9, 9, 8], "Dramatic mountain coast with elegant low-rise resorts", "MCT"),
      D("UAE", "Fujairah", [8, 7, 6, 9, 8], "East-coast reefs and easy diving from Dubai"),
    ] },
  { id: "geneva", name: "Lake Geneva", type: "lake",
    m: [5.5, 5, 6.5, 9.5, 13.5, 17.5, 20.5, 21, 18.5, 14, 10, 7],
    dests: [
      D("Switzerland", "Montreux & Lausanne", [10, 9, 9, 10, 8], "Alpine backdrop, vineyard terraces and spotless lidos", "GVA"),
    ] },
  { id: "garda", name: "Lake Garda", type: "lake",
    m: [8.5, 8, 9.5, 12.5, 16.5, 20.5, 23.5, 24, 21, 17, 13, 10],
    dests: [
      D("Italy", "Garda shores", [9, 9, 9, 9, 8], "Lemon groves, lake lidos and Dolomite views", "VRN"),
    ] },
  { id: "balaton", name: "Lake Balaton", type: "lake",
    m: [2, 2, 6, 12, 18, 22, 24, 23.5, 19.5, 13.5, 8, 3.5],
    dests: [
      D("Hungary", "Balaton shores", [7, 8, 7, 9, 6], "Central Europe's warm, shallow inland sea"),
    ] },
];

// ---------- component ----------
export default function BestSea() {
  // default window: a week starting two weeks from today
  const isoIn = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const [from, setFrom] = useState(() => isoIn(14));
  const [to, setTo] = useState(() => isoIn(20));
  const [unit, setUnit] = useState("C");
  const [open, setOpen] = useState(null);
  const [region, setRegion] = useState("all"); // all | eu | me
  const [airportOnly, setAirportOnly] = useState(false);
  const [pref, setPref] = useState(DEFAULT_PREF); // preferred water temp, °C
  const [mode, setMode] = useState("dates"); // "dates" = rank seas for a range | "sea" = best times for one sea
  const [seaPick, setSeaPick] = useState("aegean");

  // ---------- consent & legal ----------
  // consent: undefined = still loading, null = not yet given, {analytics} = given
  const [consent, setConsent] = useState(undefined);
  const [analyticsOpt, setAnalyticsOpt] = useState(false);
  const [legal, setLegal] = useState(null); // null | 'terms' | 'privacy' | 'disclaimer'

  useEffect(() => {
    try {
      const v = localStorage.getItem("bestsea:consent");
      setConsent(v ? JSON.parse(v) : null);
    } catch {
      setConsent(null); // storage unavailable -> gate shows every visit
    }
  }, []);

  const saveConsent = (analytics) => {
    const c = { analytics, acceptedAt: new Date().toISOString(), version: "1.0" };
    setConsent(c);
    try { localStorage.setItem("bestsea:consent", JSON.stringify(c)); } catch { /* in-memory only */ }
  };

  const withdrawConsent = () => {
    setConsent(null);
    setAnalyticsOpt(false);
    try { localStorage.removeItem("bestsea:consent"); } catch { /* nothing stored */ }
  };

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") setLegal(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const start = useMemo(() => new Date(from + "T12:00:00"), [from]);
  const end = useMemo(() => new Date(to + "T12:00:00"), [to]);
  const valid = !isNaN(start) && !isNaN(end);

  // keep the range in order: picking a From after To (or a To before From)
  // drags the other date along, so To can never end up earlier than From
  const onFrom = (v) => {
    setFrom(v);
    if (v && to && v > to) setTo(v);
  };
  const onTo = (v) => {
    setTo(v);
    if (v && from && v < from) setFrom(v);
  };

  const show = (t) => (unit === "C" ? `${t.toFixed(1)}°C` : `${Math.round(t * 9 / 5 + 32)}°F`);

  const ranked = useMemo(() => {
    if (!valid) return [];
    return SEAS.map((s) => {
      const avg = rangeAvg(s.m, start, end);
      return {
        ...s,
        avg,
        comfort: comfort(avg, pref),
        dests: s.dests
          .map((d) => {
            const local = rangeAvg(withOffset(s.m, d.off), start, end);
            return { ...d, local };
          })
          .sort((a, b) => b.sc - a.sc),
      };
    }).sort((a, b) => b.comfort - a.comfort || b.avg - a.avg);
  }, [valid, start, end, pref]);

  // apply filters per destination; hide seas left with no destinations
  const visible = useMemo(
    () =>
      ranked
        .map((s) => ({
          ...s,
          dests: s.dests.filter(
            (d) =>
              (region === "all" || REGION[d.country] === region) &&
              (!airportOnly || d.ap)
          ),
        }))
        .filter((s) => s.dests.length > 0),
    [ranked, region, airportOnly]
  );

  const days = valid ? Math.round(Math.abs(end - start) / 864e5) + 1 : 0;
  const destCount = visible.reduce((n, s) => n + s.dests.length, 0);

  return (
    <div className="bs">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Instrument+Sans:wght@400;500;600;700&display=swap');
        .bs{min-height:100vh;background:linear-gradient(180deg,#DDEDEF 0%,#F2F6F5 220px);color:#0B3C49;font-family:'Instrument Sans',system-ui,sans-serif;padding-bottom:72px}
        .bs *{box-sizing:border-box}
        .bs-wrap{max-width:480px;margin:0 auto;padding-block:0;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
        .bs-top{display:flex;align-items:flex-start;justify-content:space-between;padding:30px 2px 14px}
        .bs-logo{font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:28px;letter-spacing:-0.5px;line-height:1}
        .bs-logo em{font-style:normal;color:#1493A6}
        .bs-sub{font-size:12.5px;color:#4E6E78;margin-top:5px}
        .bs-unit{display:flex;background:#fff;border:1px solid #CFE0E2;border-radius:999px;padding:2px;margin-top:2px}
        .bs-unit button{border:0;background:none;font:inherit;font-size:12px;font-weight:700;color:#4E6E78;padding:5px 11px;border-radius:999px;cursor:pointer}
        .bs-unit button[aria-pressed="true"]{background:#0B3C49;color:#fff}
        .bs-unit button:focus-visible{outline:2px solid #1493A6;outline-offset:1px}
        .bs-dates{background:#fff;border:1px solid #D8E5E6;border-radius:16px;padding:12px;display:flex;gap:10px;align-items:flex-end;box-shadow:0 1px 3px rgba(11,60,73,.06)}
        .bs-f{flex:1;display:flex;flex-direction:column;gap:4px}
        .bs-f label{font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#7A959D}
        .bs-f input{border:1px solid #CFE0E2;border-radius:10px;padding:9px 10px;font:inherit;font-size:14px;color:#0B3C49;background:#F7FAFA;width:100%}
        .bs-f input:focus-visible{outline:2px solid #1493A6;outline-offset:1px}
        .bs-chips{display:flex;gap:7px;overflow-x:auto;padding:12px 2px 2px;-webkit-overflow-scrolling:touch;scrollbar-width:none}
        .bs-chips::-webkit-scrollbar{display:none}
        .bs-chip{flex-shrink:0;border:1px solid #CFE0E2;background:#fff;color:#3D5B65;font:inherit;font-size:12.5px;font-weight:600;border-radius:999px;padding:7px 13px;cursor:pointer}
        .bs-chip[aria-pressed="true"]{background:#0B3C49;border-color:#0B3C49;color:#fff}
        .bs-chip:focus-visible{outline:2px solid #1493A6;outline-offset:1px}
        .bs-pref{background:#fff;border:1px solid #D8E5E6;border-radius:16px;padding:12px 14px;margin-top:10px;box-shadow:0 1px 3px rgba(11,60,73,.06)}
        .bs-pref-top{display:flex;justify-content:space-between;align-items:baseline}
        .bs-pref-top label{font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#7A959D}
        .bs-pref-val{font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:16px;font-variant-numeric:tabular-nums;display:flex;align-items:baseline;gap:8px}
        .bs-pref-reset{border:0;background:none;font:inherit;font-family:'Instrument Sans',sans-serif;font-size:11px;font-weight:700;color:#1493A6;cursor:pointer;padding:0;text-decoration:underline}
        .bs-pref input[type=range]{width:100%;margin:10px 0 6px;accent-color:#1493A6}
        .bs-pref input[type=range]:focus-visible{outline:2px solid #1493A6;outline-offset:2px}
        .bs-pref-hint{font-size:11.5px;color:#4E6E78}
        .bs-mode{display:flex;background:#fff;border:1px solid #D8E5E6;border-radius:14px;padding:3px;margin-bottom:10px;box-shadow:0 1px 3px rgba(11,60,73,.06)}
        .bs-mode button{flex:1;border:0;background:none;font:inherit;font-size:13px;font-weight:700;color:#4E6E78;padding:9px;border-radius:11px;cursor:pointer}
        .bs-mode button[aria-pressed="true"]{background:#0B3C49;color:#fff}
        .bs-mode button:focus-visible{outline:2px solid #1493A6;outline-offset:1px}
        .bs-select{border:1px solid #CFE0E2;border-radius:10px;padding:10px;font:inherit;font-size:14px;color:#0B3C49;background:#F7FAFA;width:100%}
        .bs-select:focus-visible{outline:2px solid #1493A6;outline-offset:1px}
        .bs-strip{display:flex;height:24px;border-radius:8px;overflow:hidden;margin-top:12px}
        .bs-strip span{flex:1}
        .bs-months{display:flex;justify-content:space-between;font-size:9px;font-weight:700;color:#7A959D;margin-top:4px;padding:0 2px;letter-spacing:.5px}
        .bs-win{font-size:12.5px;color:#3D5B65;margin-top:10px}
        .bs-win b{color:#0B3C49}
        .bs-top3{font-size:11.5px;color:#7A959D;margin-top:3px}
        .bs-mgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:12px}
        .bs-mcell{background:#fff;border:1px solid #E0EBEC;border-radius:12px;padding:8px 4px;text-align:center}
        .bs-mname{font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#7A959D}
        .bs-mtemp{font-weight:800;font-size:13.5px;font-variant-numeric:tabular-nums;margin-top:2px}
        .bs-mband{display:inline-block;font-size:8.5px;font-weight:700;border-radius:999px;padding:2px 6px;margin-top:4px;white-space:nowrap}
        .bs-dhead{font-family:'Bricolage Grotesque',sans-serif;font-weight:700;font-size:15px;margin:4px 2px 9px}
        .bs-best{font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#7A959D}
        .bs-caption{font-size:10.5px;color:#9DB4BA;margin-top:5px}
        .bs-yourdates{font-size:12px;color:#3D5B65;margin-top:11px;padding-top:11px;border-top:1px dashed #DDE8EA;display:flex;flex-direction:column;gap:6px;line-height:1.5}
        .bs-switchlink{border:0;background:none;font:inherit;font-size:11.5px;font-weight:700;color:#1493A6;cursor:pointer;padding:0;text-decoration:underline;align-self:flex-start}
        .bs-switchlink:focus-visible{outline:2px solid #1493A6;outline-offset:2px}
        .bs-seemore{display:block;width:100%;border:0;background:#E4F1F2;color:#0B3C49;font:inherit;font-size:12.5px;font-weight:700;border-radius:11px;padding:11px;margin-top:8px;cursor:pointer}
        .bs-seemore:focus-visible{outline:2px solid #1493A6;outline-offset:1px}
        .bs-how{display:flex;gap:8px;align-items:flex-start;font-size:12px;color:#4E6E78;margin:10px 4px 14px;line-height:1.5}
        .bs-how b{color:#0B3C49}
        .bs-card{background:#fff;border:1px solid #D8E5E6;border-radius:16px;margin-bottom:9px;overflow:hidden;box-shadow:0 1px 3px rgba(11,60,73,.05)}
        .bs-row{display:grid;grid-template-columns:22px 1fr auto;gap:11px;align-items:center;width:100%;padding:14px;background:none;border:0;font:inherit;text-align:left;cursor:pointer}
        .bs-row:focus-visible{outline:2px solid #1493A6;outline-offset:-2px}
        .bs-rank{font-size:12px;font-weight:700;color:#9DB4BA;font-variant-numeric:tabular-nums}
        .bs-sea{font-family:'Bricolage Grotesque',sans-serif;font-weight:700;font-size:16px;display:flex;align-items:center;gap:7px;flex-wrap:wrap}
        .bs-lake{font-size:9px;font-weight:700;letter-spacing:1px;background:#E4F1F2;color:#3B7B87;border-radius:5px;padding:2px 6px}
        .bs-temp-inline{font-size:12.5px;color:#4E6E78;margin-top:3px;font-variant-numeric:tabular-nums}
        .bs-bar{height:6px;border-radius:3px;background:#EDF3F3;margin-top:8px;position:relative;overflow:hidden}
        .bs-fill{position:absolute;inset:0 auto 0 0;border-radius:3px}
        .bs-right{text-align:right}
        .bs-big{font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:24px;line-height:1;font-variant-numeric:tabular-nums}
        .bs-big small{font-size:11px;font-weight:600;color:#9DB4BA}
        .bs-band{display:inline-block;font-size:10.5px;font-weight:700;border-radius:999px;padding:3px 9px;margin-top:5px;white-space:nowrap}
        .bs-dests{border-top:1px solid #E4EEEF;background:#F4F9F9;padding:10px 12px 12px}
        .bs-d{background:#fff;border:1px solid #E0EBEC;border-radius:13px;padding:11px 12px;margin-top:8px;display:flex;gap:10px}
        .bs-d:first-child{margin-top:0}
        .bs-flag{font-size:22px;line-height:1.25}
        .bs-dbody{flex:1;min-width:0}
        .bs-dname{font-weight:700;font-size:14px}
        .bs-dwhy{font-size:12.5px;color:#4E6E78;margin-top:2px;line-height:1.45}
        .bs-ap{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:700;color:#3D5B65;background:#EEF4F5;border-radius:6px;padding:2px 7px;margin-top:6px}
        .bs-dright{display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0}
        .bs-dtemp{font-weight:800;font-size:14px;font-variant-numeric:tabular-nums}
        .bs-dband{font-size:9.5px;font-weight:700;border-radius:999px;padding:2px 7px;white-space:nowrap}
        .bs-drate{font-size:11.5px;font-weight:800;background:#0B3C49;color:#fff;border-radius:7px;padding:3px 7px;font-variant-numeric:tabular-nums}
        .bs-empty{text-align:center;color:#4E6E78;font-size:13.5px;background:#fff;border:1px dashed #C9DBDD;border-radius:16px;padding:28px 20px;line-height:1.6}
        .bs-overlay{position:fixed;inset:0;background:rgba(11,60,73,.45);backdrop-filter:blur(3px);z-index:50;display:flex;align-items:flex-end;justify-content:center}
        .bs-sheet{background:#fff;border-radius:20px 20px 0 0;max-width:480px;width:100%;max-height:86vh;overflow-y:auto;padding:22px 20px 26px;box-shadow:0 -8px 40px rgba(11,60,73,.25)}
        @media(min-width:520px){.bs-overlay{align-items:center;padding:20px}.bs-sheet{border-radius:20px}}
        .bs-sheet h2{font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:20px;margin:0 0 6px}
        .bs-sheet p{font-size:13.5px;color:#3D5B65;line-height:1.6;margin:0 0 12px}
        .bs-sheet h3{font-size:13px;font-weight:700;color:#0B3C49;margin:14px 0 3px}
        .bs-legal-links{font-size:12.5px;color:#4E6E78;margin-bottom:14px}
        .bs-legal-links button{border:0;background:none;font:inherit;font-weight:700;color:#1493A6;cursor:pointer;padding:0;text-decoration:underline}
        .bs-optrow{display:flex;gap:10px;align-items:flex-start;background:#F4F9F9;border:1px solid #E0EBEC;border-radius:12px;padding:11px 12px;margin-bottom:14px}
        .bs-optrow input{margin-top:3px;accent-color:#1493A6;width:16px;height:16px}
        .bs-optrow label{font-size:12.5px;color:#3D5B65;line-height:1.5}
        .bs-optrow b{color:#0B3C49}
        .bs-cta{display:flex;flex-direction:column;gap:8px}
        .bs-btn{border:0;border-radius:12px;padding:13px;font:inherit;font-weight:700;font-size:14px;cursor:pointer}
        .bs-btn-primary{background:#0B3C49;color:#fff}
        .bs-btn-ghost{background:#EEF4F5;color:#0B3C49}
        .bs-btn:focus-visible{outline:2px solid #1493A6;outline-offset:2px}
        .bs-close{position:sticky;top:0;float:right;border:0;background:#EEF4F5;color:#0B3C49;border-radius:999px;width:30px;height:30px;font-size:15px;font-weight:700;cursor:pointer;line-height:1}
        .bs-links{display:flex;flex-wrap:wrap;gap:5px 14px;justify-content:center;margin-top:14px;padding-top:14px;border-top:1px solid #DCE8EA}
        .bs-links button{border:0;background:none;font:inherit;font-size:11.5px;font-weight:600;color:#4E6E78;cursor:pointer;padding:0;text-decoration:underline}
        .bs-links button:focus-visible{outline:2px solid #1493A6;outline-offset:2px}
        .bs-vtag{text-align:center;font-size:10.5px;color:#9DB4BA;margin-top:8px}
        .bs-foot{font-size:11px;color:#7A959D;line-height:1.6;margin-top:22px;padding:0 4px}
        @media (prefers-reduced-motion:no-preference){
          .bs-fill{transition:width .4s ease}
          .bs-dests{animation:bsUp .22s ease}
          @keyframes bsUp{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
        }
      `}</style>

      <div className="bs-wrap">
        <div className="bs-top">
          <div>
            <div className="bs-logo">Best<em>Sea</em></div>
            <div className="bs-sub">{mode === "dates" ? "The most comfortable swim on your dates" : "The best time of year for your favourite water"}</div>
          </div>
          <div className="bs-unit" role="group" aria-label="Temperature unit">
            <button aria-pressed={unit === "C"} onClick={() => setUnit("C")}>°C</button>
            <button aria-pressed={unit === "F"} onClick={() => setUnit("F")}>°F</button>
          </div>
        </div>

        <div className="bs-mode" role="group" aria-label="Search mode">
          <button aria-pressed={mode === "dates"} onClick={() => setMode("dates")}>📅 By dates</button>
          <button aria-pressed={mode === "sea"} onClick={() => setMode("sea")}>🌊 By sea</button>
        </div>

        {mode === "dates" && (
          <div className="bs-dates">
            <div className="bs-f">
              <label htmlFor="bsFrom">From</label>
              <input id="bsFrom" type="date" value={from} max={to || undefined} onChange={(e) => onFrom(e.target.value)} />
            </div>
            <div className="bs-f">
              <label htmlFor="bsTo">To</label>
              <input id="bsTo" type="date" value={to} min={from || undefined} onChange={(e) => onTo(e.target.value)} />
            </div>
          </div>
        )}

        {mode === "sea" && (
          <div className="bs-dates">
            <div className="bs-f">
              <label htmlFor="bsSea">Pick your water</label>
              <select id="bsSea" className="bs-select" value={seaPick} onChange={(e) => setSeaPick(e.target.value)}>
                {SEAS.map((s) => {
                  const countries = [...new Set(s.dests.map((d) => d.country))].join(", ");
                  return (
                    <option key={s.id} value={s.id}>
                      {s.name} ({countries}){s.type === "lake" ? " · lake" : ""}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>
        )}

        <div className="bs-chips" role="group" aria-label="Filters">
          <button className="bs-chip" aria-pressed={region === "all"} onClick={() => setRegion("all")}>All regions</button>
          <button className="bs-chip" aria-pressed={region === "eu"} onClick={() => setRegion("eu")}>Europe</button>
          <button className="bs-chip" aria-pressed={region === "me"} onClick={() => setRegion("me")}>Middle East & Gulf</button>
          <button className="bs-chip" aria-pressed={airportOnly} onClick={() => setAirportOnly(!airportOnly)}>✈ Intl airport in town</button>
        </div>

        <div className="bs-pref">
          <div className="bs-pref-top">
            <label htmlFor="bsPref">My perfect water temp</label>
            <span className="bs-pref-val">
              {unit === "C" ? `${pref.toFixed(1)}°C` : `${Math.round(pref * 9 / 5 + 32)}°F`}
              {pref !== DEFAULT_PREF && (
                <button className="bs-pref-reset" onClick={() => setPref(DEFAULT_PREF)}>reset</button>
              )}
            </span>
          </div>
          <input
            id="bsPref" type="range" min="20" max="30" step="0.5" value={pref}
            onChange={(e) => setPref(parseFloat(e.target.value))}
            aria-label="Preferred water temperature in degrees Celsius"
          />
          <div className="bs-pref-hint">
            Sweet spot: {show(pref - 1)}–{show(pref + 1)} scores 100 · warmer than that is penalized hardest
          </div>
        </div>

        {mode === "dates" && (
          <div className="bs-how">
            <span aria-hidden="true">🌡️</span>
            <span>
              Ranked by <b>comfort score</b>, not raw heat. 25.5–27.5° water is a perfect 100, and hotter
              loses points nearly 3× faster than cooler. {destCount} destination{destCount !== 1 ? "s" : ""} match your filters.
            </span>
          </div>
        )}

        {mode === "sea" && (() => {
          const sea = SEAS.find((s) => s.id === seaPick);
          const weekTemps = WEEK_DOYS.map((d) => tempOnDay(d, sea.m));
          const weekScores = weekTemps.map((t) => comfort(t, pref));
          const win = bestWindow(weekScores);
          const monthly = sea.m.map((t, i) => ({ i, t, score: comfort(t, pref), b: band(t, pref) }));
          const top = [...monthly].sort((a, z) => z.score - a.score).slice(0, 3);
          const dests = sea.dests.filter(
            (d) => (region === "all" || REGION[d.country] === region) && (!airportOnly || d.ap)
          );
          return (
            <>
              <div className="bs-how">
                <span aria-hidden="true">🗓️</span>
                <span>
                  Every week of the year, scored against <b>your</b> preferred temperature. The region
                  and airport filters apply to the destination list below.
                </span>
              </div>

              <div className="bs-card" style={{ padding: "14px", marginTop: "10px" }}>
                <div className="bs-sea" style={{ marginBottom: "2px" }}>
                  When is {sea.name} at its best?
                  {sea.type === "lake" && <span className="bs-lake">LAKE</span>}
                </div>
                <div className="bs-strip" aria-hidden="true">
                  {weekTemps.map((t, w) => {
                    const wb = band(t, pref);
                    return <span key={w} style={{ background: wb.c, opacity: 0.22 + 0.78 * (weekScores[w] / 100) }} />;
                  })}
                </div>
                <div className="bs-months">
                  {MONTH_ABBR.map((mo) => <span key={mo}>{mo[0]}</span>)}
                </div>
                <div className="bs-caption">Each segment is one week · stronger color = a more comfortable swim</div>
                {win && (
                  <div className="bs-win">
                    Sweet spot: <b>{win.from} – {win.to}</b>
                    {win.max < 90 ? " (as good as this water gets)" : ""}
                  </div>
                )}
                <div className="bs-top3">Top months: {top.map((mo) => MONTH_ABBR[mo.i]).join(" · ")}</div>
                {valid && (() => {
                  const a = rangeAvg(sea.m, start, end);
                  const ab = band(a, pref);
                  const opt = { month: "short", day: "numeric" };
                  return (
                    <div className="bs-yourdates">
                      <span>
                        Your dates ({start.toLocaleDateString("en-GB", opt)} – {end.toLocaleDateString("en-GB", opt)}):{" "}
                        <b style={{ color: ab.c }}>{show(a)} · {Math.round(comfort(a, pref))}/100 {ab.label}</b>
                      </span>
                      <button className="bs-switchlink" onClick={() => setMode("dates")}>compare all seas for these dates →</button>
                    </div>
                  );
                })()}
              </div>

              <div className="bs-mgrid">
                {monthly.map((mo) => (
                  <div className="bs-mcell" key={mo.i}>
                    <div className="bs-mname">{MONTH_ABBR[mo.i]}</div>
                    <div className="bs-mtemp" style={{ color: mo.b.c }}>{show(mo.t)}</div>
                    <div className="bs-mband" style={{ color: mo.b.c, background: mo.b.bg }}>{mo.b.label}</div>
                  </div>
                ))}
              </div>

              <div className="bs-dhead">Destinations on {sea.name}</div>
              {dests.length === 0 && (
                <div className="bs-empty">No destinations match the filters. Try switching region or airport off.</div>
              )}
              {dests.map((d) => {
                const lm = withOffset(sea.m, d.off);
                let bi = 0;
                for (let i = 1; i < 12; i++) if (comfort(lm[i], pref) > comfort(lm[bi], pref)) bi = i;
                const db = band(lm[bi], pref);
                return (
                  <div className="bs-card" key={d.area} style={{ padding: 0 }}>
                    <div className="bs-d" style={{ border: 0, margin: 0 }}>
                      <span className="bs-flag" aria-hidden="true">{FLAGS[d.country]}</span>
                      <span className="bs-dbody">
                        <div className="bs-dname">{d.area}</div>
                        <div className="bs-dwhy">{d.why}</div>
                        {d.ap && <span className="bs-ap">✈ {d.ap}</span>}
                      </span>
                      <span className="bs-dright">
                        <span className="bs-best">Best: {MONTH_ABBR[bi]}</span>
                        <span className="bs-dtemp" style={{ color: db.c }}>{show(lm[bi])}</span>
                        <span className="bs-dband" style={{ color: db.c, background: db.bg }}>{db.label}</span>
                        <span className="bs-drate" title="Tourism score out of 10">★ {d.sc.toFixed(1)}</span>
                      </span>
                    </div>
                  </div>
                );
              })}
            </>
          );
        })()}

        {mode === "dates" && visible.length === 0 && (
          <div className="bs-empty">
            Nothing matches these filters.<br />Try switching region or turning off the airport filter.
          </div>
        )}

        {mode === "dates" && visible.map((s, i) => {
          const isOpen = open === s.id;
          const b = band(s.avg, pref);
          return (
            <div className="bs-card" key={s.id}>
              <button className="bs-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : s.id)}>
                <span className="bs-rank">{i + 1}</span>
                <span>
                  <span className="bs-sea">
                    {s.name}
                    {s.type === "lake" && <span className="bs-lake">LAKE</span>}
                  </span>
                  <span className="bs-temp-inline">water {show(s.avg)} · {s.dests.length} destination{s.dests.length !== 1 ? "s" : ""}</span>
                  <span className="bs-bar">
                    <span className="bs-fill" style={{ width: `${Math.max(s.comfort, 3)}%`, background: `linear-gradient(90deg, ${b.c}55, ${b.c})` }} />
                  </span>
                </span>
                <span className="bs-right">
                  <span className="bs-big" style={{ color: b.c }}>
                    {Math.round(s.comfort)}<small> /100</small>
                  </span>
                  <br />
                  <span className="bs-band" style={{ color: b.c, background: b.bg }}>{b.label}</span>
                </span>
              </button>

              {isOpen && (
                <div className="bs-dests">
                  {s.dests.map((d) => {
                    const db = band(d.local, pref);
                    return (
                      <div className="bs-d" key={d.area}>
                        <span className="bs-flag" aria-hidden="true">{FLAGS[d.country]}</span>
                        <span className="bs-dbody">
                          <div className="bs-dname">{d.area}</div>
                          <div className="bs-dwhy">{d.why}</div>
                          {d.ap && <span className="bs-ap">✈ {d.ap}</span>}
                        </span>
                        <span className="bs-dright">
                          <span className="bs-dtemp" style={{ color: db.c }}>{show(d.local)}</span>
                          <span className="bs-dband" style={{ color: db.c, background: db.bg }}>{db.label}</span>
                          <span className="bs-drate" title="Tourism score out of 10">★ {d.sc.toFixed(1)}</span>
                        </span>
                      </div>
                    );
                  })}
                  <button
                    className="bs-seemore"
                    onClick={() => { setSeaPick(s.id); setMode("sea"); setOpen(null); }}
                  >
                    📈 When is {s.name} at its best? →
                  </button>
                </div>
              )}
            </div>
          );
        })}

        <p className="bs-foot">
          Comfort curve (relative to your preferred temp, default 26.5°C): ±1° around it = 100 ·
          cooler loses 5 pts/°C for the next 2.5°, then 10 pts/°C · warmer loses 14 pts/°C ·
          clamped at 0. Bands shift with your preference too. At the default, Fresh but great is
          23–25.5°, Bracing 20–23°, Cold below 20°. Water temperatures are long-term climatology
          averages (NOAA OISST style), interpolated day by day across your dates. ✈ marks
          destinations with an international airport in or right by the resort town. Destinations
          rank by tourism score (infrastructure 25%, food, sights & safety 20% each, flights 15%).
        </p>

        <div className="bs-links">
          <button onClick={() => setLegal("terms")}>Terms of Service</button>
          <button onClick={() => setLegal("privacy")}>Privacy Policy</button>
          <button onClick={() => setLegal("disclaimer")}>Data Disclaimer</button>
          <button onClick={withdrawConsent}>Cookie & Consent settings</button>
        </div>
        <div className="bs-vtag">BestSea v1.0 · no accounts · your data stays on your device</div>
      </div>

      {/* ---------- legal modal ---------- */}
      {legal && (
        <div className="bs-overlay" onClick={(e) => { if (e.target === e.currentTarget) setLegal(null); }}>
          <div className="bs-sheet" role="dialog" aria-modal="true" aria-label={LEGAL[legal].title}>
            <button className="bs-close" aria-label="Close" onClick={() => setLegal(null)}>✕</button>
            <h2>{LEGAL[legal].title}</h2>
            <p style={{ fontSize: "11.5px", color: "#7A959D" }}>Last updated: July 2026 · v1.0</p>
            {LEGAL[legal].body.map(([h, t]) => (
              <div key={h}>
                <h3>{h}</h3>
                <p>{t}</p>
              </div>
            ))}
            <div className="bs-cta">
              <button className="bs-btn bs-btn-ghost" onClick={() => setLegal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- consent gate (shown until accepted) ---------- */}
      {consent === null && !legal && (
        <div className="bs-overlay">
          <div className="bs-sheet" role="dialog" aria-modal="true" aria-label="Terms and privacy consent">
            <h2>Before you dive in 🌊</h2>
            <p>
              BestSea stores your settings (dates, filters, preferred temperature) in private storage on
              your device only. No accounts, no tracking, nothing leaves your device.
            </p>
            <div className="bs-legal-links">
              By continuing you accept the{" "}
              <button onClick={() => setLegal("terms")}>Terms of Service</button> and{" "}
              <button onClick={() => setLegal("privacy")}>Privacy Policy</button>, and acknowledge the{" "}
              <button onClick={() => setLegal("disclaimer")}>Data Disclaimer</button>. Temperatures are
              long-term averages, not live measurements.
            </div>
            <div className="bs-optrow">
              <input
                id="bsAnalytics" type="checkbox" checked={analyticsOpt}
                onChange={(e) => setAnalyticsOpt(e.target.checked)}
              />
              <label htmlFor="bsAnalytics">
                <b>Optional: anonymous usage analytics.</b> Off by default. In this version the choice
                is only recorded; no usage data is transmitted anywhere.
              </label>
            </div>
            <div className="bs-cta">
              <button className="bs-btn bs-btn-primary" onClick={() => saveConsent(analyticsOpt)}>
                Accept & continue
              </button>
              <button className="bs-btn bs-btn-ghost" onClick={() => saveConsent(false)}>
                Essential only
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
