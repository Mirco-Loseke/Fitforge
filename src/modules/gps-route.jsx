// ── GPS-Strecken ausgelagert ─────────────────────────────────────────────────
// Strecken liegen NICHT im data-Dokument (1-MB-Limit!), sondern je Lauf in
// fitforge/<uid>_route_<workoutId>_<exIdx>, kompakt als FLACHE Liste t,lat,lng,alt,speed,t,lat,…
// (Firestore erlaubt keine verschachtelten Arrays).
const compactRoute = path => (path||[]).flatMap(p => [p.t||0, +(+p.lat).toFixed(6), +(+p.lng).toFixed(6), p.alt!=null ? Math.round(p.alt*10)/10 : null, p.speed!=null ? Math.round(p.speed*100)/100 : null]);
const expandRoute = arr => { const out = []; for (let i = 0; i + 4 < (arr||[]).length; i += 5) out.push({ t: arr[i], lat: arr[i+1], lng: arr[i+2], alt: arr[i+3], speed: arr[i+4] }); return out; };
function RouteView({ set, targetPace }) {
  const [path, setPath] = useState(() => (set.routePath && set.routePath.length) ? set.routePath : null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    if (path || !set.routeRef || !window.firebaseDb) return;
    let off = false;
    window.firebaseDoc(window.firebaseDb, "fitforge", set.routeRef).get()
      .then(s => { if (!off) { if (s.exists) setPath(expandRoute(s.data().value)); else setErr(true); } })
      .catch(() => { if (!off) setErr(true); });
    return () => { off = true; };
  }, [set.routeRef]);
  if (!path) return <div style={{fontSize:12,color:"#666",padding:"12px 0",textAlign:"center"}}>{err ? "🗺️ Strecke offline nicht verfügbar – mit Internet erneut öffnen" : "🗺️ Strecke wird geladen…"}</div>;
  return (<><RouteMap path={path} /><GpsAnalytics path={path} targetPace={targetPace} /></>);
}

function RouteMap({ path }) {
  const mRef = useRef(null);
  useEffect(() => {
    if (mRef.current && path && path.length > 0) {
      if (!window.L) return;
      const map = window.L.map(mRef.current, { zoomControl: false, dragging: false, scrollWheelZoom: false }).setView(path[0], 14);
      window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { className: 'ff-dark-tiles', maxZoom: 19, attribution: '&copy; OSM' }).addTo(map);
      
      const group = window.L.featureGroup().addTo(map);
      if (path.length >= 2) {
        for (let i = 1; i < path.length; i++) {
          const p1 = path[i-1];
          const p2 = path[i];
          const speed = p2.speed || 0;
          let color = '#06D6A0';
          if (speed < 4) color = '#EF476F';
          else if (speed < 8) color = '#FFD166';
          else if (speed < 15) color = '#06D6A0';
          else color = '#A78BFA';
          window.L.polyline([[p1.lat, p1.lng], [p2.lat, p2.lng]], {color, weight: 4, opacity: 0.9}).addTo(group);
        }
      } else if (path.length === 1) {
        window.L.circleMarker([path[0].lat, path[0].lng], {radius: 6, color: '#06D6A0', fillColor: '#06D6A0', fillOpacity: 0.8}).addTo(group);
      }
      
      const bounds = group.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [10,10] });
      return () => map.remove();
    }
  }, [path]);
  return <div ref={mRef} style={{width: "100%", height: 160, borderRadius: 12, marginTop: 12, background: "#111", border: "1px solid #1A1A1F"}}></div>;
}

