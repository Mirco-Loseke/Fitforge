// Nimmt Apple-Health-Daten vom iPhone-Kurzbefehl entgegen und legt sie in
// fitforge/<uid>_health ab. Die App importiert daraus Trainings in den Verlauf
// und zeigt Schlaf/Tageswerte auf der Seite "Schlaf & Gesundheit".
//
// POST /api/health   Authorization: Bearer <Health-Token aus der App>
// Body (JSON), einzeln oder als Array bzw. { items: [...] }:
//   { type:"workout", name, start, end, kcal, km, hrAvg, hrMax }
//   { type:"sleep",   samples: "<Stufe>;<Start>;<Ende>\n..."  (oder Array von {value,start,end}) }
//   { type:"daily",   date, <Wert>: Zahl  |  <Wert>List: "72\n75\n80" }   – Schlüssel siehe METRICS (steps, restingHR, hrv, vo2max, spo2 …)
//   { type:"series",  metric:"<Schlüssel aus METRICS>", samples:"<Wert>;<Datum>\n..." (oder Array von {value,date}) }
//                     – Verlauf/Massenimport: Werte werden pro Tag zusammengefasst (Summe, Ø, Min, Max oder letzter)
//   { type:"body",    date, weight, bodyFat, leanMass, bmi, muscleMass, water, boneMass, visceralFat, bmr }  (Waage)
// Datumsangaben: ISO 8601 bevorzugt; deutsche Formate ("30.09.2026, 07:12") gehen auch.
import { getAdmin, uidFromToken, cors } from "./_lib.js";

const num = (v) => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  let s = String(v).replace(/\s/g, "");
  // Deutsche Zahlen: "8.412" / "1.234,5" → Punkte sind Tausendertrenner
  if (/\d\.\d{3}(\D|$)/.test(s) && !/\d\.\d{1,2}(\D|$)/.test(s.replace(/\.\d{3}(?=\D|$|\.)/g, ""))) s = s.replace(/\.(?=\d{3}(\D|$|[.,]))/g, "");
  const m = s.replace(",", ".").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
};
// Kurzbefehle liefert Zahlenlisten oft als "72\n75\n80" – daraus Ø/Max/Summe bilden
const nums = (v) => Array.isArray(v) ? v.map(num).filter(x => x != null)
  : String(v ?? "").split(/[\n;|]+/).map(num).filter(x => x != null);

const MONTHS = { jan:1, feb:2, mär:3, mar:3, märz:3, apr:4, mai:5, may:5, jun:6, jul:7, aug:8, sep:9, sept:9, okt:10, oct:10, nov:11, dez:12, dec:12 };
const parseDate = (v) => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return new Date(v < 1e12 ? v * 1000 : v);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) { const d = new Date(s); return isNaN(d) ? null : d; }
  // 30.09.2026, 07:12  |  30.09.26 07:12
  let m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})\D+(\d{1,2}):(\d{2})/) || s.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (m) return berlin(+(m[3].length === 2 ? "20" + m[3] : m[3]), +m[2], +m[1], +(m[4] || 0), +(m[5] || 0));
  // 30. Sept. 2026 um 07:12
  m = s.match(/(\d{1,2})\.\s*([A-Za-zä]+)\.?\s*(\d{4})\D+(\d{1,2}):(\d{2})/);
  if (m && MONTHS[m[2].toLowerCase()]) return berlin(+m[3], MONTHS[m[2].toLowerCase()], +m[1], +m[4], +m[5]);
  const d = new Date(s); return isNaN(d) ? null : d;
};
// Lokale Zeit Europe/Berlin → echte UTC-Zeit
function berlin(y, mo, d, h, mi) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off = offsetMin(new Date(guess));
  return new Date(guess - off * 60000);
}
function offsetMin(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(date).map(x => [x.type, x.value]));
  return (Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute) - date.getTime()) / 60000;
}
const berlinDay = (d) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);
const berlinTime = (d) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }).format(d);

