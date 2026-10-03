// ─── KI-Coach: Vollzugriff auf Nutzerdaten + Diagramme im Chat ───────────────
// ffBuildFullData(): kompakte Zusammenfassung ALLER Nutzerdaten (Training, Ernährung, Schlaf,
// Tageswerte, Körperwerte, Maße, Profil, Challenges) für den KI-Kontext.
// FFChart: rendert {"type":"chart"}-Aktionen der KI als Linien-/Balkendiagramm.
// ffChatLoad/ffChatSave: Chatverlauf bleibt erhalten (localStorage, ohne Fotos).

const ffDaysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const ffR = (v, d = 0) => { const n = parseFloat(v); if (!isFinite(n)) return undefined; const k = Math.pow(10, d); return Math.round(n * k) / k; };

function ffBuildFullData({ data, user, nutrition, health, challenges, weekPlans }) {
  const since90 = ffDaysAgo(90), since60 = ffDaysAgo(60);
  const ws = [...(data?.workouts || [])].filter(w => w && w.date).sort((a, b) => a.date.localeCompare(b.date));
  // Alle Trainings kompakt (neueste 200)
  const trainings = ws.slice(-200).map(w => {
    let saetze = 0, vol = 0, km = 0;
    (w.exercises || []).forEach(e => (e.sets || []).forEach(s => { saetze++; vol += (parseFloat(s.weight) || 0) * (parseInt(s.reps) || 0); km += parseFloat(s.km) || 0; }));
    return { d: w.date, name: w.name, min: w.duration || undefined, saetze, volKg: Math.round(vol) || undefined, km: ffR(km, 1) || undefined, uebungen: (w.exercises || []).map(e => e.name).filter(Boolean).slice(0, 12) };
  });
  // Ernährung pro Tag (90 Tage)
  const ernaehrungTage = Object.entries(nutrition || {}).filter(([d, v]) => d >= since90 && v && (v.meals || []).length).sort().map(([d, v]) => {
    const sum = k => (v.meals || []).reduce((a, m) => a + (parseFloat(m[k]) || 0), 0);
    return { d, kcal: ffR(v.calories ?? (sum("kcal") || sum("calories"))), p: ffR(v.protein ?? sum("protein")), kh: ffR(v.carbs ?? sum("carbs")), f: ffR(v.fat ?? sum("fat")), wasserMl: ffR(v.water), mahlzeiten: (v.meals || []).length };
  });
  // Häufigste Lebensmittel (90 Tage)
  const foodCount = {};
  Object.entries(nutrition || {}).filter(([d]) => d >= since90).forEach(([, v]) => (v?.meals || []).forEach(m => { if (m?.name) foodCount[m.name] = (foodCount[m.name] || 0) + 1; }));
  const haeufigeLebensmittel = Object.entries(foodCount).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([n, c]) => `${n} (${c}×)`);
  const heute = nutrition?.[todayStr()];
  const vals = (o) => Object.values(o || {}).filter(x => x && x.date && x.date >= since60).sort((a, b) => a.date.localeCompare(b.date));
  return {
    profil: { vorname: user.firstName, alter: user.age, groesseCm: user.height, gewichtKg: user.weight, ziel: user.goal, zielKcal: user.calorieGoal, zielProteinG: user.proteinGoal, zielWasserMl: user.waterGoal, supplements: user.supplements, forgePoints: user.forgePoints, arbeitstage: user.workDays },
    trainingsAlle: trainings,
    ernaehrungProTag: ernaehrungTage,
    heuteGegessen: heute ? (heute.meals || []).map(m => ({ name: m.name, typ: m.mealType, kcal: m.kcal ?? m.calories, p: m.protein })) : [],
    haeufigeLebensmittel,
    schlaf: vals(health?.sleep).map(s => ({ d: s.date, min: s.asleepMin, tief: s.deepMin, rem: s.remMin, wach: s.awakeMin, insBett: s.bedtime, auf: s.wakeTime })),
    // alle importierten Health-Tageswerte (Schlüssel siehe FF_HEALTH_GROUPS in health-metrics.jsx)
    tageswerte: vals(health?.daily).map(({ receivedAt, date, ...x }) => ({ d: date, ...x })),
    befinden1bis5: Object.entries(user.wellbeing || {}).filter(([d]) => d >= since60).sort().map(([d, v]) => ({ d, energie: v.energy, stimmung: v.mood, muskelkater: v.soreness, stress: v.stress })),
    monate: ffMonthlySummary({ data, nutrition, health, user }),
    koerperwerte: vals(health?.body).map(b => ({ d: b.date, kg: b.weight, fettPct: b.bodyFat, muskelKg: b.muscleMass, wasserPct: b.water, viszeral: b.visceralFat, bmr: b.bmr })),
    gewichtsverlauf: [...(data?.weightHistory || [])].filter(h => h?.date).sort((a, b) => a.date.localeCompare(b.date)).slice(-60).map(h => ({ d: h.date, kg: h.value })),
    koerpermasse: (data?.measurements || []).slice(-20),
    challenges: (challenges || []).slice(0, 15).map(c => ({ name: c.name || c.title, status: c.status, fortschritt: c.progress, ziel: c.goal || c.target })),
    wochenplan: weekPlans && Object.keys(weekPlans).length ? Object.fromEntries(Object.entries(weekPlans).sort().slice(-2)) : undefined,
  };
}

