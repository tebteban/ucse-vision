// Resume tests/.tmp/resultados.json: promedio de las repeticiones por escenario y versión, en tabla Markdown.
// Uso: node tests/resumen.mjs [archivo]
import fs from 'node:fs';

const archivo = process.argv[2] ?? 'tests/.tmp/resultados.json';
const filas = JSON.parse(fs.readFileSync(archivo, 'utf8'));

const COLUMNAS = [
  ['videoFps', 'Video (fps)'],
  ['congelamientos', 'Congelamientos ≥250 ms'],
  ['videoHuecoMaxMs', 'Peor hueco de video (ms)'],
  ['tirones', 'Tirones de interfaz >50 ms'],
  ['cuadroP95Ms', 'Cuadro p95 (ms)'],
  ['tareasLargas', 'Bloqueos del hilo principal'],
  ['bloqueoTotalMs', 'Tiempo bloqueado (ms)'],
  ['bloqueoMaxMs', 'Bloqueo más largo (ms)'],
  ['recuadroMs', 'Clic → recuadro (ms)'],
  ['fichaMs', 'Clic → ficha (ms)'],
  ['rafagaMs', 'Ráfaga ×8 (ms)'],
  ['escenaS', 'Análisis de escena (s)'],
  ['segundosPerdido', 'Segundos con objeto perdido'],
  ['heapCrecioMb', 'Memoria JS +MB'],
  ['errores', 'Errores en consola'],
];

const grupos = new Map();
for (const f of filas) {
  const k = `${f.nombre}|${f.version}`;
  if (!grupos.has(k)) grupos.set(k, []);
  grupos.get(k).push(f);
}
const prom = (xs, c) => {
  const v = xs.map((x) => x[c]).filter((x) => typeof x === 'number');
  if (!v.length) return '—';
  const m = v.reduce((s, x) => s + x, 0) / v.length;
  return Math.abs(m) >= 100 ? Math.round(m) : Math.round(m * 10) / 10;
};

const escenarios = [...new Set(filas.map((f) => f.nombre))];
const versiones = [...new Set(filas.map((f) => f.version))];
for (const e of escenarios) {
  console.log(`\n### ${e}\n`);
  console.log(`| Métrica | ${versiones.map((v) => `${v} (n=${grupos.get(`${e}|${v}`)?.length ?? 0})`).join(' | ')} |`);
  console.log(`|---|${versiones.map(() => '---:').join('|')}|`);
  for (const [c, titulo] of COLUMNAS) {
    const vals = versiones.map((v) => prom(grupos.get(`${e}|${v}`) ?? [], c));
    if (vals.every((x) => x === '—')) continue;
    console.log(`| ${titulo} | ${vals.join(' | ')} |`);
  }
}
