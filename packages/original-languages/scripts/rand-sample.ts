import { writeFileSync } from "node:fs";
import { buildRand } from "./rand.ts";
const pack = buildRand();
const ids = Object.keys(pack);
// Writes docs/rand-muestra-30.md: the 30 entries a person reads before Rand
// ships (A2 Paso 7.2). mulberry32, seed 1890: the same 30 every time.
let seed = 1890;
const random = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const picked = new Set<string>();
while (picked.size < 30) picked.add(ids[Math.floor(random() * ids.length)]);
const lines = [
  "# Rand 1890 — muestra de 30 entradas para revisión (A2 Paso 7.2)",
  "",
  `Generada del OCR de archive.org (diccionariodelas00rand) con \`packages/original-languages/scripts/rand.ts\`: ${ids.length} entradas en total. Semilla 1890, orden alfabético. Las entradas largas se cortan a 800 caracteres en esta muestra (en la app van completas).`,
  "",
  "Qué revisar: que cada entrada empiece y termine donde debe, que no haya texto de otra entrada ni de pies de grabado, y que la tilde en monosílabos (a, o, fue, dio) se lea moderna.",
  ""
];
[...picked].sort().forEach((id, n) => {
  const [term, , body] = pack[id];
  lines.push(`## ${n + 1}. ${term}  \`${id}\``, "", body.length > 800 ? body.slice(0, 800) + " […]" : body, "");
});
writeFileSync("../../../docs/rand-muestra-30.md", lines.join("\n"));
console.log(ids.length, [...picked].sort().join(" "));
