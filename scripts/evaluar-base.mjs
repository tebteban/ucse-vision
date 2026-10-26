// Mide qué tan bien reconoce la base fotos que no conoce: separa las fotos que pasaron el filtro en 5 grupos y
// reconoce cada grupo usando el resto como base, con la misma regla que la app (src/library.js: promedio de las 2
// muestras más parecidas de cada objeto, umbral 85 %). Compara una base de hasta 24 fotos por objeto (la anterior)
// con una de hasta 100 (la nueva), sobre las mismas fotos de prueba.
// Requiere datos/vectores.json (lo escribe scripts/construir-semilla.mjs). Uso: node scripts/evaluar-base.mjs
import fs from 'node:fs';

const UMBRAL = 0.85;
const GRUPOS = 5;
const vectores = JSON.parse(fs.readFileSync('datos/vectores.json', 'utf8')).filter((x) => x.pasa);
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

function reconocer(base, v) {
  const porObjeto = new Map();
  for (const m of base) porObjeto.set(m.id, [...(porObjeto.get(m.id) ?? []), dot(m.v, v)]);
  return [...porObjeto]
    .map(([id, sims]) => ({ id, score: sims.sort((a, b) => b - a).slice(0, 2).reduce((s, x, _, t) => s + x / t.length, 0) }))
    .sort((a, b) => b.score - a.score)[0];
}

const ids = [...new Set(vectores.map((x) => x.id))];
const porObjeto = Object.fromEntries(ids.map((id) => [id, vectores.filter((x) => x.id === id)]));
for (const tope of [24, 100]) {
  const total = { bien: 0, confunde: 0, noReconoce: 0, n: 0 };
  const fila = {};
  for (let g = 0; g < GRUPOS; g++) {
    const prueba = vectores.filter((_, i) => i % GRUPOS === g);
    const enPrueba = new Set(prueba);
    const base = ids.flatMap((id) => porObjeto[id].filter((x) => !enPrueba.has(x)).slice(0, tope));
    for (const x of prueba) {
      const r = reconocer(base, x.v);
      const k = r.score < UMBRAL ? 'noReconoce' : r.id === x.id ? 'bien' : 'confunde';
      total[k]++;
      total.n++;
      fila[x.id] ??= { bien: 0, n: 0 };
      fila[x.id].n++;
      if (k === 'bien') fila[x.id].bien++;
    }
  }
  const pct = (k) => `${((100 * total[k]) / total.n).toFixed(1)} %`;
  console.log(`\nBase de hasta ${tope} fotos por objeto (${total.n} fotos de prueba):`);
  console.log(`  reconoce bien: ${pct('bien')}   confunde con otro: ${pct('confunde')}   "No reconocido": ${pct('noReconoce')}`);
  console.log('  por objeto:', Object.entries(fila).map(([id, f]) => `${id} ${Math.round((100 * f.bien) / f.n)}%`).join(', '));
}
