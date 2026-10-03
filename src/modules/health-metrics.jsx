// ─── Alle Gesundheitswerte (Apple Health → /api/health type daily/series) ────
// health.daily[YYYY-MM-DD] = { steps, restingHR, hrv, vo2max, spo2, … }  – Schlüssel siehe FF_HEALTH_METRICS.
// Der Server (api/health.js, METRICS) kennt dieselben Schlüssel. Neue Werte: dort UND hier eintragen.
// [key, Label, Einheit, Farbe, Nachkommastellen, besser: "up" | "down" | null]
const FF_HEALTH_GROUPS = [
  ["🔥 Aktivität", [
    ["steps", "Schritte", "", "#00D9C0", 0, "up"],
    ["distanceKm", "Strecke", "km", "#06D6A0", 1, "up"],
    ["kcal", "Aktive Energie", "kcal", "#FF6B6B", 0, "up"],
    ["basalKcal", "Ruheenergie", "kcal", "#FF9F7A", 0, null],
    ["exerciseMin", "Trainingsminuten", "min", "#FFD166", 0, "up"],
    ["standHours", "Stehstunden", "h", "#4CC9F0", 0, "up"],
    ["flights", "Etagen", "", "#A78BFA", 0, "up"],
    ["daylightMin", "Tageslicht", "min", "#FFE08A", 0, "up"],
  ]],
  ["❤️ Herz", [
    ["restingHR", "Ruhepuls", "bpm", "#EF476F", 0, "down"],
    ["hrv", "HRV", "ms", "#A78BFA", 0, "up"],
    ["walkingHR", "Puls beim Gehen", "bpm", "#FF6B8B", 0, "down"],
    ["hrAvg", "Ø Puls", "bpm", "#F78C6B", 0, null],
    ["hrMin", "Puls min", "bpm", "#4CC9F0", 0, null],
    ["hrMax", "Puls max", "bpm", "#FF6B35", 0, null],
  ]],
  ["🏃 Fitness", [
    ["vo2max", "VO₂max", "ml/kg·min", "#06D6A0", 1, "up"],
    ["walkingSpeed", "Gehtempo", "km/h", "#4CC9F0", 1, "up"],
    ["cycleKm", "Radfahren", "km", "#FFD166", 1, "up"],
    ["swimM", "Schwimmen", "m", "#4361EE", 0, "up"],
  ]],
  ["🩺 Vitalwerte", [
    ["spo2", "Blutsauerstoff", "%", "#4CC9F0", 0, "up"],
    ["respRate", "Atemfrequenz", "/min", "#A78BFA", 1, null],
    ["bpSys", "Blutdruck sys.", "mmHg", "#EF476F", 0, "down"],
    ["bpDia", "Blutdruck dia.", "mmHg", "#FF8FA3", 0, "down"],
    ["glucose", "Blutzucker", "mg/dl", "#FFD166", 0, null],
    ["bodyTemp", "Körpertemperatur", "°C", "#FF9F7A", 1, null],
    ["wristTemp", "Handgelenk-Temp. Abw.", "°C", "#FFB38A", 2, null],
  ]],
  ["🧘 Lebensstil", [
    ["waterMl", "Wasser (Health)", "ml", "#4CC9F0", 0, "up"],
    ["caffeineMg", "Koffein", "mg", "#C08552", 0, null],
    ["mindfulMin", "Achtsamkeit", "min", "#A78BFA", 0, "up"],
    ["noiseDb", "Umgebungslärm", "dB", "#888", 0, "down"],
  ]],
];
const FF_HEALTH_METRIC_KEYS = FF_HEALTH_GROUPS.flatMap(([, ms]) => ms.map(m => m[0]));

