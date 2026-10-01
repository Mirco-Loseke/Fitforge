// ─── Lauf-Coach (Sprachansagen beim GPS-Training) ────────────────────────────
// Erzeugt pro Kilometer eine Ansage: Split, Ø-Pace und – mit Ziel-Pace –
// konkrete Ansage, ob Tempo raus oder rein.

const ffSpokenTime = (sec) => {
  const s = Math.round(Math.abs(sec)), m = Math.floor(s / 60), r = s % 60;
  if (!m) return `${r} Sekunden`;
  return r ? `${m} Minuten ${r}` : `${m} Minuten`;
};

const ffRunCoachLine = ({ km, elapsedSecs, splitSecs, targetSecs }) => {
  const parts = [`Kilometer ${km}.`];
  if (splitSecs > 0) parts.push(`Dieser Kilometer: ${ffSpokenTime(splitSecs)}.`);
  const avg = km > 0 ? elapsedSecs / km : 0;
  if (!targetSecs) {
    if (avg) parts.push(`Durchschnitt ${ffSpokenTime(avg)} pro Kilometer.`);
    return parts.join(" ");
  }
  const total = km * targetSecs - elapsedSecs;           // + = vor dem Plan
  const splitDiff = splitSecs ? targetSecs - splitSecs : 0; // + = Split schneller als Ziel
  parts.push(total >= 0 ? `Du liegst ${ffSpokenTime(total)} vor deinem Ziel.` : `Du liegst ${ffSpokenTime(total)} hinter deinem Ziel.`);
  if (splitSecs) {
    if (splitDiff > 15) parts.push(`Der Kilometer war ${Math.round(splitDiff)} Sekunden zu schnell – nimm etwas Tempo raus, sonst fehlt dir hinten die Kraft.`);
    else if (splitDiff < -15) parts.push(`Der Kilometer war ${Math.round(-splitDiff)} Sekunden zu langsam – zieh etwas an.`);
    else parts.push("Tempo passt, genau so weiter.");
  }
  return parts.join(" ");
};
