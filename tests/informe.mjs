// Arma docs/resultados-pruebas.md a partir de las corridas guardadas en tests/.tmp:
// resultados.json (rendimiento y estrés), unit-N.json (Vitest) y e2e-N.json (Playwright).
// Uso: node tests/informe.mjs
import fs from 'node:fs';
import path from 'node:path';

const TMP = 'tests/.tmp';
const leer = (f) => (fs.existsSync(path.join(TMP, f)) ? JSON.parse(fs.readFileSync(path.join(TMP, f), 'utf8')) : null);
const filas = leer('resultados.json') ?? [];
const r1 = (x) => (typeof x !== 'number' ? '—' : Math.abs(x) >= 100 ? Math.round(x).toLocaleString('es-AR') : (Math.round(x * 10) / 10).toLocaleString('es-AR'));
const prom = (xs, c) => {
  const v = xs.map((x) => x[c]).filter((x) => typeof x === 'number');
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
};
const salida = [];
const p = (s = '') => salida.push(s);

p('# Resultados de las pruebas de UCSE Vision');
p();
p(`Generado el ${new Date().toLocaleString('es-AR')}. Todas las pruebas corren sobre la app de escritorio real (Electron) con una cámara falsa que reproduce videos generados (\`tests/fixtures/generar.mjs\`).`);
p();

// --- rendimiento ---
const VERSIONES = [['antes', 'Antes'], ['despues', 'Después'], ['gpu', 'Después con SAM en GPU']].filter(([v]) => filas.some((f) => f.version === v));
const ESCENARIOS = [
  ['reposo', 'Cámara en reposo (10 s)'],
  ['identificar', 'Clic sobre un objeto quieto'],
  ['seguimiento', 'Seguimiento de un objeto en movimiento (15 s)'],
  ['rafaga', 'Ráfaga de 8 muestras en Enseñar'],
  ['clics-movimiento', '4 selecciones seguidas con la escena en movimiento'],
];
const METRICAS = [
  ['videoFps', 'Video mostrado (fps, ideal 30)'],
  ['congelamientos', 'Congelamientos de la cámara ≥ 250 ms'],
  ['videoHuecoMaxMs', 'Peor congelamiento (ms)'],
  ['tirones', 'Tirones de la interfaz > 50 ms'],
  ['tareasLargas', 'Bloqueos del hilo principal'],
  ['bloqueoTotalMs', 'Tiempo total bloqueado (ms)'],
  ['recuadroMs', 'Clic → recuadro (ms)'],
  ['fichaMs', 'Clic → ficha (ms)'],
  ['rafagaMs', 'Ráfaga de 8 muestras (ms)'],
  ['escenaS', 'Análisis de escena (s)'],
];
if (VERSIONES.length) {
  p('## Rendimiento: antes y después');
  p();
  p('Promedio de 3 repeticiones por escenario, cada una con la app recién abierta. Se descartan las corridas en las que Windows pausó la ventana (pantalla apagada o ventana tapada), porque no miden la app.');
  for (const [esc, titulo] of ESCENARIOS) {
    const grupos = VERSIONES.map(([v]) => filas.filter((f) => f.nombre === esc && f.version === v));
    if (!grupos.some((g) => g.length)) continue;
    p();
    p(`### ${titulo}`);
    p();
    p(`| Métrica | ${VERSIONES.map(([, n], i) => `${n} (n=${grupos[i].length})`).join(' | ')} |`);
    p(`|---|${VERSIONES.map(() => '---:').join('|')}|`);
    for (const [c, nombre] of METRICAS) {
      const vals = grupos.map((g) => prom(g, c));
      if (vals.every((x) => x === null)) continue;
      p(`| ${nombre} | ${vals.map(r1).join(' | ')} |`);
    }
  }
  p();
}