// Monatswerte über die GESAMTE Historie → Vergleiche wie "Mai vs. September" ohne Riesenkontext
function ffMonthlySummary({ data, nutrition, health, user }) {
  const M = {};
  const b = (d) => (M[d.slice(0, 7)] = M[d.slice(0, 7)] || { trainings: 0, minuten: 0, volKg: 0, km: 0, kcalT: [], protT: [], gewicht: [], schlaf: [], schritte: [], ruhepuls: [], energie: [] });
  const push = (arr, v) => { const n = parseFloat(v); if (isFinite(n) && n > 0) arr.push(n); };
  (data?.workouts || []).forEach(w => { if (!w?.date) return; const x = b(w.date); x.trainings++; x.minuten += w.duration || 0; (w.exercises || []).forEach(e => (e.sets || []).forEach(s => { x.volKg += (parseFloat(s.weight) || 0) * (parseInt(s.reps) || 0); x.km += parseFloat(s.km) || 0; })); });
  Object.entries(nutrition || {}).forEach(([d, v]) => { if ((v?.meals || []).length >= 2) { push(b(d).kcalT, v.calories); push(b(d).protT, v.protein); } });
  (data?.weightHistory || []).forEach(h => h?.date && push(b(h.date).gewicht, h.value));
  Object.values(health?.sleep || {}).forEach(x => x?.date && push(b(x.date).schlaf, x.asleepMin));
  Object.values(health?.daily || {}).forEach(x => { if (!x?.date) return; push(b(x.date).schritte, x.steps); push(b(x.date).ruhepuls, x.restingHR); });
  Object.entries(user?.wellbeing || {}).forEach(([d, v]) => push(b(d).energie, v?.energy));
  const avg = (a, dec = 0) => a.length ? ffR(a.reduce((x, y) => x + y, 0) / a.length, dec) : undefined;
  return Object.entries(M).sort().slice(-24).map(([m, x]) => ({
    monat: m, trainings: x.trainings, minuten: x.minuten || undefined, volKg: Math.round(x.volKg) || undefined, km: ffR(x.km, 1) || undefined,
    kcalSchnitt: avg(x.kcalT), proteinSchnitt: avg(x.protT), geloggteEssTage: x.kcalT.length || undefined,
    gewichtSchnitt: avg(x.gewicht, 1), schlafMinSchnitt: avg(x.schlaf), schritteSchnitt: avg(x.schritte), ruhepulsSchnitt: avg(x.ruhepuls), energieSchnitt: avg(x.energie, 1),
  }));
}