function GpsAnalytics({ path, targetPace }) {
  if (!path || path.length < 2 || !path[0].t) return null;

  // 1. Calculate stats (splits, maxSpeed, standingMs, elevationGain, elevationLoss)
  let splits = [];
  let currentSplitDist = 0;
  let currentSplitIndex = 1;
  let currentSplitStartTime = path[0].t;
  let maxSpeed = 0;
  let standingMs = 0;
  let elevationGain = 0;
  let elevationLoss = 0;

  for (let i = 1; i < path.length; i++) {
    const p1 = path[i-1];
    const p2 = path[i];
    const d = calcDist(p1.lat, p1.lng, p2.lat, p2.lng);
    const dtMs = p2.t - p1.t;
    if (dtMs <= 0) continue;
    
    currentSplitDist += d;
    if (p2.speed < 2) standingMs += dtMs;
    if (p2.speed > maxSpeed) maxSpeed = p2.speed;

    // Elevation accumulation (with jitter filter)
    if (p1.alt !== undefined && p2.alt !== undefined) {
      const diff = p2.alt - p1.alt;
      if (Math.abs(diff) > 1.2) {
        if (diff > 0) elevationGain += diff;
        else elevationLoss += Math.abs(diff);
      }
    }

    if (currentSplitDist >= 1.0) {
       const splitTimeMs = p2.t - currentSplitStartTime;
       const splitSpeedKmh = 1 / (splitTimeMs / 3600000);
       splits.push({ km: currentSplitIndex, timeMs: splitTimeMs, speed: splitSpeedKmh });
       
       currentSplitIndex++;
       currentSplitDist -= 1.0;
       currentSplitStartTime = p2.t;
    }
  }

  // Sample speed curve points
  const pointsToSample = 40;
  const step = Math.max(1, Math.floor(path.length / pointsToSample));
  const curvePoints = [];
  const elevPoints = [];
  for (let i = 0; i < path.length; i += step) {
    curvePoints.push(path[i].speed || 0);
    elevPoints.push(path[i].alt || 0);
  }
  const maxCurveSpeed = Math.max(...curvePoints, 1);
  
  const minElev = Math.min(...elevPoints);
  const maxElev = Math.max(...elevPoints);
  const elevDiff = maxElev - minElev || 1;

  // Generate SVG path for elevation profile
  const svgWidth = 300;
  const svgHeight = 45;
  const svgPoints = elevPoints.map((el, idx) => {
    const x = (idx / (elevPoints.length - 1)) * svgWidth;
    const y = svgHeight - 5 - ((el - minElev) / elevDiff) * (svgHeight - 10);
    return `${x},${y}`;
  });
  const pathData = svgPoints.length > 0 ? `M 0,${svgHeight} L ${svgPoints.join(' L ')} L ${svgWidth},${svgHeight} Z` : '';
  const strokeData = svgPoints.length > 0 ? `M ${svgPoints.join(' L ')}` : '';

  // 2. Pace Target comparison (Ghost Runner)
  const totalRunMs = path[path.length - 1].t - path[0].t;
  let totalRunDist = 0;
  for (let i = 1; i < path.length; i++) {
    totalRunDist += calcDist(path[i-1].lat, path[i-1].lng, path[i].lat, path[i].lng);
  }
  const avgKmh = totalRunDist > 0 ? (totalRunDist / (totalRunMs / 3600000)) : 0;
  const initialTargetPaceStr = (() => {
    if (targetPace) return targetPace;
    if (avgKmh <= 0.1) return "06:00";
    const minsPerKm = 60 / avgKmh;
    const m = Math.floor(minsPerKm);
    const s = Math.floor((minsPerKm - m) * 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  })();

  const [targetPaceStr, setTargetPaceStr] = React.useState(initialTargetPaceStr);

  const parsePaceToSecs = (str) => {
    if (!str || !str.includes(':')) return 360;
    const parts = str.split(':');
    const mins = parseInt(parts[0]) || 0;
    const secs = parseInt(parts[1]) || 0;
    return mins * 60 + secs;
  };

  return (
    <div style={{marginTop: 15, background: "#0D0D0F", padding: 15, borderRadius: 14, border: "1px solid #1A1A1F"}}>
      <h4 style={{margin: "0 0 10px", fontSize: 13, color: "#fff"}}>📊 KI-Laufanalyse</h4>
      
      {/* Speed Graph */}
      <div style={{fontSize: 9, color: "#666", fontWeight: 800, textTransform: "uppercase", marginBottom: 5}}>Geschwindigkeitsprofil (km/h)</div>
      <div style={{height: 60, display: "flex", alignItems: "flex-end", gap: 2, marginBottom: 15, background: "#111115", borderRadius: 8, padding: "5px 5px 0", border: "1px solid #1A1A1F"}}>
        {curvePoints.map((sp, i) => (
           <div key={i} style={{flex: 1, backgroundColor: "#06D6A0", opacity: 0.8, borderRadius: "2px 2px 0 0", height: `${Math.max(5, (sp / maxCurveSpeed) * 100)}%`}}></div>
        ))}
      </div>

      {/* Elevation Graph */}
      <div style={{fontSize: 9, color: "#666", fontWeight: 800, textTransform: "uppercase", marginBottom: 5}}>Höhenprofil ({Math.round(minElev)}m - {Math.round(maxElev)}m)</div>
      <div style={{position: "relative", width: "100%", height: 50, marginBottom: 20}}>
        <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} width="100%" height="100%" preserveAspectRatio="none" style={{display: "block", background: "#111115", borderRadius: 8, border: "1px solid #1A1A1F"}}>
          <defs>
            <linearGradient id="elevGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4CC9F0" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#4CC9F0" stopOpacity="0.0" />
            </linearGradient>
          </defs>
          {pathData && <path d={pathData} fill="url(#elevGrad)" />}
          {strokeData && <path d={strokeData} fill="none" stroke="#4CC9F0" strokeWidth="1.5" />}
        </svg>
      </div>

      {/* Stats Cards */}
      <div style={{display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap"}}>
        <div style={{flex: 1, minWidth: 90, background: "#1A1A1F", padding: 10, borderRadius: 10}}>
           <div style={{fontSize: 9, color: "#888", textTransform: "uppercase"}}>Max Tempo</div>
           <div style={{fontSize: 14, fontWeight: "bold", color: "#FFD166"}}>{maxSpeed.toFixed(1)} <span style={{fontSize: 10}}>km/h</span></div>
        </div>
        <div style={{flex: 1, minWidth: 90, background: "#1A1A1F", padding: 10, borderRadius: 10}}>
           <div style={{fontSize: 9, color: "#888", textTransform: "uppercase"}}>Standzeit</div>
           <div style={{fontSize: 14, fontWeight: "bold", color: "#EF476F"}}>{Math.round(standingMs/1000)}s</div>
        </div>
        <div style={{flex: 1, minWidth: 90, background: "#1A1A1F", padding: 10, borderRadius: 10}}>
           <div style={{fontSize: 9, color: "#888", textTransform: "uppercase"}}>Höhenmeter</div>
           <div style={{fontSize: 14, fontWeight: "bold", color: "#4CC9F0"}}>
             ▲ {Math.round(elevationGain)}m <span style={{color: "#888", fontSize: 10, fontWeight: "normal"}}>| ▼ {Math.round(elevationLoss)}m</span>
           </div>
        </div>
      </div>

      {/* Target Pace Control */}
      {splits.length > 0 && (
        <div style={{display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8}}>
          <span style={{fontSize: 10, color: "#aaa", fontWeight: 800, textTransform: "uppercase"}}>Runden-Details</span>
          <div style={{display: "flex", alignItems: "center", gap: 4, background: "#1A1A1F", padding: "3px 8px", borderRadius: 8, border: "1px solid #2A2A30"}}>
            <span style={{fontSize: 9, color: "#888"}}>Ziel-Pace:</span>
            <input 
              type="text" 
              value={targetPaceStr} 
              onChange={e => setTargetPaceStr(e.target.value)} 
              placeholder="06:00"
              style={{width: 45, background: "transparent", border: "none", color: "#A78BFA", fontSize: 10, padding: 0, fontWeight: "bold", textAlign: "center", outline: "none"}}
            />
            <span style={{fontSize: 9, color: "#888"}}>/km</span>
          </div>
        </div>
      )}

      {/* Splits Table */}
      {splits.length > 0 && (
        <div style={{background: "#1A1A1F", borderRadius: 10, overflow: "hidden"}}>
          <div style={{display: "flex", padding: "8px 12px", background: "#222", fontSize: 9, color: "#888", fontWeight: "bold"}}>
             <div style={{width: 50}}>RUNDE</div>
             <div style={{flex: 1}}>PACE</div>
             <div style={{width: 60, textAlign: "center"}}>ZIEL-DIFF</div>
             <div style={{width: 60, textAlign: "right"}}>Ø KM/H</div>
          </div>
          {splits.map((sp, i) => {
             const actualSecs = sp.timeMs / 1000;
             const targetSecs = parsePaceToSecs(targetPaceStr);
             const diff = actualSecs - targetSecs;
             const diffFormatted = diff < 0 
               ? `-${Math.abs(Math.round(diff))}s` 
               : (diff > 0 ? `+${Math.round(diff)}s` : `0s`);
             const diffColor = diff < 0 ? "#06D6A0" : (diff > 0 ? "#EF476F" : "#888");

             return (
                <div key={i} style={{display: "flex", padding: "8px 12px", fontSize: 12, borderTop: "1px solid #2A2A30", color: "#ddd", alignItems: "center"}}>
                  <div style={{width: 50, fontWeight: "bold", color: "#06D6A0"}}>km {sp.km}</div>
                  <div style={{flex: 1}}>{formatPace(sp.speed)} <span style={{fontSize:10, color:"#666"}}>/km</span></div>
                  <div style={{width: 60, color: diffColor, fontWeight: "bold", fontSize: 11, textAlign: "center"}}>{diffFormatted}</div>
                  <div style={{width: 60, textAlign: "right"}}>{sp.speed.toFixed(1)}</div>
                </div>
             );
          })}
        </div>
      )}
    </div>
  );
}
