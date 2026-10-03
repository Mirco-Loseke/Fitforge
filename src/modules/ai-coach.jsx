// ─── KI-Assistent ─────────────────────────────────────────────────────────────
// Öffnen von überall: window.ffOpenAI({ prompt, task, autoSend })  (task: chat|plan|meal|analyze)
// Anbieter/Modell stellt der Server ein (api/ai.js). Ohne KI greift die lokale Befehlserkennung.
const AI_VIEWS = [
  ["dashboard",/dashboard|start ?seite|übersicht|home/],["log",/training starten|workout starten|loslegen/],
  ["plans",/trainingspl[aä]n|pl[aä]ne/],["history",/verlauf|historie|vergangene/],["library",/bibliothek|übungen/],
  ["stats",/statistik/],["fortschritt",/fortschritt|gewicht/],["gesundheit",/schlaf|gesundheit|puls|schritte/],
  ["wochenplan",/wochenplan|woche/],["nutrition",/ernährung|essen|kalorien|mahlzeit/],["goals",/forge ?points|punkte/],
  ["challenges",/challenge/],["profile",/profil|einstellung/]
];
const norm = s => (s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();
function localIntent(text, plans){
  const t = (text||"").toLowerCase();
  if (/(start|beginn|leg los)/.test(t)) {
    const nt = norm(t);
    let best = null, score = 0;
    (plans||[]).forEach(p => {
      const words = norm(p.name).split(" ").filter(w => w.length > 2);
      const hit = words.filter(w => nt.includes(w)).length;
      const sc = words.length ? hit / words.length : 0;
      if (sc > score) { score = sc; best = p; }
    });
    if (best && score >= 0.5) return { reply: `Starte „${best.name}“ 💪`, actions: [{ type: "start_workout", planId: best.id }] };
    if (/training|workout/.test(t)) return { reply: "Öffne Training starten.", actions: [{ type: "navigate", view: "log" }] };
  }
  if (/(öffne|oeffne|zeig|geh|wechsel|navigier|bring mich)/.test(t)) {
    const v = AI_VIEWS.find(([, re]) => re.test(t));
    if (v) return { reply: "Mach ich.", actions: [{ type: "navigate", view: v[0] }] };
  }
  return null;
}
// ── Trainingsanalyse: alles vorab berechnet, damit die KI nur noch interpretiert ──
const e1rm = (w, r) => (w > 0 && r > 0) ? Math.round(w * (1 + Math.min(r, 15) / 30) * 10) / 10 : 0; // Epley
const isoWeek = (ds) => { const d = new Date(ds + "T12:00:00"); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day + 3); const w1 = new Date(d.getFullYear(), 0, 4); return `${d.getFullYear()}-KW${String(1 + Math.round(((d - w1) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7)).padStart(2, "0")}`; };
function buildTrainingAnalytics({ data, user, nutrition, health, library }) {
  const ws = [...(data.workouts || [])].filter(w => w && w.date).sort((a, b) => a.date.localeCompare(b.date));
  const today = todayStr();
  const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
  // Muskelgruppen je Übung (Bibliothek + Pläne)
  const muscleOf = {};
  (library || []).forEach(ex => { if (ex?.name && ex.muscles?.length) muscleOf[ex.name.toLowerCase()] = ex.muscles; });
  (data.plans || []).forEach(p => (p.exercises || []).forEach(e => { if (e && typeof e === "object" && e.name && e.muscles?.length && !muscleOf[e.name.toLowerCase()]) muscleOf[e.name.toLowerCase()] = e.muscles; }));
  // Pro Übung
  const ex = {};
  ws.forEach(w => (w.exercises || []).forEach(e => {
    if (!e?.name) return;
    const sets = (e.sets || []).filter(s => s && s.done !== false);
    const x = ex[e.name] = ex[e.name] || { einheiten: 0, verlauf: [], km: 0, kcal: 0 };
    let bestW = 0, bestR = 0, best1 = 0, vol = 0, reps = 0, km = 0, kmh = 0;
    sets.forEach(s => {
      const wt = parseFloat(s.weight) || 0, r = parseInt(s.reps) || 0;
      vol += wt * r; reps += r; km += parseFloat(s.km) || 0; x.kcal += parseFloat(s.kcal) || 0;
      kmh = Math.max(kmh, parseFloat(s.tempo) || parseFloat(s.maxSpeed) || 0);
      const one = e1rm(wt, r); if (one > best1 || (wt > bestW && !one)) { best1 = one; bestW = wt; bestR = r; }
    });
    x.einheiten++; x.km += km;
    x.verlauf.push({ datum: w.date, saetze: sets.length, bestesGewicht: bestW || undefined, wdh: bestR || reps || undefined, e1rm: best1 || undefined, volumenKg: vol || undefined, km: km || undefined, kmh: kmh || undefined, min: e.duration || undefined });
  }));
  const uebungen = Object.entries(ex).map(([name, x]) => {
    const v = x.verlauf, withE = v.filter(p => p.e1rm);
    const first = withE[0], last = withE[withE.length - 1], best = withE.reduce((a, p) => (!a || p.e1rm > a.e1rm ? p : a), null);
    return {
      name, muskeln: muscleOf[name.toLowerCase()] || undefined, einheiten: x.einheiten, erstes: v[0].datum, letztes: v[v.length - 1].datum,
      tageSeitLetztem: daysBetween(v[v.length - 1].datum, today),
      ...(withE.length ? { e1rmStart: first.e1rm, e1rmAktuell: last.e1rm, e1rmBest: best.e1rm, e1rmBestDatum: best.datum, steigerungProzent: first.e1rm ? Math.round((last.e1rm / first.e1rm - 1) * 1000) / 10 : 0, volumenGesamtKg: Math.round(v.reduce((a, p) => a + (p.volumenKg || 0), 0)) } : {}),
      ...(x.km ? { kmGesamt: Math.round(x.km * 10) / 10 } : {}), ...(x.kcal ? { kcalGesamt: Math.round(x.kcal) } : {}),
      letzteEinheiten: v.slice(-5),
    };
  }).sort((a, b) => b.einheiten - a.einheiten).slice(0, 25);
  // Pro Woche (letzte 8 mit Training)
  const weeks = {};
  ws.forEach(w => {
    const k = isoWeek(w.date); const b = weeks[k] = weeks[k] || { trainings: 0, minuten: 0, volumenKg: 0, km: 0, tage: new Set() };
    b.trainings++; b.minuten += w.duration || 0; b.tage.add(w.date);
    (w.exercises || []).forEach(e => (e.sets || []).forEach(s => { b.volumenKg += (parseFloat(s.weight) || 0) * (parseInt(s.reps) || 0); b.km += parseFloat(s.km) || 0; }));
  });
  const wochen = Object.entries(weeks).sort().slice(-8).map(([k, b]) => ({ woche: k, trainings: b.trainings, trainingstage: b.tage.size, minuten: b.minuten, volumenKg: Math.round(b.volumenKg), km: Math.round(b.km * 10) / 10 }));
  // Muskelgruppen letzte 28 Tage (Sätze)
  const since28 = new Date(Date.now() - 28 * 864e5).toISOString().slice(0, 10);
  const muskelSaetze = {};
  ws.filter(w => w.date >= since28).forEach(w => (w.exercises || []).forEach(e => (muscleOf[(e.name || "").toLowerCase()] || []).forEach(m => { muskelSaetze[m] = (muskelSaetze[m] || 0) + (e.sets || []).length; })));
  // Regelmäßigkeit
  const days = [...new Set(ws.map(w => w.date))];
  let laengstePause = 0; for (let i = 1; i < days.length; i++) laengstePause = Math.max(laengstePause, daysBetween(days[i - 1], days[i]));
  const since30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const regelmaessigkeit = { trainingstageGesamt: days.length, trainingstageLetzte30: days.filter(d => d >= since30).length, laengstePauseTage: laengstePause, tageSeitLetztemTraining: days.length ? daysBetween(days[days.length - 1], today) : null, ersterTrainingstag: days[0] || null, wochentage: ws.reduce((a, w) => { const n = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][new Date(w.date + "T12:00:00").getDay()]; a[n] = (a[n] || 0) + 1; return a; }, {}), trainingsZeit: ws.reduce((a, w) => { const h = parseInt((w.startTime || "").slice(0, 2)); if (isNaN(h)) return a; const k = h < 10 ? "morgens" : h < 17 ? "tagsüber" : h < 22 ? "abends" : "nachts"; a[k] = (a[k] || 0) + 1; return a; }, {}) };
  // Körpergewicht
  const wh = [...(data.weightHistory || [])].filter(h => h?.date).sort((a, b) => a.date.localeCompare(b.date));
  const gewicht = wh.length ? { start: wh[0], aktuell: wh[wh.length - 1], veraenderungKg: Math.round((wh[wh.length - 1].value - wh[0].value) * 10) / 10, eintraege: wh.length, letzte: wh.slice(-8) } : null;
  // Ernährung letzte 7 Tage mit Einträgen
  const nd = Object.entries(nutrition || {}).filter(([d, v]) => v && (v.meals || []).length).sort().slice(-7);
  const avg = k => nd.length ? Math.round(nd.reduce((a, [, v]) => a + (+v[k] || 0), 0) / nd.length) : null;
  // Tage mit sehr wenig Einträgen sind meist nur lückenhaft geloggt → getrennt ausweisen, nicht als "zu wenig gegessen" werten
  const goalK = parseFloat(user.calorieGoal) || 2500;
  const complete = nd.filter(([, v]) => (v.meals || []).length >= 3 && (+v.calories || 0) >= goalK * 0.5);
  const avgOf = (arr, k) => arr.length ? Math.round(arr.reduce((a, [, v]) => a + (+v[k] || 0), 0) / arr.length) : null;
  const ernaehrung = nd.length ? {
    tageMitEintraegen: nd.length, davonVollstaendig: complete.length, zeitraum: [nd[0][0], nd[nd.length - 1][0]],
    schnittKcalVollstaendigeTage: avgOf(complete, "calories"), schnittProteinGVollstaendigeTage: avgOf(complete, "protein"),
    schnittKcalAlleTage: avg("calories"), zielKcal: user.calorieGoal || null, zielProteinG: user.proteinGoal || null,
    hinweis: complete.length < nd.length ? "Einige Tage sind offensichtlich nur teilweise erfasst (wenige Einträge). Daraus NICHT auf zu wenig Essen schließen, sondern ggf. vollständigeres Loggen empfehlen." : undefined,
  } : null;
  // Schlaf/Erholung (Apple Watch)
  const sl = Object.values(health?.sleep || {}).sort((a, b) => a.date.localeCompare(b.date)).slice(-7);
  const dl = Object.values(health?.daily || {}).sort((a, b) => a.date.localeCompare(b.date)).slice(-7);
  const erholung = (sl.length || dl.length) ? { schlafSchnittMin: sl.length ? Math.round(sl.reduce((a, s) => a + (s.asleepMin || 0), 0) / sl.length) : null, naechte: sl.map(s => ({ datum: s.date, min: s.asleepMin, tief: s.deepMin })), ruhepuls: dl.map(d => d.restingHR).filter(Boolean), hrv: dl.map(d => d.hrv).filter(Boolean) } : null;
  return { heute: today, uebungen, wochen, muskelSaetzeLetzte28Tage: muskelSaetze, regelmaessigkeit, gewicht, ernaehrung, erholung };
}

