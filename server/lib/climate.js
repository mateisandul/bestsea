/**
 * Climate math shared by all endpoints.
 * Mirrors the frontend exactly so client and server never disagree.
 *
 * TODO: temps in data/bestsea-seed.json are hand-curated climatology
 * (NOAA OISST style). Swap in real OISST v2.1 basin means later.
 */

const DAYS_BEFORE = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
const ANCHOR = [15, 45, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];

const DEFAULT_PREF = 26.5;

function doyOf(date) {
  return DAYS_BEFORE[date.getUTCMonth()] + Math.min(date.getUTCDate(), 31);
}

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
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return n ? sum / n : NaN;
}

/** Asymmetric comfort curve, shifted by preferred temperature. */
function comfort(t, pref = DEFAULT_PREF) {
  const u = t - (pref - DEFAULT_PREF);
  let s;
  if (u >= 25.5 && u <= 27.5) s = 100;
  else if (u >= 23 && u < 25.5) s = 100 - 5 * (25.5 - u);
  else if (u < 23) s = 87.5 - 10 * (23 - u);
  else s = 100 - 14 * (u - 27.5);
  return Math.max(0, s);
}

function band(t, pref = DEFAULT_PREF) {
  const u = t - (pref - DEFAULT_PREF);
  if (u >= 29) return "Bathwater";
  if (u >= 27.5) return "Warm";
  if (u >= 25.5) return "Perfect";
  if (u >= 23) return "Fresh but great";
  if (u >= 20) return "Bracing";
  return "Cold";
}

function withOffset(m, off) {
  return off ? m.map((v, i) => v + (off[i] || 0)) : m;
}

module.exports = { DEFAULT_PREF, rangeAvg, comfort, band, withOffset };