// --- estrés ---
const ESTRES = [
  ['estres-clics', '100 clics rápidos por toda la cámara'],
  ['estres-pestanas', '200 cambios de pestaña y categoría'],
  ['estres-rafagas', '10 ráfagas seguidas (80 muestras)'],
  ['estres-fijar-soltar', 'Fijar y soltar 40 veces'],
  ['estres-biblioteca-grande', 'Biblioteca con 3000 muestras propias'],
  ['estres-3-minutos', '3 minutos siguiendo un objeto en movimiento'],
];
const est = ESTRES.map(([k, n]) => [n, filas.filter((f) => f.nombre === k)]).filter(([, g]) => g.length);
if (est.length) {
  p('## Pruebas de estrés (después)');
  p();
  p('| Prueba | Corridas | Video (fps) | Congelamientos | Bloqueos del hilo principal | Memoria JS (MB, variación) | Dato extra |');
  p('|---|---:|---:|---:|---:|---:|---|');
  for (const [n, g] of est) {
    const extra = prom(g, 'fichaMs') !== null ? `clic → ficha ${r1(prom(g, 'fichaMs'))} ms`
      : prom(g, 'muestrasPorSegundo') !== null ? `${r1(prom(g, 'muestrasPorSegundo'))} muestras/s`
      : prom(g, 'segundosPerdido') !== null ? `objeto perdido ${r1(prom(g, 'segundosPerdido'))} s de 180`
      : '';
    p(`| ${n} | ${g.length} | ${r1(prom(g, 'videoFps'))} | ${r1(prom(g, 'congelamientos'))} | ${r1(prom(g, 'tareasLargas'))} | ${r1(prom(g, 'heapCrecioMb'))} | ${extra} |`);
  }
  p();
}

// --- resultados de las corridas ---
const unit = [1, 2, 3].map((i) => leer(`unit-${i}.json`)).filter(Boolean);
const e2e = [1, 2, 3].map((i) => leer(`e2e-${i}.json`)).filter(Boolean);
if (unit.length || e2e.length) {
  p('## Corridas completas');
  p();
  if (unit.length) {
    p(`**Unitarias (Vitest):** ${unit.map((u, i) => `corrida ${i + 1}: ${u.numPassedTests}/${u.numTotalTests}`).join(' · ')}.`);
    p();
  }
  if (e2e.length) {
    const pruebas = new Map();
    const recorrer = (suite, archivo) => {
      for (const s of suite.specs ?? []) {
        const clave = `${archivo}|${s.title}`;
        if (!pruebas.has(clave)) pruebas.set(clave, { archivo, titulo: s.title, ok: 0, total: 0, ms: [] });
        const t = pruebas.get(clave);
        for (const test of s.tests) for (const r of test.results) {
          t.total++;
          if (r.status === 'passed') t.ok++;
          t.ms.push(r.duration);
        }
      }
      for (const sub of suite.suites ?? []) recorrer(sub, archivo);
    };
    for (const corrida of e2e) for (const s of corrida.suites) recorrer(s, s.title.replace(/^.*[\\/]/, '').replace('.spec.js', ''));
    const NOMBRES = { funcional: 'Funcional', fallas: 'Tolerancia a fallos', estres: 'Estrés' };
    p(`**E2E (Playwright):** ${e2e.map((c, i) => `corrida ${i + 1}: ${c.stats.expected}/${c.stats.expected + c.stats.unexpected + c.stats.flaky} pasaron`).join(' · ')}.`);
    p();
    p('| Tipo | Prueba | Pasó | Duración media (s) |');
    p('|---|---|---:|---:|');
    for (const t of pruebas.values()) p(`| ${NOMBRES[t.archivo] ?? t.archivo} | ${t.titulo} | ${t.ok}/${t.total} | ${r1(t.ms.reduce((s, x) => s + x, 0) / t.ms.length / 1000)} |`);
    p();
  }
}

const portable = leer('portable.json');
if (portable) {
  p(`**Ejecutable portable** (\`release/UCSE-Vision/UCSE Vision.exe\`): pruebas funcionales ${portable.stats.expected}/${portable.stats.expected + portable.stats.unexpected} pasaron.`);
  p();
}
// notas escritas a mano sobre la última corrida (p. ej. interrupciones), si las hay
if (fs.existsSync(path.join(TMP, 'notas.md'))) {
  p('## Notas');
  p();
  p(fs.readFileSync(path.join(TMP, 'notas.md'), 'utf8').trim());
  p();
}

fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync('docs/resultados-pruebas.md', salida.join('\n'));
console.log(salida.join('\n'));