function buildAIContext({ data, user, prs, nutrition, view, health, library, activeWorkout, challenges, weekPlans }){
  const today = todayStr();
  // Fertig berechnete Kennzahlen – kleine Modelle verzählen sich sonst in langen Listen
  const ws = data.workouts || [];
  const byMonth = {};
  ws.forEach(w => { const m = (w.date || "").slice(0, 7); if (!m) return; const b = byMonth[m] = byMonth[m] || { trainings: 0, minuten: 0, laengstes: null }; b.trainings++; b.minuten += w.duration || 0; if (!b.laengstes || (w.duration || 0) > b.laengstes.min) b.laengstes = { name: w.name, datum: w.date, min: w.duration || 0 }; });
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  return {
    analyse: buildTrainingAnalytics({ data, user, nutrition, health, library }),
    alleDaten: ffBuildFullData({ data, user, nutrition, health, challenges, weekPlans }),
    stats: { trainingsGesamt: ws.length, letzte7Tage: ws.filter(w => w.date >= weekAgo).length, proMonat: byMonth, letztesTraining: [...ws].sort((a, b) => b.date.localeCompare(a.date))[0]?.date || null },
    view,
    uhrzeit: new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }),
    laufendesTraining: activeWorkout && activeWorkout.step === 2 ? {
      plan: (data.plans||[]).find(p => String(p.id) === String(activeWorkout.planId))?.name,
      aktuelleUebung: activeWorkout.exercises?.[activeWorkout.curEx]?.name,
      uebungen: (activeWorkout.exercises||[]).map((e, i) => ({ name: e.name, saetze: e.sets, wdh: e.reps, gewicht: e.weight, erledigt: (activeWorkout.sets?.[i]||[]).filter(x => x.done).length })),
    } : null,
    bibliothek: (library||[]).filter(l => l?.name).slice(0, 200).map(l => l.muscles?.length ? l.name + " (" + l.muscles.join(", ") + ")" : l.name),
    kiZiele: user.aiTargets || undefined,
    kiGedaechtnis: (user.coachMemory || []).map(m => m.text),
    user: { name: user.firstName, weight: user.weight, height: user.height, goal: user.goal, age: user.age },
    plans: (data.plans||[]).map(p => ({ id: p.id, name: p.name, types: p.types, exercises: (p.exercises||[]).map(e => typeof e === "string" ? e : e.name) })),
    recentWorkouts: [...(data.workouts||[])].sort((a,b)=>b.date.localeCompare(a.date)).slice(0, 15).map(w => ({
      id: w.id, date: w.date, name: w.name, duration: w.duration, health: w.health,
      exercises: (w.exercises||[]).map(e => ({ name: e.name, sets: (e.sets||[]).map(s => ({ w: s.weight, r: s.reps, km: s.km, kcal: s.kcal })) }))
    })),
    prs: Object.fromEntries(Object.entries(prs||{}).slice(0, 40).map(([k,v]) => [k, { w: v.weight, r: v.reps, date: v.date }])),
    weight: [...(data.weightHistory||[])].sort((a,b)=>b.date.localeCompare(a.date)).slice(0, 10),
    nutritionToday: nutrition?.[today] ? { meals: (nutrition[today].meals||[]).map(m => ({ name: m.name, kcal: m.kcal, protein: m.protein })) } : null,
  };
}