function parseWorkout(it) {
  const start = parseDate(it.start || it.startDate), end = parseDate(it.end || it.endDate);
  if (!start) throw new Error("workout: start fehlt/unlesbar");
  let durMin = num(it.duration);
  if (end && (!durMin || durMin <= 0)) durMin = (end - start) / 60000;
  if (durMin && durMin > 600) durMin = durMin / 60; // Sekunden statt Minuten geschickt
  const hr = nums(it.hr || it.heartRates);
  const w = {
    id: "hk_" + start.getTime(),
    name: String(it.name || it.activity || "Apple Watch Training").slice(0, 60),
    date: berlinDay(start), startTime: berlinTime(start),
    endTime: end ? berlinTime(end) : null,
    startTs: start.getTime(), endTs: end ? end.getTime() : null,
    duration: Math.round(durMin || 0),
    kcal: Math.round(num(it.kcal) ?? nums(it.kcalList).reduce((a, b) => a + b, 0)) || null,
    km: (() => { let k = num(it.km); if (k == null) { const m = num(it.meters); if (m != null) k = m / 1000; } return k != null ? Math.round(k * 100) / 100 : null; })(),
    hrAvg: num(it.hrAvg) ?? (hr.length ? Math.round(hr.reduce((a, b) => a + b, 0) / hr.length) : null),
    hrMax: num(it.hrMax) ?? (hr.length ? Math.max(...hr) : null),
    receivedAt: Date.now(),
  };
  if (w.hrAvg) w.hrAvg = Math.round(w.hrAvg);
  return w;
}

const stageOf = (v) => {
  const s = String(v || "").toLowerCase();
  if (/tief|deep/.test(s)) return "deep";
  if (/rem/.test(s)) return "rem";
  if (/kern|core|leicht|light/.test(s)) return "core";
  if (/wach|awake/.test(s)) return "awake";
  if (/bett|bed/.test(s)) return "inBed";
  return "asleep"; // "Schlafend"/"Asleep"/unspezifisch
};
function parseSleep(it) {
  let rows = it.samples;
  if (typeof rows === "string") rows = rows.split(/\n+/).map(l => { const [value, start, end] = l.split(/\s*;\s*/); return { value, start, end }; });
  if (!Array.isArray(rows)) throw new Error("sleep: samples fehlt");
  const segs = rows.map(r => ({ stage: stageOf(r.value), s: parseDate(r.start), e: parseDate(r.end) }))
    .filter(x => x.s && x.e && x.e > x.s);
  if (!segs.length) throw new Error("sleep: keine lesbaren Einträge");
  const min = { deep: 0, rem: 0, core: 0, awake: 0, asleep: 0, inBed: 0 };
  // Überlappungen (Uhr + iPhone melden beide) nicht doppelt zählen: pro Stufe Intervalle vereinigen
  for (const st of Object.keys(min)) {
    const iv = segs.filter(x => x.stage === st).map(x => [x.s.getTime(), x.e.getTime()]).sort((a, b) => a[0] - b[0]);
    let cur = null;
    for (const [a, b] of iv) { if (!cur || a > cur[1]) { if (cur) min[st] += (cur[1] - cur[0]) / 60000; cur = [a, b]; } else cur[1] = Math.max(cur[1], b); }
    if (cur) min[st] += (cur[1] - cur[0]) / 60000;
  }
  const staged = min.deep + min.rem + min.core;
  const asleep = staged > 0 ? staged : min.asleep;
  const sleepSegs = segs.filter(x => x.stage !== "awake" && x.stage !== "inBed");
  const src = sleepSegs.length ? sleepSegs : segs;
  const bed = new Date(Math.min(...src.map(x => x.s.getTime())));
  const wake = new Date(Math.max(...src.map(x => x.e.getTime())));
  const r = (x) => Math.round(x);
  return {
    date: berlinDay(wake), // Nacht wird dem Aufwach-Tag zugeordnet
    asleepMin: r(asleep), deepMin: r(min.deep), remMin: r(min.rem), coreMin: r(min.core), awakeMin: r(min.awake),
    bedtime: berlinTime(bed), wakeTime: berlinTime(wake), bedTs: bed.getTime(), wakeTs: wake.getTime(),
    receivedAt: Date.now(),
  };
}