// Nennt die Frage einen Monat/Zeitraum außerhalb der letzten 90 Tage → Tagesdetails genau dafür mitschicken
const FF_MONTHS = ["januar", "februar", "märz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"];
function ffRangeDetails(q, { data, nutrition, health }) {
  const t = String(q || "").toLowerCase();
  const now = new Date(), months = new Set();
  FF_MONTHS.forEach((name, i) => {
    if (!new RegExp("\\b" + name.slice(0, 3) + (name.length > 3 ? "(" + name.slice(3) + ")?" : "") + "\\b").test(t)) return;
    const yr = (t.match(new RegExp(name.slice(0, 3) + "\\w*\\s+(20\\d\\d)")) || [])[1] || (i > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear());
    months.add(`${yr}-${String(i + 1).padStart(2, "0")}`);
  });
  (t.match(/20\d\d-\d\d/g) || []).forEach(m => months.add(m));
  if (/letzt\w* jahr|vorjahr/.test(t)) months.add(String(now.getFullYear() - 1));
  if (!months.size) return undefined;
  const inR = d => d && [...months].some(m => d.startsWith(m));
  return {
    zeitraum: [...months],
    trainings: (data?.workouts || []).filter(w => inR(w.date)).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 80).map(w => ({ d: w.date, name: w.name, min: w.duration, uebungen: (w.exercises || []).map(e => ({ n: e.name, s: (e.sets || []).map(s => [s.weight, s.reps].filter(x => x !== "" && x != null).join("×")).filter(Boolean) })) })),
    ernaehrung: Object.entries(nutrition || {}).filter(([d, v]) => inR(d) && (v?.meals || []).length).sort().map(([d, v]) => ({ d, kcal: v.calories, p: v.protein, mahlzeiten: (v.meals || []).length })),
    schlaf: Object.values(health?.sleep || {}).filter(x => inR(x?.date)).map(x => ({ d: x.date, min: x.asleepMin })),
    tageswerte: Object.values(health?.daily || {}).filter(x => inR(x?.date)).map(({ receivedAt, date, ...x }) => ({ d: date, ...x })),
    gewicht: (data?.weightHistory || []).filter(h => inR(h?.date)).map(h => ({ d: h.date, kg: h.value })),
  };
}

