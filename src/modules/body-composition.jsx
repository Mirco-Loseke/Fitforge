// ─── Körperwerte von der Waage (Starfit & Co. → Apple Health → Kurzbefehl) ───
// health.body[YYYY-MM-DD] = { weight, bodyFat, leanMass, bmi, muscleMass, water, boneMass, visceralFat, bmr }
// Gewicht wird zusätzlich automatisch in data.weightHistory übernommen (siehe FitForge-Import).

const FF_BODY_FIELDS = [
  ["weight", "Gewicht", "kg", "#FF6B35", false],
  ["bodyFat", "Körperfett", "%", "#EF476F", false],
  ["muscleMass", "Muskelmasse", "kg", "#06D6A0", true],
  ["leanMass", "Magermasse", "kg", "#4CC9F0", true],
  ["water", "Wasser", "%", "#00D9C0", true],
  ["bmi", "BMI", "", "#A78BFA", false],
  ["visceralFat", "Viszeralfett", "", "#FFD166", false],
  ["boneMass", "Knochen", "kg", "#C4B5FD", true],
  ["bmr", "Grundumsatz", "kcal", "#F0EDE8", true],
];

function BodySpark({ vals, color }) {
  if (vals.length < 2) return null;
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * 100},${28 - ((v - min) / span) * 24}`).join(" ");
  return <svg viewBox="0 0 100 30" preserveAspectRatio="none" style={{ width: "100%", height: 26, marginTop: 6 }}><polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

function BodyCompositionCard({ health, isMobile }) {
  const rows = Object.values(health?.body || {}).filter(r => r && r.date).sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const ref = rows.find(r => r.date >= monthAgo) || rows[0];
  const fields = FF_BODY_FIELDS.filter(([k]) => rows.some(r => r[k] != null));
  const fmt = (v) => v == null ? "–" : (Math.round(v * 10) / 10).toLocaleString("de-DE");
  return (
    <div className="chalCardIn" style={{ marginBottom: 18, padding: isMobile ? 16 : 20, borderRadius: 20, background: "linear-gradient(150deg, rgba(76,201,240,0.10), rgba(22,22,28,0.6) 60%)", border: "1px solid rgba(76,201,240,0.28)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: 1 }}>⚖️ Körperwerte von der Waage</div>
          <div style={{ fontSize: 12, color: "#777", marginTop: 2 }}>Letzte Messung: {new Date(last.date + "T12:00:00").toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" })}{last.time ? `, ${last.time}` : ""}</div>
        </div>
        <div style={{ fontSize: 11, color: "#666" }}>Δ seit {new Date(ref.date + "T12:00:00").toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${isMobile ? 2 : 3}, minmax(0,1fr))`, gap: 8 }}>
        {fields.map(([k, label, unit, color, upGood]) => {
          const v = [...rows].reverse().find(r => r[k] != null)?.[k];
          const r0 = ref[k], d = v != null && r0 != null ? v - r0 : null;
          const good = d == null || Math.abs(d) < 0.05 ? null : (k === "weight" ? null : (d > 0) === upGood);
          const series = rows.filter(r => r[k] != null).slice(-30).map(r => r[k]);
          return (
            <div key={k} style={{ padding: "10px 12px", borderRadius: 14, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: "#777", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 2 }}>
                <span style={{ fontSize: 20, fontWeight: 900, color }}>{fmt(v)}</span><span style={{ fontSize: 11, color: "#777" }}>{unit}</span>
                {d != null && Math.abs(d) >= 0.05 && <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 800, color: good == null ? "#aaa" : good ? "#06D6A0" : "#EF476F" }}>{d > 0 ? "+" : ""}{fmt(d)}</span>}
              </div>
              <BodySpark vals={series} color={color} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