// Tageswerte: Schlüssel → [Zusammenfassung pro Tag, Nachkommastellen, Umrechnung, Aliase]
// Gleiche Schlüssel wie FF_HEALTH_GROUPS in src/modules/health-metrics.jsx (Anzeige).
const pct = (v) => (v > 0 && v <= 1 ? v * 100 : v);
const toKm = (v) => (v > 300 ? v / 1000 : v); // Meter statt km geschickt
const METRICS = {
  steps: ["sum", 0], distanceKm: ["sum", 2, toKm, ["km", "distance"]], flights: ["sum", 0, null, ["floors"]],
  kcal: ["sum", 0, null, ["activeKcal", "activeEnergy"]], basalKcal: ["sum", 0, null, ["restingKcal", "basalEnergy"]],
  exerciseMin: ["sum", 0], standHours: ["sum", 0, null, ["standH"]], daylightMin: ["sum", 0],
  restingHR: ["avg", 0], walkingHR: ["avg", 0], hrAvg: ["avg", 0, null, ["hr", "heartRate"]], hrMin: ["min", 0], hrMax: ["max", 0], hrv: ["avg", 0],
  vo2max: ["last", 1], walkingSpeed: ["avg", 1], cycleKm: ["sum", 2, toKm], swimM: ["sum", 0],
  spo2: ["avg", 0, pct, ["oxygen", "bloodOxygen"]], respRate: ["avg", 1], bodyTemp: ["avg", 1], wristTemp: ["avg", 2],
  bpSys: ["avg", 0, null, ["systolic"]], bpDia: ["avg", 0, null, ["diastolic"]], glucose: ["avg", 0],
  waterMl: ["sum", 0, (v) => (v > 0 && v < 10 ? v * 1000 : v), ["water"]], caffeineMg: ["sum", 0, null, ["caffeine"]], mindfulMin: ["sum", 0], noiseDb: ["avg", 0],
};
const aggregate = (vals, how) => !vals.length ? null
  : how === "sum" ? vals.reduce((a, b) => a + b, 0)
  : how === "avg" ? vals.reduce((a, b) => a + b, 0) / vals.length
  : how === "min" ? Math.min(...vals) : how === "max" ? Math.max(...vals) : vals[vals.length - 1];
const roundTo = (v, dec) => Math.round(v * 10 ** dec) / 10 ** dec;
const metricKey = (name) => {
  const n = String(name || "").replace(/List$/, "");
  return METRICS[n] ? n : Object.keys(METRICS).find(k => (METRICS[k][3] || []).includes(n)) || null;
};

function parseDaily(it) {
  const d = parseDate(it.date) || new Date();
  const out = { date: typeof it.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(it.date) ? it.date : berlinDay(d), receivedAt: Date.now() };
  for (const [field, raw] of Object.entries(it)) {
    const k = metricKey(field);
    if (!k || raw == null || raw === "") continue;
    const [how, dec, conv] = METRICS[k];
    // Listen ("72\n75\n80" oder xyzList) passend zusammenfassen, Einzelwert direkt übernehmen
    const isList = /List$/.test(field) || Array.isArray(raw) || (typeof raw === "string" && /[\n;|]/.test(raw));
    let vals = isList ? nums(raw) : [num(raw)].filter(x => x != null);
    if (conv) vals = vals.map(conv);
    const v = aggregate(vals, isList ? how : "last");
    if (v != null && isFinite(v)) out[k] = roundTo(v, dec);
  }
  return out;
}

// Verlauf eines Werts (z. B. 365 Tage Ruhepuls) → pro Tag (Europe/Berlin) zusammenfassen
function parseSeries(it) {
  const k = metricKey(it.metric);
  if (!k) throw new Error(`series: unbekannter metric "${it.metric}"`);
  const [how, dec, conv] = METRICS[k];
  let rows = it.samples;
  if (typeof rows === "string") rows = rows.split(/\n+/).map(l => { const [value, date] = l.split(/\s*;\s*/); return { value, date }; });
  if (!Array.isArray(rows)) throw new Error("series: samples fehlt");
  const byDay = {};
  for (const r of rows) {
    const dt = parseDate(r.date || r.start || r.startDate); let v = num(r.value);
    if (!dt || v == null) continue;
    if (conv) v = conv(v);
    (byDay[berlinDay(dt)] = byDay[berlinDay(dt)] || []).push(v);
  }
  const out = {};
  for (const [day, vals] of Object.entries(byDay)) out[day] = { date: day, [k]: roundTo(aggregate(vals, how), dec), receivedAt: Date.now() };
  if (!Object.keys(out).length) throw new Error(`series ${k}: keine lesbaren Werte`);
  return out;
}