// Aus einer noch unvollständigen JSON-Antwort {"reply":"…  den bisherigen Text holen (für Streaming)
function ffPartialReply(raw) {
  const t = String(raw || "");
  const m = t.match(/"reply"\s*:\s*"/);
  if (!m) return /^\s*[{`]/.test(t) ? "" : t; // kein JSON → Rohtext anzeigen
  let i = m.index + m[0].length, out = "";
  for (; i < t.length; i++) {
    const c = t[i];
    if (c === "\\") {
      const n = t[i + 1]; if (n == null) break;
      if (n === "u") { const h = t.slice(i + 2, i + 6); if (h.length < 4) break; out += String.fromCharCode(parseInt(h, 16)); i += 5; }
      else { out += n === "n" ? "\n" : n === "t" ? "\t" : n; i++; }
    } else if (c === '"') break;
    else out += c;
  }
  return out;
}

// ── Diagramm ──
const FF_CHART_COLORS = ["#FF6B35", "#4CC9F0", "#06D6A0", "#A78BFA", "#FFD166", "#EF476F"];
function FFChart({ chart }) {
  const labels = (chart.labels || []).map(String);
  const series = (chart.series || []).filter(s => Array.isArray(s.values)).slice(0, 4);
  const n = labels.length;
  if (!n || !series.length) return null;
  const all = series.flatMap(s => s.values.map(Number).filter(isFinite));
  if (!all.length) return null;
  const isBar = chart.kind === "bar";
  let min = isBar ? Math.min(0, ...all) : Math.min(...all), max = Math.max(...all);
  if (chart.goal != null && isFinite(+chart.goal)) { min = Math.min(min, +chart.goal); max = Math.max(max, +chart.goal); }
  if (!isBar) { const pad = (max - min) * 0.1 || 1; min -= pad; max += pad; }
  const span = max - min || 1, W = 320, H = 150, L = 34, B = 20, T = 8;
  const x = i => L + (n === 1 ? (W - L) / 2 : (i / (n - 1)) * (W - L - 6));
  const y = v => T + (1 - (v - min) / span) * (H - T - B);
  const fmt = v => Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + "k" : String(Math.round(v * 10) / 10);
  const step = Math.ceil(n / 6);
  const bw = Math.max(3, ((W - L) / n) * 0.7 / series.length);
  return (
    <div style={{ marginTop: 8, padding: "10px 10px 6px", borderRadius: 14, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
      {chart.title && <div style={{ fontSize: 12, fontWeight: 800, color: "#F0EDE8", marginBottom: 4 }}>📈 {chart.title}{chart.unit ? <span style={{ color: "#777", fontWeight: 400 }}> ({chart.unit})</span> : null}</div>}
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
        {[0, 0.5, 1].map(f => { const v = min + f * span; return <g key={f}><line x1={L} x2={W} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.07)" /><text x={L - 4} y={y(v) + 3} fontSize="9" fill="#666" textAnchor="end">{fmt(v)}</text></g>; })}
        {chart.goal != null && isFinite(+chart.goal) && <g><line x1={L} x2={W} y1={y(+chart.goal)} y2={y(+chart.goal)} stroke="#06D6A0" strokeDasharray="4 3" /><text x={W - 2} y={y(+chart.goal) - 3} fontSize="9" fill="#06D6A0" textAnchor="end">Ziel {fmt(+chart.goal)}</text></g>}
        {series.map((s, si) => {
          const c = s.color || FF_CHART_COLORS[si % FF_CHART_COLORS.length];
          const pts = s.values.map((v, i) => [i, Number(v)]).filter(([, v]) => isFinite(v));
          if (isBar) return pts.map(([i, v]) => { const cx = n === 1 ? x(i) : L + ((i + 0.5) / n) * (W - L); return <rect key={si + "-" + i} x={cx - (bw * series.length) / 2 + si * bw} y={Math.min(y(v), y(Math.max(min, 0)))} width={bw - 1} height={Math.abs(y(Math.max(min, 0)) - y(v))} rx="2" fill={c} />; });
          return <g key={si}><polyline points={pts.map(([i, v]) => `${x(i)},${y(v)}`).join(" ")} fill="none" stroke={c} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />{n <= 20 && pts.map(([i, v]) => <circle key={i} cx={x(i)} cy={y(v)} r="2.6" fill={c} />)}</g>;
        })}
        {labels.map((l, i) => i % step === 0 || i === n - 1 ? <text key={i} x={isBar && n > 1 ? L + ((i + 0.5) / n) * (W - L) : x(i)} y={H - 5} fontSize="9" fill="#666" textAnchor="middle">{l.length > 6 ? l.slice(-5) : l}</text> : null)}
      </svg>
      {series.length > 1 && <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 11, color: "#999", marginTop: 2 }}>{series.map((s, si) => <span key={si} style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: 4, background: s.color || FF_CHART_COLORS[si % FF_CHART_COLORS.length] }} />{s.name}</span>)}</div>}
    </div>
  );
}

// ── Chatverlauf ──
const FF_CHAT_KEY = "ff_ai_chat_v1";
const ffChatLoad = () => { try { const j = JSON.parse(localStorage.getItem(FF_CHAT_KEY)); return Array.isArray(j) ? j : []; } catch (e) { return []; } };
const ffChatSave = (msgs) => { try { localStorage.setItem(FF_CHAT_KEY, JSON.stringify(msgs.slice(-40).map(({ image, ...m }) => m))); } catch (e) {} };