const ffFmtNum = (v, dec) => v == null || !isFinite(v) ? "–" : Number(v).toLocaleString("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: dec });

function HealthMetricsSection({ health, isMobile }) {
  const [open, setOpen] = useState(null);   // key des aufgeklappten Werts
  const [range, setRange] = useState(30);
  const days = Object.values(health?.daily || {}).filter(d => d && d.date).sort((a, b) => a.date.localeCompare(b.date));
  if (!days.length) return null;
  const cut = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const avgOf = (rows, k) => { const v = rows.map(r => r[k]).filter(x => x != null && isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const last30 = days.filter(d => d.date >= cut(30)), prev30 = days.filter(d => d.date >= cut(60) && d.date < cut(30));
  const groups = FF_HEALTH_GROUPS.map(([title, ms]) => [title, ms.filter(m => days.some(d => d[m[0]] != null))]).filter(([, ms]) => ms.length);
  if (!groups.length) return null;
  const card = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 18, padding: isMobile ? 16 : 20, marginBottom: 16 };
  return (
    <div style={card}>
      <div style={{ fontSize: 13, fontWeight: 800, color: "#888", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>📋 Alle Gesundheitswerte</div>
      <div style={{ fontSize: 11, color: "#555", marginBottom: 12 }}>Tippe einen Wert an für den Verlauf · Ø und Trend der letzten 30 Tage</div>
      {groups.map(([title, ms]) => (
        <div key={title} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#F0EDE8", margin: "4px 0 8px" }}>{title}</div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,minmax(0,1fr))" : "repeat(4,minmax(0,1fr))", gap: 8 }}>
            {ms.map(([k, label, unit, color, dec, better]) => {
              const lastRow = [...days].reverse().find(d => d[k] != null);
              const a = avgOf(last30, k), p = avgOf(prev30, k);
              const diff = a != null && p ? (a - p) / Math.abs(p) * 100 : null;
              const good = diff == null || !better || Math.abs(diff) < 2 ? null : (diff > 0) === (better === "up");
              const spark = days.filter(d => d.date >= cut(30) && d[k] != null).map(d => d[k]);
              const on = open === k;
              return (
                <button key={k} onClick={() => setOpen(on ? null : k)} style={{ all: "unset", cursor: "pointer", boxSizing: "border-box", background: on ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.25)", border: `1px solid ${on ? color : "transparent"}`, borderRadius: 14, padding: "10px 10px 6px", minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: "#888", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 2 }}>
                    <span style={{ fontSize: isMobile ? 18 : 20, fontWeight: 800, color, fontFamily: "'DM Sans',sans-serif" }}>{ffFmtNum(lastRow?.[k], dec)}</span>
                    <span style={{ fontSize: 10, color: "#666" }}>{unit}</span>
                  </div>
                  <div style={{ fontSize: 10, color: "#666", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    Ø {ffFmtNum(a, dec)}{diff != null && Math.abs(diff) >= 1 ? <span style={{ color: good == null ? "#888" : good ? "#06D6A0" : "#FFD166", marginLeft: 4 }}>{diff > 0 ? "▲" : "▼"}{Math.abs(Math.round(diff))}%</span> : null}
                  </div>
                  {spark.length > 1 && typeof BodySpark === "function" ? <BodySpark vals={spark} color={color} /> : <div style={{ height: 6 }} />}
                </button>
              );
            })}
          </div>
          {ms.some(m => m[0] === open) && (() => {
            const m = ms.find(x => x[0] === open);
            const rows = days.filter(d => d.date >= cut(range) && d[m[0]] != null);
            return (
              <div style={{ marginTop: 8 }}>
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  {[[30, "30 T"], [90, "90 T"], [365, "1 J"]].map(([n, l]) => <button key={n} onClick={() => setRange(n)} style={{ ...s.secBtn, padding: "4px 10px", fontSize: 11, background: range === n ? "rgba(255,107,53,0.18)" : undefined, color: range === n ? "#FF8C60" : undefined }}>{l}</button>)}
                </div>
                {rows.length ? <FFChart chart={{ kind: ["steps", "kcal", "exerciseMin", "standHours", "flights", "daylightMin", "mindfulMin", "waterMl", "caffeineMg", "distanceKm", "cycleKm", "swimM", "basalKcal"].includes(m[0]) ? "bar" : "line", title: m[1], unit: m[2], labels: rows.map(r => r.date.slice(8, 10) + "." + r.date.slice(5, 7)), series: [{ name: m[1], values: rows.map(r => r[m[0]]), color: m[3] }] }} /> : <div style={{ fontSize: 12, color: "#666", padding: 10 }}>Keine Werte in diesem Zeitraum.</div>}
              </div>
            );
          })()}
        </div>
      ))}
    </div>
  );
}