// Einfache Formatierung für Coach-Antworten: "## Überschrift", "• / - Stichpunkt", **fett**
function CoachText({ text }) {
  const inline = (s, k) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => p.startsWith("**") && p.endsWith("**") ? <b key={k + "-" + i} style={{ color: "#fff" }}>{p.slice(2, -2)}</b> : p);
  return <>{String(text || "").split("\n").map((line, i) => {
    const t = line.trim();
    if (!t) return <div key={i} style={{ height: 6 }} />;
    if (/^#{1,3}\s/.test(t)) return <div key={i} style={{ fontWeight: 800, color: "#FF8C60", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.4px", margin: i ? "10px 0 4px" : "0 0 4px" }}>{inline(t.replace(/^#+\s*/, ""), i)}</div>;
    if (/^[•*-]\s/.test(t)) return <div key={i} style={{ display: "flex", gap: 7, margin: "3px 0" }}><span style={{ color: "#FF8C60" }}>•</span><span>{inline(t.replace(/^[•*-]\s*/, ""), i)}</span></div>;
    return <div key={i}>{inline(t, i)}</div>;
  })}</>;
}

function AssistantSheet({ open, onClose, init, data, user, prs, nutrition, view, health, library, activeWorkout, challenges, weekPlans, onAction, notify, isMobile }){
  const [msgs, setMsgs] = useState(ffChatLoad);
  useEffect(() => { ffChatSave(msgs); }, [msgs]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [aiState, setAiState] = useState("unknown"); // unknown | ready | off
  const [pendingTask, setPendingTask] = useState(null);
  const [photo, setPhoto] = useState(null); // verkleinertes Essensfoto als data-URL
  const fileRef = useRef(null);
  // Foto auf max. 1024 px verkleinern → kleiner Upload, schnellere Antwort
  const pickPhoto = (file) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      const k = Math.min(1, 1024 / Math.max(im.width, im.height));
      const c = document.createElement("canvas"); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      setPhoto(c.toDataURL("image/jpeg", 0.8));
    };
    im.onerror = () => { URL.revokeObjectURL(url); notify("Foto konnte nicht geladen werden", "error"); };
    im.src = url;
  };
  const [doneCards, setDoneCards] = useState({});
  const [showQuick, setShowQuick] = useState(false);
  const recRef = useRef(null);
  const endRef = useRef(null);
  const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);
  useEffect(() => {
    if (!open || !init) return;
    if (init.autoSend && init.prompt) send(init.prompt, init.task);
    else if (init.prompt) setInput(init.prompt);
  }, [open, init]);
  useEffect(() => () => { try { recRef.current?.abort(); } catch(e) {} }, []);

  const runActions = (actions) => (actions||[]).forEach(a => {
    if (a.type === "navigate" || a.type === "start_workout") { onAction(a); onClose(); }
    else if (a.type === "remember" || a.type === "forget") onAction(a); // Gedächtnis sofort, wird im Chat als Chip angezeigt
  });
  const [showMemory, setShowMemory] = useState(false);

  const send = async (text, task) => {
    const img = photo;
    task = task || pendingTask || (img ? "photo" : "chat");
    const q = ((text ?? input).trim()) || (img ? "Was habe ich hier gegessen? Bitte eintragen." : "");
    if (!q || busy) return;
    setInput(""); setPendingTask(null); setPhoto(null);
    const next = [...msgs, { role: "user", content: q, image: img }];
    setMsgs(next);
    // 1) Einfache Sprachbefehle sofort lokal – funktioniert auch offline und ohne KI
    const loc = task === "chat" ? localIntent(q, data.plans) : null;
    if (loc) { setMsgs(m => [...m, { role: "assistant", content: loc.reply, actions: loc.actions }]); setTimeout(() => runActions(loc.actions), 350); return; }
    // 2) Alles andere an die KI
    if (typeof navigator !== "undefined" && navigator.onLine === false) { setMsgs(m => [...m, { role: "assistant", content: "📴 Offline – die KI braucht Internet. Befehle wie „öffne Ernährung“ oder „starte <Planname>“ gehen trotzdem." }]); return; }
    setBusy(true);
    try {
      const idt = await firebase.auth().currentUser.getIdToken();
      const r = await fetch("/api/ai", { signal: AbortSignal.timeout ? AbortSignal.timeout(70000) : undefined, method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + idt },
        body: JSON.stringify({ task, stream: true, ...(img ? { image: img } : {}), messages: next.map(m => ({ role: m.role, content: m.content })), context: { ...buildAIContext({ data, user, prs, nutrition, view, health, library, activeWorkout, challenges, weekPlans }), zeitraumDetails: ffRangeDetails(q, { data, nutrition, health }) }, preferModel: (()=>{try{return localStorage.getItem("ff_ai_model");}catch(e){return null;}})() }) });
      if (r.status === 501 || r.status === 404) { setAiState("off"); setMsgs(m => [...m, { role: "assistant", content: "🔌 Die KI ist noch nicht verbunden. Sobald ein Modell eingerichtet ist, kann ich Pläne erstellen, Gerichte vorschlagen und Trainings analysieren. Sprachbefehle wie „öffne Verlauf“ oder „starte <Planname>“ funktionieren schon jetzt." }]); }
      else if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || ("HTTP " + r.status)); }
      else {
        setAiState("ready");
        // Streaming (NDJSON: {"d":"…"} … {"done":true,reply,actions,model}) – Text erscheint, während die KI schreibt
        let j = null;
        if (/ndjson/.test(r.headers.get("content-type") || "") && r.body?.getReader) {
          const reader = r.body.getReader(), dec = new TextDecoder();
          let buf = "", raw = "", shown = false;
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const lines = buf.split("\n"); buf = lines.pop();
            for (const ln of lines) {
              if (!ln.trim()) continue;
              let ev; try { ev = JSON.parse(ln); } catch (e) { continue; }
              if (ev.error) throw new Error(ev.error);
              if (ev.done) { j = ev; continue; }
              if (ev.d) {
                raw += ev.d;
                const txt = ffPartialReply(raw);
                if (!txt) continue;
                setMsgs(m => shown ? [...m.slice(0, -1), { role: "assistant", content: txt, streaming: true }] : [...m, { role: "assistant", content: txt, streaming: true }]);
                shown = true;
              }
            }
          }
          if (!j) throw new Error("Antwort unvollständig – bitte nochmal versuchen");
          setMsgs(m => shown ? m.slice(0, -1) : m);
        } else j = await r.json().catch(() => ({}));
        try { if (j.model) localStorage.setItem("ff_ai_model", j.model); } catch(e) {}
        setMsgs(m => [...m, { role: "assistant", content: j.reply || "…", actions: j.actions }]); runActions(j.actions);
      }
    } catch(e) { setMsgs(m => [...m, { role: "assistant", content: (e.name === "TimeoutError" || e.name === "AbortError") ? "⏳ Die KI ist gerade stark ausgelastet und hat zu lange gebraucht. Bitte gleich nochmal versuchen." : "⚠️ " + e.message }]); }
    setBusy(false);
  };

  const toggleMic = () => {
    if (!SR) return notify("Spracheingabe wird von diesem Browser nicht unterstützt – nutze das 🎤 der Tastatur.", "error");
    if (listening) { try { recRef.current?.stop(); } catch(e) {} return; }
    const rec = new SR();
    rec.lang = "de-DE"; rec.interimResults = true; rec.continuous = false;
    let finalText = "";
    rec.onresult = (e) => { let t = ""; for (const r of e.results) { t += r[0].transcript; if (r.isFinal) finalText = t; } setInput(t); };
    rec.onend = () => { setListening(false); if (finalText.trim()) send(finalText); };
    rec.onerror = (e) => { setListening(false); if (e.error !== "aborted" && e.error !== "no-speech") notify("Spracheingabe: " + e.error, "error"); };
    recRef.current = rec; setListening(true);
    try { rec.start(); } catch(e) { setListening(false); }
  };

  const acceptPlan = (plan) => {
    const p = { id: Date.now(), name: plan.name || "KI-Plan", color: plan.color || "#A78BFA", days: [], muscles: plan.muscles || [], types: plan.types || [],
      exercises: (plan.exercises||[]).map(e => ({ name: e.name, photo: null, ...(e.sets ? { targetSets: e.sets } : {}), ...(e.reps ? { targetReps: String(e.reps) } : {}), ...(e.note ? { note: e.note } : {}) })),
      updatedAt: Date.now(), aiGenerated: true };
    onAction({ type: "save_plan", plan: p });
    notify(`Plan „${p.name}“ gespeichert ✅`);
  };
  // Einmal-Bestätigung pro Karte (Nachricht i, Aktion j)
  const confirmCard = (key, a, msg) => { onAction(a); setDoneCards(d => ({ ...d, [key]: true })); notify(msg); };
  const inWorkout = activeWorkout && activeWorkout.step === 2;

  if (!open) return null;
  const quick = [
    ...(inWorkout ? [["🔁 Aktuelle Übung tauschen", `Tausche meine aktuelle Übung „${activeWorkout.exercises?.[activeWorkout.curEx]?.name || ""}“ gegen eine Alternative. Grund: `, "swap", true]] : []),
    ["📈 Steigerung fürs nächste Training", "Welche Gewichte und Wiederholungen soll ich beim nächsten Training nehmen? Setz mir konkrete Ziele.", "progress"],
    ["🍳 Mahlzeit per Text eintragen", "Ich habe gegessen: ", "food", true],
    ["📷 Essen fotografieren", null, "photo", "photo"],
    ["🥗 Essensplan + Einkaufsliste", "Erstelle mir einen Essensplan für die nächsten 7 Tage passend zu meinem Ziel, mit Einkaufsliste.", "mealplan"],
    ["🗓️ Wochenrückblick", "Mach mir einen Wochenrückblick der letzten 7 Tage mit einem Ziel für nächste Woche.", "week"],
    ["🏋️ Plan erstellen", "Erstelle mir einen Trainingsplan passend zu meinen bisherigen Trainings.", "plan"],
    ["🍽️ Gericht vorschlagen", "Schlag mir ein Gericht passend zu meinen heutigen Makros vor.", "meal"],
    ["🧠 Gesamt-Check: Was läuft gut, was schlecht?", "Schau dir ALLE meine Daten an (Training, Ernährung, Schlaf, Körperwerte) und sag mir ehrlich: Was läuft gut, was schlecht, und was sind die 3 wichtigsten Hebel zur Verbesserung? Mit Diagrammen.", "insights"],
    ["📊 Komplette Trainingsanalyse", "Mach eine komplette Analyse meines Trainings: Fortschritt, Regelmäßigkeit, Balance, Erholung und nächste Schritte.", "analyze"],
    ["💪 Wo mache ich Fortschritte?", "Bei welchen Übungen werde ich stärker, wo stagniere ich? Mit Zahlen.", "analyze"],
    ["⚖️ Was trainiere ich zu wenig?", "Welche Muskelgruppen trainiere ich zu wenig und wie gleiche ich das aus?", "analyze"],
    ["📅 Was soll ich als Nächstes trainieren?", "Was sollte ich heute bzw. als nächstes trainieren, basierend auf meinen letzten Einheiten und meiner Erholung?", "analyze"],
  ];
  const bubble = (m, i) => (
    <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "88%" }}>
      <div style={{ padding: "10px 13px", borderRadius: m.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px", background: m.role === "user" ? "linear-gradient(135deg,#FF6B35,#FF8C60)" : "rgba(255,255,255,0.06)", color: m.role === "user" ? "#fff" : "#E8E5E0", fontSize: 14, lineHeight: 1.5, wordBreak: "break-word" }}>{m.image && <img src={m.image} alt="" style={{ display: "block", maxWidth: "100%", maxHeight: 200, borderRadius: 10, marginBottom: 6 }} />}{m.role === "assistant" ? <CoachText text={m.content} /> : m.content}</div>
      {(m.actions||[]).map((a, j) => (a.type === "remember" || a.type === "forget") && (a.fact || a.text) ? <div key={j} style={{ marginTop: 6, display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 12, background: "rgba(76,201,240,0.1)", border: "1px solid rgba(76,201,240,0.25)", fontSize: 11, color: "#4CC9F0", cursor: "pointer" }} onClick={() => setShowMemory(true)}>🧠 {a.type === "remember" ? "Gemerkt" : "Vergessen"}: {a.fact || a.text}</div> : a.type === "chart" && (a.chart || a.labels) ? <FFChart key={j} chart={a.chart || a} /> : a.type === "create_plan" && a.plan ? (
        <div key={j} style={{ marginTop: 8, padding: 12, borderRadius: 14, border: "1px solid rgba(167,139,250,0.3)", background: "rgba(167,139,250,0.08)" }}>
          <div style={{ fontWeight: 800, color: "#F0EDE8", marginBottom: 6 }}>📋 {a.plan.name}</div>
          {(a.plan.exercises||[]).map((e, k) => <div key={k} style={{ fontSize: 12, color: "#bbb", padding: "2px 0" }}>• {e.name}{e.sets ? ` – ${e.sets}×${e.reps||""}` : ""}</div>)}
          <button style={{ ...s.primaryBtn, marginTop: 10, width: "100%", justifyContent: "center" }} onClick={() => acceptPlan(a.plan)}>✅ Plan übernehmen</button>
        </div>
      ) : a.type === "set_targets" && (a.targets||[]).length ? (
        <div key={j} style={{ marginTop: 8, padding: 12, borderRadius: 14, border: "1px solid rgba(255,209,102,0.3)", background: "rgba(255,209,102,0.07)" }}>
          <div style={{ fontWeight: 800, color: "#F0EDE8", marginBottom: 6 }}>🎯 Ziele fürs nächste Training</div>
          {a.targets.map((t, k) => <div key={k} style={{ fontSize: 12, color: "#bbb", padding: "2px 0" }}>• <b style={{ color: "#F0EDE8" }}>{t.name}</b>: {[t.sets && `${t.sets}×`, t.reps, (t.weight || t.weight === 0) && `@ ${t.weight} kg`].filter(Boolean).join(" ")}{t.note ? <span style={{ color: "#888" }}> – {t.note}</span> : null}</div>)}
          <button disabled={doneCards[i+"-"+j]} style={{ ...s.primaryBtn, marginTop: 10, width: "100%", justifyContent: "center", opacity: doneCards[i+"-"+j] ? 0.5 : 1 }} onClick={() => confirmCard(i+"-"+j, a, "🎯 Ziele gespeichert – werden beim nächsten Start vorausgefüllt")}>{doneCards[i+"-"+j] ? "✓ Übernommen" : "✅ Ziele übernehmen"}</button>
        </div>
      ) : a.type === "swap_exercise" && a.to?.name ? (
        <div key={j} style={{ marginTop: 8, padding: 12, borderRadius: 14, border: "1px solid rgba(76,201,240,0.3)", background: "rgba(76,201,240,0.07)" }}>
          <div style={{ fontWeight: 800, color: "#F0EDE8" }}>🔁 {a.from || "Übung"} → {a.to.name}</div>
          <div style={{ fontSize: 12, color: "#4CC9F0", marginTop: 4 }}>{[a.to.sets && `${a.to.sets} Sätze`, a.to.reps && `${a.to.reps} Wdh.`, a.to.weight && `${a.to.weight} kg`].filter(Boolean).join(" · ")}</div>
          {a.to.note && <div style={{ fontSize: 12, color: "#999", marginTop: 3 }}>{a.to.note}</div>}
          {inWorkout
            ? <button disabled={doneCards[i+"-"+j]} style={{ ...s.primaryBtn, marginTop: 10, width: "100%", justifyContent: "center", opacity: doneCards[i+"-"+j] ? 0.5 : 1 }} onClick={() => confirmCard(i+"-"+j, a, `🔁 ${a.to.name} eingewechselt`)}>{doneCards[i+"-"+j] ? "✓ Getauscht" : "🔁 Im Training tauschen"}</button>
            : <div style={{ fontSize: 11, color: "#777", marginTop: 8 }}>Kein Training aktiv – tauschen geht während eines laufenden Trainings.</div>}
        </div>
      ) : a.type === "meal_plan" && a.plan ? (
        <div key={j} style={{ marginTop: 8, padding: 12, borderRadius: 14, border: "1px solid rgba(0,217,192,0.3)", background: "rgba(0,217,192,0.07)" }}>
          <div style={{ fontWeight: 800, color: "#F0EDE8", marginBottom: 6 }}>🥗 Essensplan</div>
          {(a.plan.days||[]).map((d, k) => <details key={k} style={{ fontSize: 12, color: "#bbb", padding: "3px 0" }}>
            <summary style={{ cursor: "pointer", color: "#F0EDE8", fontWeight: 700 }}>{d.day} <span style={{ color: "#00D9C0", fontWeight: 400 }}>· {Math.round((d.meals||[]).reduce((x, m) => x + (+m.kcal||0), 0))} kcal · {Math.round((d.meals||[]).reduce((x, m) => x + (+m.protein||0), 0))} g P</span></summary>
            {(d.meals||[]).map((m, q) => <div key={q} style={{ padding: "2px 0 2px 10px" }}><span style={{ color: "#888" }}>{m.mealType}:</span> {m.name} <span style={{ color: "#777" }}>({[m.kcal && `${m.kcal} kcal`, m.protein && `${m.protein} g P`].filter(Boolean).join(", ")})</span></div>)}
          </details>)}
          {(a.plan.shopping||[]).length > 0 && <>
            <div style={{ fontSize: 12, color: "#888", marginTop: 8 }}>🛒 {a.plan.shopping.length} Zutaten: {a.plan.shopping.slice(0, 8).map(x => x.name).join(", ")}{a.plan.shopping.length > 8 ? " …" : ""}</div>
            <button disabled={doneCards[i+"-"+j]} style={{ ...s.primaryBtn, marginTop: 10, width: "100%", justifyContent: "center", opacity: doneCards[i+"-"+j] ? 0.5 : 1 }} onClick={() => confirmCard(i+"-"+j, { type: "shopping_add", items: a.plan.shopping }, `🛒 ${a.plan.shopping.length} Zutaten auf der Einkaufsliste`)}>{doneCards[i+"-"+j] ? "✓ Auf der Liste" : "🛒 Auf die Einkaufsliste"}</button>
          </>}
        </div>
      ) : a.type === "log_meal" && a.meal ? (
        <div key={j} style={{ marginTop: 8, padding: 12, borderRadius: 14, border: "1px solid rgba(0,217,192,0.3)", background: "rgba(0,217,192,0.07)" }}>
          <div style={{ fontWeight: 800, color: "#F0EDE8" }}>🍳 {a.meal.name}</div>
          <div style={{ fontSize: 12, color: "#00D9C0", margin: "4px 0 0" }}>{[a.meal.mealType, `${Math.round(+a.meal.kcal||0)} kcal`, `${+a.meal.protein||0} g Protein`, `${+a.meal.carbs||0} g KH`, `${+a.meal.fat||0} g Fett`].filter(Boolean).join(" · ")}</div>
          <button disabled={doneCards[i+"-"+j]} style={{ ...s.primaryBtn, marginTop: 10, width: "100%", justifyContent: "center", opacity: doneCards[i+"-"+j] ? 0.5 : 1 }} onClick={() => confirmCard(i+"-"+j, a, `🍳 ${a.meal.name} eingetragen`)}>{doneCards[i+"-"+j] ? "✓ Eingetragen" : "➕ Ins Tagebuch eintragen"}</button>
        </div>
      ) : a.type === "suggest_meal" && a.meal ? (
        <div key={j} style={{ marginTop: 8, padding: 12, borderRadius: 14, border: "1px solid rgba(0,217,192,0.3)", background: "rgba(0,217,192,0.07)" }}>
          <div style={{ fontWeight: 800, color: "#F0EDE8" }}>🍽️ {a.meal.name}</div>
          <div style={{ fontSize: 12, color: "#00D9C0", margin: "4px 0 6px" }}>{[a.meal.kcal && `${a.meal.kcal} kcal`, a.meal.protein && `${a.meal.protein} g Protein`, a.meal.carbs && `${a.meal.carbs} g KH`, a.meal.fat && `${a.meal.fat} g Fett`].filter(Boolean).join(" · ")}</div>
          {(a.meal.ingredients||[]).length > 0 && <div style={{ fontSize: 12, color: "#bbb" }}>{a.meal.ingredients.join(", ")}</div>}
          {(a.meal.steps||[]).map((st, k) => <div key={k} style={{ fontSize: 12, color: "#999", marginTop: 3 }}>{k+1}. {st}</div>)}
        </div>
      ) : null)}
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)", display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div className="dropIn" onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 560, height: isMobile ? "88vh" : "78vh", background: "linear-gradient(170deg,#17171E,#0D0D0F)", border: "1px solid rgba(255,255,255,0.08)", borderBottom: "none", borderRadius: "24px 24px 0 0", display: "flex", flexDirection: "column", paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div><div style={{ fontWeight: 800, fontSize: 16, color: "#F0EDE8" }}>✨ FitForge Coach</div><div style={{ fontSize: 11, color: aiState === "off" ? "#FFD166" : "#666" }}>{aiState === "off" ? "KI noch nicht verbunden · Sprachbefehle aktiv" : "Frag mich oder sag, was ich tun soll"}</div></div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {msgs.length > 0 && <button onClick={() => { setShowQuick(v => !v); setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50); }} aria-label="Vorschläge" style={{ ...s.secBtn, padding: "7px 12px", fontSize: 12, borderColor: "rgba(167,139,250,0.45)", color: "#A78BFA", background: showQuick ? "rgba(167,139,250,0.18)" : "rgba(167,139,250,0.08)" }}>✨ Vorschläge</button>}
            <button onClick={() => setShowMemory(v => !v)} aria-label="Coach-Gedächtnis" title="Was der Coach über dich weiß" style={{ ...s.secBtn, padding: "7px 10px", fontSize: 12, background: showMemory ? "rgba(76,201,240,0.18)" : undefined }}>🧠{(user.coachMemory||[]).length ? " " + user.coachMemory.length : ""}</button>
            {msgs.length > 0 && !busy && <button onClick={() => { setMsgs([]); setDoneCards({}); }} aria-label="Neuer Chat" title="Neuer Chat" style={{ ...s.secBtn, padding: "7px 10px", fontSize: 12 }}>🗑️</button>}
            <button onClick={onClose} aria-label="Schließen" style={{ ...s.iconCircle, border: "none", background: "rgba(255,255,255,0.06)", color: "#aaa" }}>{IC.x}</button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          {!msgs.length && <>
            <div style={{ color: "#888", fontSize: 13, lineHeight: 1.6, marginBottom: 6 }}>Zum Beispiel: <i>„Starte Push Pull Legs“</i>, <i>„Öffne Ernährung“</i>, <i>„Wie war mein Training diese Woche?“</i></div>
            {quick.map(([l, p, t, edit]) => <button key={l} onClick={() => edit === "photo" ? fileRef.current?.click() : edit ? (setInput(p), setPendingTask(t)) : send(p, t)} style={{ ...s.secBtn, justifyContent: "flex-start", textAlign: "left" }}>{l}</button>)}
          </>}
          {showMemory && <CoachMemoryPanel memory={user.coachMemory} onDelete={id => onAction({ type: "memory_delete", id })} onAdd={fact => onAction({ type: "remember", fact })} />}
          {msgs.map(bubble)}
          {msgs.length > 0 && showQuick && <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10, borderRadius: 14, background: "rgba(167,139,250,0.06)", border: "1px solid rgba(167,139,250,0.2)" }}>
            <div style={{ fontSize: 11, color: "#A78BFA", fontWeight: 700 }}>Was soll ich für dich tun?</div>
            {quick.map(([l, p, t, edit]) => <button key={l} onClick={() => { setShowQuick(false); edit === "photo" ? fileRef.current?.click() : edit ? (setInput(p), setPendingTask(t)) : send(p, t); }} style={{ ...s.secBtn, justifyContent: "flex-start", textAlign: "left" }}>{l}</button>)}
          </div>}
          {busy && !msgs[msgs.length - 1]?.streaming && <div style={{ alignSelf: "flex-start", color: "#888", fontSize: 13 }}>✨ denkt nach…</div>}
          <div ref={endRef} />
        </div>
        {photo && <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px 0" }}>
          <img src={photo} alt="Essensfoto" style={{ width: 54, height: 54, objectFit: "cover", borderRadius: 10 }} />
          <div style={{ flex: 1, fontSize: 12, color: "#888" }}>Foto bereit – optional etwas dazuschreiben (z. B. „halbe Portion“) und senden.</div>
          <button type="button" onClick={() => setPhoto(null)} aria-label="Foto entfernen" style={{ ...s.iconCircle, border: "none", background: "rgba(255,255,255,0.06)", color: "#aaa" }}>{IC.x}</button>
        </div>}
        <form onSubmit={e => { e.preventDefault(); send(); }} style={{ display: "flex", gap: 8, padding: 12, borderTop: photo ? "none" : "1px solid rgba(255,255,255,0.06)", alignItems: "center", margin: 0 }}>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { pickPhoto(e.target.files?.[0]); e.target.value = ""; }} />
          <button type="button" onClick={() => fileRef.current?.click()} aria-label="Essensfoto" style={{ flexShrink: 0, width: 46, height: 46, borderRadius: 23, border: "none", cursor: "pointer", fontSize: 20, background: photo ? "rgba(0,217,192,0.25)" : "rgba(255,255,255,0.08)", color: "#fff" }}>📷</button>
          <button type="button" onClick={toggleMic} aria-label="Spracheingabe" style={{ flexShrink: 0, width: 46, height: 46, borderRadius: 23, border: "none", cursor: "pointer", fontSize: 20, background: listening ? "#EF476F" : "rgba(255,255,255,0.08)", color: "#fff", boxShadow: listening ? "0 0 0 6px rgba(239,71,111,0.25)" : "none", transition: "all .2s" }}>🎤</button>
          <input value={input} onChange={e => setInput(e.target.value)} enterKeyHint="send" placeholder={listening ? "Ich höre zu…" : "Nachricht oder Befehl…"} style={{ ...s.inp, flex: 1, minWidth: 0, margin: 0, fontSize: 16 }} />
          <button type="submit" disabled={busy || (!input.trim() && !photo)} style={{ ...s.primaryBtn, flexShrink: 0, padding: "12px 16px", opacity: busy || (!input.trim() && !photo) ? 0.5 : 1 }}>➤</button>
        </form>
      </div>
    </div>
  );
}