// Waage (z. B. Starfit → Apple Health): mehrere Werte pro Tag → letzter zählt
function parseBody(it) {
  const d = parseDate(it.date || it.start || it.startDate) || new Date();
  const out = { date: typeof it.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(it.date) ? it.date : berlinDay(d), time: berlinTime(d), receivedAt: Date.now() };
  const lastOf = (v) => { const a = nums(v); return a.length ? a[a.length - 1] : null; };
  for (const k of ["weight", "bodyFat", "leanMass", "bmi", "muscleMass", "water", "boneMass", "visceralFat", "bmr"]) {
    let v = lastOf(it[k]);
    if (v == null) continue;
    if ((k === "bodyFat" || k === "water") && v > 0 && v <= 1) v *= 100; // Health liefert Prozent teils als 0,18
    if (k === "weight" && v > 400) v /= 1000;                              // Gramm statt kg
    out[k] = Math.round(v * 10) / 10;
  }
  if (out.weight == null && out.bodyFat == null) throw new Error("body: weight/bodyFat fehlt");
  return out;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST erwartet" });
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "") || req.query?.token;
  let uid;
  try { uid = uidFromToken(token); } catch (e) { return res.status(500).json({ error: "Server nicht eingerichtet: " + e.message }); }
  if (!uid) return res.status(401).json({ error: "Ungültiger Health-Token" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { return res.status(400).json({ error: "Kein gültiges JSON" }); } }
  const items = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : [body];

  const add = { workouts: {}, sleep: {}, daily: {}, body: {} }, errors = [];
  for (const it of items) {
    try {
      const t = String(it?.type || "").toLowerCase();
      if (t === "workout") { const w = parseWorkout(it); add.workouts[w.id] = w; }
      else if (t === "sleep") { const s = parseSleep(it); add.sleep[s.date] = s; }
      else if (t === "daily") { const d = parseDaily(it); add.daily[d.date] = { ...(add.daily[d.date] || {}), ...d }; }
      else if (t === "series") { for (const [d, v] of Object.entries(parseSeries(it))) add.daily[d] = { ...(add.daily[d] || {}), ...v }; }
      else if (t === "body") { const b = parseBody(it); add.body[b.date] = { ...(add.body[b.date] || {}), ...b }; }
      else errors.push(`Unbekannter type "${it?.type}"`);
    } catch (e) { errors.push(e.message); }
  }
  const n = Object.keys(add.workouts).length + Object.keys(add.sleep).length + Object.keys(add.daily).length + Object.keys(add.body).length;
  if (!n) return res.status(400).json({ error: "Nichts Verwertbares empfangen", details: errors });

  try {
    const db = getAdmin().firestore();
    const ref = db.collection("fitforge").doc(`${uid}_health`);
    await db.runTransaction(async (t) => {
      const snap = await t.get(ref);
      const cur = (snap.exists && snap.data().value) || {};
      const next = {
        workouts: { ...(cur.workouts || {}), ...add.workouts },
        sleep: { ...(cur.sleep || {}), ...add.sleep },
        // Tageswerte feldweise mergen (Schritte am Abend, Ruhepuls am Morgen …)
        daily: { ...(cur.daily || {}) },
        body: { ...(cur.body || {}) },
      };
      for (const [d, v] of Object.entries(add.daily)) next.daily[d] = { ...(next.daily[d] || {}), ...v };
      for (const [d, v] of Object.entries(add.body)) next.body[d] = { ...(next.body[d] || {}), ...v };
      t.set(ref, { value: next, updatedAt: Date.now() });
    });
    return res.status(200).json({ ok: true, saved: { workouts: Object.keys(add.workouts).length, sleep: Object.keys(add.sleep).length, daily: Object.keys(add.daily).length, body: Object.keys(add.body).length }, warnings: errors });
  } catch (e) {
    return res.status(500).json({ error: "Speichern fehlgeschlagen: " + e.message });
  }
}

export const _test = { parseWorkout, parseSleep, parseDaily, parseSeries, parseBody, parseDate };
