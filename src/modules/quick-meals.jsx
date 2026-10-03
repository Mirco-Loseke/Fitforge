// ─── Schnell loggen: "Wie gestern" ───────────────────────────────────────────
// Übernimmt mit einem Tipp alle Einträge einer Mahlzeit (oder des ganzen Tages) vom Vortag.

const ffAddMealsToDay = (setNutrition, day, entries) => setNutrition(n => {
  const d = n[day] || { calories: 0, protein: 0, carbs: 0, fat: 0, meals: [] };
  const meals = [...(d.meals || []), ...entries];
  const sum = k => Math.round(meals.reduce((a, m) => a + (+m[k] || 0), 0) * 10) / 10;
  return { ...n, [day]: { ...d, meals, calories: Math.round(sum("calories")), protein: sum("protein"), carbs: sum("carbs"), fat: sum("fat") } };
});

function QuickRepeatMeals({ nutrition, setNutrition, selDate, notify }) {
  const prev = new Date(selDate + "T12:00:00"); prev.setDate(prev.getDate() - 1);
  const prevDay = prev.toISOString().slice(0, 10);
  const prevMeals = (nutrition?.[prevDay]?.meals || []).filter(m => m && m.name);
  if (!prevMeals.length) return null;
  const todayTypes = new Set((nutrition?.[selDate]?.meals || []).map(m => m.mealType));
  const groups = {};
  prevMeals.forEach(m => { const t = m.mealType || "Sonstige"; (groups[t] = groups[t] || []).push(m); });
  const open = Object.entries(groups).filter(([t]) => !todayTypes.has(t));
  if (!open.length) return null;
  const copy = (list, label) => {
    let i = 0;
    ffAddMealsToDay(setNutrition, selDate, list.map(m => ({ ...m, id: Date.now() + (i++), copiedFrom: prevDay })));
    try { ffVibrate?.(10); } catch (e) {}
    notify(`${label} wie gestern eingetragen ✅`);
  };
  const kcal = list => Math.round(list.reduce((a, m) => a + (+m.calories || 0), 0));
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: "#777", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>↻ Wie gestern</div>
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, scrollbarWidth: "none" }}>
        {open.length > 1 && <button onClick={() => copy(open.flatMap(([, l]) => l), "Alles")} style={{ flexShrink: 0, textAlign: "left", background: "rgba(255,107,53,0.12)", border: "1px solid rgba(255,107,53,0.35)", borderRadius: 12, padding: "8px 11px", cursor: "pointer", color: "#FF8C60" }}>
          <div style={{ fontSize: 12, fontWeight: 800 }}>Ganzer Tag</div>
          <div style={{ fontSize: 10 }}>{open.reduce((a, [, l]) => a + l.length, 0)} Einträge · {kcal(open.flatMap(([, l]) => l))} kcal</div>
        </button>}
        {open.map(([t, list]) => (
          <button key={t} onClick={() => copy(list, t)} title={list.map(m => m.name).join(", ")} style={{ flexShrink: 0, maxWidth: 190, textAlign: "left", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "8px 11px", cursor: "pointer", color: "#ddd" }}>
            <div style={{ fontSize: 12, fontWeight: 700 }}>{t}</div>
            <div style={{ fontSize: 10, color: "#FF8C60", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{kcal(list)} kcal · {list.map(m => m.name).join(", ")}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
