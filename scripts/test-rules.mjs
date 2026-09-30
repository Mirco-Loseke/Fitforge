// Testet firestore.rules gegen die Firebase-Rules-Test-API (veröffentlicht NICHTS).
// Aufruf: node scripts/test-rules.mjs   (benötigt `npx firebase-tools login`)
import fs from "node:fs";
import os from "node:os";

const cfg = JSON.parse(fs.readFileSync(os.homedir() + "/.config/configstore/firebase-tools.json", "utf8"));
const token = cfg.tokens.access_token;
const src = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const D = "/databases/(default)/documents";
const A = "userA", B = "userB", C = "userC";
const req = (uid, method, path, data) => ({ auth: uid ? { uid } : null, method, path: D + path, ...(data !== undefined ? { resource: { data } } : {}) });
const T = (name, exp, request, resource) => ({ name, tc: { expectation: exp, request, ...(resource !== undefined && resource !== null ? { resource: { data: resource } } : {}) } });

const lib = Array.from({ length: 30 }, (_, i) => ({ id: i }));
const fr = { from: A, to: B, status: "pending" };
const chal = { participants: [A], progress: { [A]: 0 }, penaltyApplied: { [A]: false }, invited: [B], status: "active", title: "x" };

const cases = [
  // Eigene Daten
  T("A liest eigene data", "ALLOW", req(A, "get", `/fitforge/${A}_data`), { value: {} }),
  T("A schreibt eigene data", "ALLOW", req(A, "update", `/fitforge/${A}_data`, { value: {} }), { value: {} }),
  T("A legt eigenes Backup an", "ALLOW", req(A, "create", `/fitforge/${A}_backup_data_2026-09-30`, { value: {} })),
  T("A schreibt eigene Strecke", "ALLOW", req(A, "create", `/fitforge/${A}_route_123_0`, { value: [1, 2] })),
  T("A löscht eigene Strecke", "ALLOW", req(A, "delete", `/fitforge/${A}_route_123_0`), { value: [] }),
  T("A liest eigenes health", "ALLOW", req(A, "get", `/fitforge/${A}_health`), { value: {} }),
  T("A liest nicht existierendes eigenes Doc", "ALLOW", req(A, "get", `/fitforge/${A}_favFoods`), null),
  // Angriffe auf fremde Daten
  T("B liest As data", "DENY", req(B, "get", `/fitforge/${A}_data`), { value: {} }),
  T("B überschreibt As data", "DENY", req(B, "update", `/fitforge/${A}_data`, { value: {} }), { value: {} }),
  T("B löscht As Backup", "DENY", req(B, "delete", `/fitforge/${A}_backup_data_2026-09-30`), { value: {} }),
  T("B liest As health", "DENY", req(B, "get", `/fitforge/${A}_health`), { value: {} }),
  T("Präfix-Trick userA2 liest userA", "DENY", req(A + "2", "get", `/fitforge/${A}_data`), { value: {} }),
  T("Nicht eingeloggt liest", "DENY", req(null, "get", `/fitforge/${A}_data`), { value: {} }),
  // Bibliothek
  T("B liest Bibliothek", "ALLOW", req(B, "get", `/fitforge/shared_library`), { value: lib }),
  T("B ergänzt Bibliothek", "ALLOW", req(B, "update", `/fitforge/shared_library`, { value: [...lib, { id: 99 }], deletedIds: [] }), { value: lib }),
  T("B löscht 1 Übung", "ALLOW", req(B, "update", `/fitforge/shared_library`, { value: lib.slice(1), deletedIds: [0] }), { value: lib }),
  T("B leert Bibliothek", "DENY", req(B, "update", `/fitforge/shared_library`, { value: [] }), { value: lib }),
  T("B löscht Bibliothek-Dokument", "DENY", req(B, "delete", `/fitforge/shared_library`), { value: lib }),
  // Profile
  T("B liest As Profil", "ALLOW", req(B, "get", `/userProfiles/${A}`), { username: "a" }),
  T("B listet Profile", "ALLOW", req(B, "list", `/userProfiles/${A}`), { username: "a" }),
  T("A schreibt eigenes Profil", "ALLOW", req(A, "update", `/userProfiles/${A}`, { username: "a" }), { username: "a" }),
  T("B ändert As Profil", "DENY", req(B, "update", `/userProfiles/${A}`, { username: "hack" }), { username: "a" }),
  // Freundschaftsanfragen
  T("A prüft nicht existierende Anfrage", "ALLOW", req(A, "get", `/friendRequests/${B}_${A}`), null),
  T("A sendet Anfrage", "ALLOW", req(A, "create", `/friendRequests/${A}_${B}`, fr)),
  T("A sendet Anfrage im Namen von C", "DENY", req(A, "create", `/friendRequests/${C}_${B}`, { from: C, to: B, status: "pending" })),
  T("B liest Anfrage an sich", "ALLOW", req(B, "get", `/friendRequests/${A}_${B}`), fr),
  T("B listet eingehende", "ALLOW", req(B, "list", `/friendRequests/${A}_${B}`), fr),
  T("C liest fremde Anfrage", "DENY", req(C, "get", `/friendRequests/${A}_${B}`), fr),
  T("C listet fremde Anfragen", "DENY", req(C, "list", `/friendRequests/${A}_${B}`), fr),
  T("C prüft fremde nicht existierende Anfrage", "DENY", req(C, "get", `/friendRequests/${A}_${B}`), null),
  T("B nimmt an", "ALLOW", req(B, "update", `/friendRequests/${A}_${B}`, { ...fr, status: "accepted" }), fr),
  T("A nimmt eigene Anfrage an", "DENY", req(A, "update", `/friendRequests/${A}_${B}`, { ...fr, status: "accepted" }), fr),
  T("A erneuert offene Anfrage", "ALLOW", req(A, "update", `/friendRequests/${A}_${B}`, { ...fr, createdAt: 2 }), fr),
  T("B entfernt Freundschaft", "ALLOW", req(B, "delete", `/friendRequests/${A}_${B}`), { ...fr, status: "accepted" }),
  T("C entfernt fremde Freundschaft", "DENY", req(C, "delete", `/friendRequests/${A}_${B}`), fr),
  // Geteilte Elemente
  T("A teilt Plan mit B", "ALLOW", req(A, "create", `/sharedItems/x1`, { from: A, to: B, status: "pending", payload: {} })),
  T("A fälscht Absender", "DENY", req(A, "create", `/sharedItems/x2`, { from: C, to: B, status: "pending" })),
  T("B liest geteilten Plan", "ALLOW", req(B, "get", `/sharedItems/x1`), { from: A, to: B, status: "pending" }),
  T("B listet eingehende Teilungen", "ALLOW", req(B, "list", `/sharedItems/x1`), { from: A, to: B, status: "pending" }),
  T("C liest fremdes Teilen", "DENY", req(C, "get", `/sharedItems/x1`), { from: A, to: B, status: "pending" }),
  T("B verwirft Einladung", "ALLOW", req(B, "delete", `/sharedItems/x1`), { from: A, to: B, status: "pending" }),
  // Challenges
  T("A erstellt Challenge", "ALLOW", req(A, "create", `/challenges/c1`, chal)),
  T("A erstellt Challenge ohne sich", "DENY", req(A, "create", `/challenges/c2`, { ...chal, participants: [B] })),
  T("A trägt Fortschritt ein", "ALLOW", req(A, "update", `/challenges/c1`, { ...chal, progress: { [A]: 3 }, currentValue: 3 }), chal),
  T("A lädt C ein", "ALLOW", req(A, "update", `/challenges/c1`, { ...chal, invited: [B, C] }), chal),
  T("B liest Challenge vor Beitritt", "ALLOW", req(B, "get", `/challenges/c1`), chal),
  T("B tritt bei", "ALLOW", req(B, "update", `/challenges/c1`, { ...chal, participants: [A, B], progress: { [A]: 0, [B]: 0 }, penaltyApplied: { [A]: false, [B]: false } }), chal),
  T("B tritt bei und ändert Titel", "DENY", req(B, "update", `/challenges/c1`, { ...chal, title: "hack", participants: [A, B] }), chal),
  T("B trägt C mit ein", "DENY", req(B, "update", `/challenges/c1`, { ...chal, participants: [A, B, C] }), chal),
  T("C (fremd) ändert Fortschritt", "DENY", req(C, "update", `/challenges/c1`, { ...chal, progress: { [A]: 999 } }), chal),
  T("A setzt Status failed", "ALLOW", req(A, "update", `/challenges/c1`, { ...chal, status: "failed" }), chal),
  T("C löscht Challenge", "DENY", req(C, "delete", `/challenges/c1`), chal),
  // Unbekannte Sammlungen
  T("Unbekannte Sammlung", "DENY", req(A, "get", `/irgendwas/x`), { a: 1 }),
];

const r = await fetch("https://firebaserules.googleapis.com/v1/projects/mircos-app:test", {
  method: "POST",
  headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
  body: JSON.stringify({ source: { files: [{ name: "firestore.rules", content: src }] }, testSuite: { testCases: cases.map(c => c.tc) } }),
});
const j = await r.json();
if (j.error) { console.log("API-Fehler:", JSON.stringify(j.error, null, 1)); process.exitCode = 1; }
if (j.issues?.length) console.log("Regel-Hinweise:", JSON.stringify(j.issues, null, 1));
let fail = 0;
(j.testResults || []).forEach((t, i) => {
  const ok = t.state === "SUCCESS";
  if (!ok) fail++;
  console.log(`${ok ? "✅" : "❌"} [${cases[i].tc.expectation}] ${cases[i].name}${ok ? "" : "  → " + (t.debugMessages || []).join(" | ")}`);
});
console.log(`\n${cases.length - fail}/${cases.length} bestanden`);
process.exitCode = fail ? 1 : 0;
