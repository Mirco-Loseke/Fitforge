// Nimmt Apple-Health-Daten vom iPhone-Kurzbefehl entgegen und legt sie in
// fitforge/<uid>_health ab. Die App importiert daraus Trainings in den Verlauf
// und zeigt Schlaf/Tageswerte auf der Seite "Schlaf & Gesundheit".
//
// POST /api/health   Authorization: Bearer <Health-Token aus der App>
// Body (JSON), einzeln oder als Array bzw. { items: [...] }:
//   { type:"workout", name, start, end, kcal, km, hrAvg, hrMax }
//   { type:"sleep",   samples: "<Stufe>;<Start>;<Ende>\n..."  (oder Array von {value,start,end}) }
//   { type:"daily",   date, steps, restingHR, hrv, kcal }
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

function parseDaily(it) {
  const d = parseDate(it.date) || new Date();
  const out = { date: typeof it.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(it.date) ? it.date : berlinDay(d), receivedAt: Date.now() };
  const steps = num(it.steps) ?? (nums(it.stepsList).reduce((a, b) => a + b, 0) || null);
  const hrvL = nums(it.hrvList);
  const vals = { steps, restingHR: num(it.restingHR), hrv: num(it.hrv) ?? (hrvL.length ? hrvL.reduce((a, b) => a + b, 0) / hrvL.length : null), kcal: num(it.kcal), exerciseMin: num(it.exerciseMin) };
  for (const [k, v] of Object.entries(vals)) if (v != null) out[k] = Math.round(v);
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

  const add = { workouts: {}, sleep: {}, daily: {} }, errors = [];
  for (const it of items) {
    try {
      const t = String(it?.type || "").toLowerCase();
      if (t === "workout") { const w = parseWorkout(it); add.workouts[w.id] = w; }
      else if (t === "sleep") { const s = parseSleep(it); add.sleep[s.date] = s; }
      else if (t === "daily") { const d = parseDaily(it); add.daily[d.date] = { ...(add.daily[d.date] || {}), ...d }; }
      else errors.push(`Unbekannter type "${it?.type}"`);
    } catch (e) { errors.push(e.message); }
  }
  const n = Object.keys(add.workouts).length + Object.keys(add.sleep).length + Object.keys(add.daily).length;
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
      };
      for (const [d, v] of Object.entries(add.daily)) next.daily[d] = { ...(next.daily[d] || {}), ...v };
      t.set(ref, { value: next, updatedAt: Date.now() });
    });
    return res.status(200).json({ ok: true, saved: { workouts: Object.keys(add.workouts).length, sleep: Object.keys(add.sleep).length, daily: Object.keys(add.daily).length }, warnings: errors });
  } catch (e) {
    return res.status(500).json({ error: "Speichern fehlgeschlagen: " + e.message });
  }
}

export const _test = { parseWorkout, parseSleep, parseDaily, parseDate };
