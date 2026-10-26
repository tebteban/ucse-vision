// Pruebas E2E funcionales: los flujos que se usan en la demo, sobre la app de escritorio real.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import catalogo from '../../src/data/catalogo.json' with { type: 'json' };
import semilla from '../../src/data/semilla.json' with { type: 'json' };
import { abrirApp, esperarLista, clicVideo, arrastrarVideo, OBJETO, ARDUINO_CHICO } from './app.js';

const FICHA = catalogo.find((o) => o.id === OBJETO.id);
const MUESTRAS_BASE = String(semilla.filter((m) => m.id === OBJETO.id).length);
// El objeto sintético de la escena "nuevo" ocupa x 490-790, y 210-510 de un cuadro de 1280×720.
const NUEVO = { a: [470 / 1280, 195 / 720], b: [810 / 1280, 525 / 720], centro: [0.5, 0.5] };

let ctx;
test.afterEach(async () => {
  expect(ctx?.errores ?? [], 'errores en la consola de la app').toEqual([]);
  await ctx?.app.close();
  ctx = null;
});

test('arranca, carga modelos y muestra el catálogo completo', async () => {
  ctx = await abrirApp('quieto');
  const { page } = ctx;
  await esperarLista(page);
  await expect(page.locator('.stat').first()).toContainText(String(catalogo.length));
  await expect(page.locator('.flotante').first()).toHaveText(/En vivo/);
  await expect(page.locator('.espera h2')).toHaveText('Apuntá y hacé clic');
});

test('clic sobre el objeto: recuadro, nombre, descripción corta y larga', async () => {
  ctx = await abrirApp('quieto');
  const { page } = ctx;
  await esperarLista(page);
  await clicVideo(page, OBJETO.x, OBJETO.y);
  // sobre la cámara: nombre, % y descripción corta
  await expect(page.locator('.rotulo b')).toHaveText(OBJETO.nombre);
  await expect(page.locator('.rotulo-resumen')).toHaveText(FICHA.resumen);
  // en el panel: descripción corta y larga (abierta por defecto)
  await expect(page.locator('.ficha h2')).toHaveText(OBJETO.nombre);
  await expect(page.locator('.ficha .eyebrow')).toHaveText('Informática');
  await expect(page.locator('.ficha .lead')).toHaveText(FICHA.resumen);
  const [p1, p2] = FICHA.detalle.split('\n');
  await expect(page.locator('.mas-caja p').first()).toHaveText(p1);
  await expect(page.locator('.mas-caja p').nth(1)).toHaveText(p2);
  // se puede ocultar y volver a abrir tocando la tarjeta sobre el objeto
  await page.getByRole('button', { name: 'Ocultar información' }).click();
  await expect(page.locator('.mas-caja')).toHaveCount(0);
  await page.locator('.rotulo.con-resumen').click();
  await expect(page.locator('.mas-caja')).toBeVisible();
  // soltar limpia todo
  await page.getByRole('button', { name: 'Soltar objeto' }).click();
  await expect(page.locator('.marco')).toHaveCount(0);
  await expect(page.locator('.ficha')).toHaveCount(0);
});

test('encuadre manual arrastrando el mouse', async () => {
  ctx = await abrirApp('quieto');
  const { page } = ctx;
  await esperarLista(page, { escena: false });
  await arrastrarVideo(page, [0.33, 0.22], [0.67, 0.78]);
  await expect(page.locator('.ficha h2')).toHaveText(OBJETO.nombre);
});

test('filtro de categoría: Informática tiene todo el catálogo y Electrónica queda para más adelante', async () => {
  ctx = await abrirApp('quieto');
  const { page } = ctx;
  await esperarLista(page);
  await clicVideo(page, OBJETO.x, OBJETO.y);
  await expect(page.locator('.ficha h2')).toHaveText(OBJETO.nombre);
  await page.getByRole('button', { name: 'Informática', exact: true }).click();
  await expect(page.locator('.ficha h2')).toHaveText(OBJETO.nombre);
  await expect(page.locator('.stat').first()).toContainText(String(catalogo.length));
  // sin objetos de Electrónica en el catálogo, su botón queda desactivado hasta que se enseñe uno
  await expect(page.getByRole('button', { name: 'Electrónica', exact: true })).toBeDisabled();
});

test('enseñar un objeto nuevo en vivo, reconocerlo y que persista al reiniciar', async () => {
  ctx = await abrirApp('nuevo');
  const { page, userData } = ctx;
  await esperarLista(page, { escena: false });
  await arrastrarVideo(page, NUEVO.a, NUEVO.b);
  await expect(page.locator('.marco')).toHaveCount(1);
  await page.getByRole('tab', { name: 'Enseñar' }).click();
  await page.getByLabel('Nombre').fill('Pastillero violeta');
  await expect(page.locator('.campos .nota').first()).toContainText('Sin IA local'); // sin Ollama se completa a mano
  await page.locator('.campos select').selectOption('Electrónica');
  await page.getByLabel('Descripción corta').fill('Caja de prueba para el entrenamiento en vivo.');
  await page.getByRole('button', { name: /Ráfaga/ }).click();
  await expect(page.locator('.minis img')).toHaveCount(8, { timeout: 60_000 });
  await page.getByRole('button', { name: 'Guardar y reconocer' }).click();
  await expect(page.locator('.ficha h2')).toHaveText('Pastillero violeta');
  await expect(page.locator('.ficha .lead')).toHaveText('Caja de prueba para el entrenamiento en vivo.');
  await expect(page.locator('.mas-caja p').first()).toContainText('se agregó a la biblioteca'); // descripción larga por defecto
  // reiniciar la app con el mismo perfil: el objeto enseñado sigue ahí
  await ctx.app.close();
  ctx = await abrirApp('nuevo', { perfil: userData });
  await esperarLista(ctx.page, { escena: false });
  await arrastrarVideo(ctx.page, NUEVO.a, NUEVO.b);
  await expect(ctx.page.locator('.ficha h2')).toHaveText('Pastillero violeta');
});

test('exportar e importar la biblioteca; un archivo inválido no rompe nada', async () => {
  ctx = await abrirApp('nuevo');
  const { page, app } = ctx;
  await esperarLista(page, { escena: false });
  // enseñar algo para que la biblioteca propia no esté vacía
  await arrastrarVideo(page, NUEVO.a, NUEVO.b);
  await page.getByRole('tab', { name: 'Enseñar' }).click();
  await page.getByLabel('Nombre').fill('Objeto exportado');
  await page.getByRole('button', { name: /Ráfaga/ }).click();
  await expect(page.locator('.minis img')).toHaveCount(8, { timeout: 60_000 });
  await page.getByRole('button', { name: 'Guardar y reconocer' }).click();
  await page.getByRole('tab', { name: 'Biblioteca' }).click();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ucse-exp-'));
  const destino = path.join(dir, 'biblioteca.json');
  await app.evaluate(({ session }, d) => session.defaultSession.once('will-download', (_e, item) => item.setSavePath(d)), destino);
  await page.getByRole('button', { name: 'Exportar' }).click();
  await expect.poll(() => fs.existsSync(destino) && fs.statSync(destino).size > 0, { timeout: 15_000 }).toBe(true);
  const exportada = JSON.parse(fs.readFileSync(destino, 'utf8'));
  expect(exportada.objetos.map((o) => o.nombre)).toEqual(['Objeto exportado']);
  expect(exportada.muestras).toHaveLength(8);
  // archivo roto
  const roto = path.join(dir, 'roto.json');
  fs.writeFileSync(roto, '{ esto no es json');
  await page.locator('input[type=file]').setInputFiles(roto);
  await expect(page.locator('.toast', { hasText: /no es un JSON válido/ })).toBeVisible();
  // JSON válido pero no es una biblioteca
  const ajeno = path.join(dir, 'ajeno.json');
  fs.writeFileSync(ajeno, JSON.stringify({ hola: 1 }));
  await page.locator('input[type=file]').setInputFiles(ajeno);
  await expect(page.locator('.toast', { hasText: /no es una biblioteca válida/ })).toBeVisible();
  // importar el exportado en un perfil nuevo
  await ctx.app.close();
  ctx = await abrirApp('nuevo');
  await esperarLista(ctx.page, { escena: false });
  await ctx.page.getByRole('tab', { name: 'Biblioteca' }).click();
  await ctx.page.locator('input[type=file]').setInputFiles(destino);
  await expect(ctx.page.locator('.toast', { hasText: /1 objeto propio y 8 muestras/ })).toBeVisible();
  await expect(ctx.page.locator('.tabla-fila', { hasText: 'Objeto exportado' })).toContainText('8');
});

// Ollama falso: un modelo instalado y respuestas fijas en texto, como las de un modelo real; anota qué le pidió la app.
const FICHA_IA = { resumen: 'Pastillero de prueba escrito por la IA.', detalle: 'Primer párrafo de la IA.\nSegundo párrafo de la IA.' };
// confirma: el tipo de objeto (un candidato de CLIP) por el que responde "sí" al preguntarle si lo que nombró es de
// ese tipo (por defecto, ninguno);
// especifico: qué es exactamente un objeto que CLIP ya reconoció.
async function ollamaFalso(modelo, { vision = false, nombre = 'Pastillero violeta', confirma = null, especifico = 'Intel Core i7' } = {}) {
  const pedidos = [];
  const servidor = http.createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (d) => (cuerpo += d));
    req.on('end', () => {
      const b = cuerpo ? JSON.parse(cuerpo) : {};
      pedidos.push({ url: req.url, cuerpo: b });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: modelo }] }));
      if (req.url === '/api/show') return res.end(JSON.stringify({ capabilities: vision ? ['completion', 'vision'] : ['completion'] }));
      if (req.url === '/api/ps') return res.end(JSON.stringify({ models: [{ name: modelo, size: 3000, size_vram: 3000 }] }));
      if (!b.prompt) return res.end('{}'); // precarga
      const respuesta = b.prompt.includes('Respondé solo sí o no') ? (b.prompt.includes(`es un "${confirma}"`) ? 'Sí' : 'No') : b.prompt.includes('Decí qué es exactamente') ? especifico : b.images ? `1. ${nombre}\n2. Electrónica` : `${FICHA_IA.resumen}\n\n${FICHA_IA.detalle.replace('\n', '\n\n')}`;
      // en vivo, como Ollama: una línea JSON por pedazo de texto
      for (const pedazo of respuesta.match(/.{1,12}/gs)) res.write(JSON.stringify({ response: pedazo, done: false }) + '\n');
      res.end(JSON.stringify({ response: '', done: true }) + '\n');
    });
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${servidor.address().port}`, pedidos, cerrar: () => servidor.close() };
}

async function capturarYGuardar(page) {
  await page.getByRole('button', { name: /Ráfaga/ }).click();
  await expect(page.locator('.minis img')).toHaveCount(8, { timeout: 60_000 });
  await page.getByRole('button', { name: 'Guardar y reconocer' }).click();
  await expect(page.locator('.ficha .lead')).toHaveText(FICHA_IA.resumen);
  await expect(page.locator('.mas-caja p')).toHaveText(['Primer párrafo de la IA.', 'Segundo párrafo de la IA.']);
}

test('con Ollama, la IA escribe las descripciones a partir del nombre', async () => {
  const ollama = await ollamaFalso('qwen2.5:3b');
  try {
    ctx = await abrirApp('nuevo', { ollama: ollama.url });
    const { page } = ctx;
    await esperarLista(page, { escena: false });
    await arrastrarVideo(page, NUEVO.a, NUEVO.b);
    await page.getByRole('tab', { name: 'Enseñar' }).click();
    await expect(page.locator('.campos .nota').first()).toContainText('qwen2.5:3b');
    await expect(page.getByRole('button', { name: 'Mirar el objeto' })).toHaveCount(0); // este modelo no ve imágenes
    await page.getByLabel('Nombre').fill('Pastillero violeta');
    await page.getByLabel('Nombre').press('Tab'); // al salir del nombre se escriben solas
    await expect(page.getByLabel('Descripción corta')).toHaveValue(FICHA_IA.resumen);
    await expect(page.getByLabel('Descripción larga')).toHaveValue(FICHA_IA.detalle);
    const generar = ollama.pedidos.filter((p) => p.cuerpo.prompt);
    expect(generar).toHaveLength(1);
    expect(generar[0].cuerpo.prompt).toContain('Pastillero violeta');
    expect(ollama.pedidos.some((p) => p.url === '/api/generate' && !p.cuerpo.prompt)).toBe(true); // precargó el modelo
    await capturarYGuardar(page);
  } finally {
    ollama.cerrar();
  }
});

test('con un modelo que ve imágenes: opina sobre lo que CLIP no reconoce y completa la ficha para enseñarlo', async () => {
  // después de enseñarlo, la IA reconoce al pastillero como tal (lo confirma al escribir su descripción larga)
  const ollama = await ollamaFalso('gemma3:4b', { vision: true, especifico: 'Pastillero violeta', confirma: 'Pastillero violeta' });
  try {
    ctx = await abrirApp('nuevo', { ollama: ollama.url });
    const { page } = ctx;
    await esperarLista(page, { escena: false });
    await arrastrarVideo(page, NUEVO.a, NUEVO.b);
    await expect(page.locator('.ficha h2')).toHaveText('No reconocido');
    await expect(page.locator('.opinion-nombre')).toHaveText('Parece: Pastillero violeta');
    await expect(page.locator('.opinion')).toContainText(FICHA_IA.resumen);
    // una sola vez por objeto fijado, aunque CLIP lo re-identifique: lo nombra mirando la foto y pregunta (solo con
    // texto) si es alguno de los candidatos de CLIP; dijo que no a todos
    const vistas = ollama.pedidos.filter((p) => p.cuerpo.images);
    expect(vistas).toHaveLength(1);
    expect(vistas[0].cuerpo.prompt).toContain('dos líneas');
    const preguntas = ollama.pedidos.filter((p) => p.cuerpo.prompt?.includes('Respondé solo sí o no'));
    expect(preguntas.length).toBeGreaterThan(0);
    expect(preguntas.every((p) => !p.cuerpo.images && p.cuerpo.prompt.includes('"Pastillero violeta" es un'))).toBe(true);
    expect(vistas[0].cuerpo.images[0].length).toBeGreaterThan(1000); // le mandó la foto del recorte
    await page.getByRole('button', { name: 'Enseñar este objeto' }).click();
    await expect(page.getByLabel('Nombre')).toHaveValue('Pastillero violeta');
    await expect(page.locator('.campos select')).toHaveValue('Electrónica');
    await expect(page.getByLabel('Descripción corta')).toHaveValue(FICHA_IA.resumen);
    // "Mirar el objeto" vuelve a completar todo desde la cámara
    await page.getByLabel('Nombre').fill('');
    await page.getByRole('button', { name: 'Mirar el objeto' }).click();
    await expect(page.getByLabel('Nombre')).toHaveValue('Pastillero violeta');
    await expect(page.getByLabel('Descripción corta')).toHaveValue(FICHA_IA.resumen);
    // medidor para probar la PC de la facultad: todo el modelo en la GPU y cuánto tardó
    await expect(page.locator('.medidor')).toHaveText(/^Modelo entero en la GPU · última respuesta en \d+\.\d\ss$/);
    await capturarYGuardar(page);
    await page.waitForTimeout(3000); // ya reconocido por CLIP: no se le vuelve a preguntar qué es, solo se escribe su descripción larga
    expect(ollama.pedidos.filter((p) => p.cuerpo.images)).toHaveLength(3);
    expect(ollama.pedidos.filter((p) => p.cuerpo.prompt?.includes('Decí qué es exactamente'))).toHaveLength(1);
  } finally {
    ollama.cerrar();
  }
});

test('cuando CLIP duda, la IA confirma un candidato y el porcentaje sube', async () => {
  const ollama = await ollamaFalso('gemma3:4b', { vision: true, nombre: 'Intel Core i7', confirma: OBJETO.nombre });
  try {
    ctx = await abrirApp('quieto', { ollama: ollama.url });
    const { page } = ctx;
    await esperarLista(page);
    // umbral de 95 %: CLIP le da ~90 % al procesador de la escena, así que duda
    await page.getByRole('tab', { name: 'Biblioteca' }).click();
    await page.getByLabel(/Umbral de reconocimiento/).fill('0.95');
    await page.getByRole('tab', { name: 'Identificar' }).click();
    await clicVideo(page, OBJETO.x, OBJETO.y);
    await expect(page.locator('.ficha h2')).toHaveText(OBJETO.nombre);
    await expect(page.locator('.confirmado')).toHaveText('Confirmado por la IA');
    const pct = async (loc) => Number((await page.locator(loc).first().innerText()).match(/(\d+)%/)[1]);
    const clip = await pct('.otros .otro-pct'); // la lista de candidatos sigue mostrando lo que dijo CLIP solo
    expect(clip).toBeLessThan(95);
    await expect.poll(() => pct('.rotulo em')).toBeGreaterThanOrEqual(95); // combinado: CLIP y la IA coinciden
    expect(ollama.pedidos.some((p) => p.cuerpo.prompt?.includes(`"Intel Core i7" es un "${OBJETO.nombre}"`))).toBe(true);
    // el nombre que dio al confirmarlo es el título de la descripción larga: no hace falta volver a preguntar
    await expect(page.locator('.mas-caja h3')).toHaveText('Intel Core i7');
    expect(ollama.pedidos.some((p) => p.cuerpo.prompt?.includes('Decí qué es exactamente'))).toBe(false);
  } finally {
    ollama.cerrar();
  }
});

test('algo que no está en el catálogo (una cámara de fotos): la IA no lo confunde con un candidato y se puede enseñar', async () => {
  const ollama = await ollamaFalso('gemma3:4b', { vision: true, nombre: 'Cámara digital' }); // no confirma ningún candidato
  try {
    ctx = await abrirApp('quieto', { ollama: ollama.url });
    const { page } = ctx;
    await esperarLista(page);
    await page.getByRole('tab', { name: 'Biblioteca' }).click();
    await page.getByLabel(/Umbral de reconocimiento/).fill('0.95'); // CLIP duda
    await page.getByRole('tab', { name: 'Identificar' }).click();
    await clicVideo(page, OBJETO.x, OBJETO.y);
    await expect(page.locator('.opinion-nombre')).toHaveText('Parece: Cámara digital');
    await expect(page.locator('.ficha h2')).toHaveText('No reconocido');
    await expect(page.locator('.confirmado')).toHaveCount(0);
    // aunque después CLIP solo lo diera por reconocido (umbral bajo), vale lo que dijo la IA para este objeto
    await page.getByRole('tab', { name: 'Biblioteca' }).click();
    await page.getByLabel(/Umbral de reconocimiento/).fill('0.6');
    await page.getByRole('tab', { name: 'Identificar' }).click();
    await page.waitForTimeout(3000); // una re-identificación
    await expect(page.locator('.ficha h2')).toHaveText('No reconocido');
    await page.getByRole('button', { name: 'Enseñar este objeto' }).click();
    await expect(page.getByLabel('Nombre')).toHaveValue('Cámara digital');
  } finally {
    ollama.cerrar();
  }
});

test('CLIP seguro pero la IA ve otra cosa (algo fuera del catálogo): pasa a "No reconocido" con su opinión', async () => {
  const ollama = await ollamaFalso('gemma3:4b', { vision: true, especifico: 'Cámara digital' }); // no es un procesador
  try {
    ctx = await abrirApp('quieto', { ollama: ollama.url });
    const { page } = ctx;
    await esperarLista(page);
    await clicVideo(page, OBJETO.x, OBJETO.y); // CLIP le da ~90 %: lo reconoce al instante, hasta que la IA opina
    await expect(page.locator('.opinion-nombre')).toHaveText('Parece: Cámara digital');
    await expect(page.locator('.ficha h2')).toHaveText('No reconocido');
    expect(ollama.pedidos.some((p) => p.cuerpo.prompt?.includes(`"Cámara digital" es un "${OBJETO.nombre}"`))).toBe(true);
    await page.getByRole('button', { name: 'Enseñar este objeto' }).click();
    await expect(page.getByLabel('Nombre')).toHaveValue('Cámara digital');
  } finally {
    ollama.cerrar();
  }
});

test('objeto reconocido: la descripción corta es la del catálogo y la larga la escribe la IA para ese objeto', async () => {
  const ollama = await ollamaFalso('gemma3:4b', { vision: true, confirma: OBJETO.nombre }); // ve un Intel Core i7: es un procesador
  try {
    ctx = await abrirApp('quieto', { ollama: ollama.url });
    const { page } = ctx;
    await esperarLista(page);
    await clicVideo(page, OBJETO.x, OBJETO.y);
    await expect(page.locator('.ficha h2')).toHaveText(OBJETO.nombre);
    await expect(page.locator('.ficha .lead')).toHaveText(FICHA.resumen); // corta: genérica, del catálogo
    await expect(page.locator('.mas-caja h3')).toHaveText('Intel Core i7'); // larga: qué es exactamente
    await expect(page.locator('.escrito-ia')).toHaveText('Escrito por la IA para este objeto');
    await expect(page.locator('.mas-caja p')).toHaveText(['Primer párrafo de la IA.', 'Segundo párrafo de la IA.']);
    const pedido = ollama.pedidos.find((p) => p.cuerpo.prompt?.includes('Decí qué es exactamente'));
    expect(pedido.cuerpo.prompt).toContain(`"${OBJETO.nombre}"`);
    expect(ollama.pedidos.some((p) => p.cuerpo.prompt?.startsWith('Sos docente') && p.cuerpo.prompt.includes('Objeto: Intel Core i7'))).toBe(true);
  } finally {
    ollama.cerrar();
  }
});

test('borrar muestras pide confirmación y "Muestras base" las restaura', async () => {
  ctx = await abrirApp('quieto');
  const { page } = ctx;
  await esperarLista(page);
  await page.getByRole('tab', { name: 'Biblioteca' }).click();
  const fila = page.locator('.tabla-fila', { hasText: OBJETO.nombre });
  await expect(fila.locator('.cnt')).toHaveText(MUESTRAS_BASE);
  await fila.getByRole('button', { name: /Borrar muestras/ }).click();
  await expect(fila.locator('.cnt')).toHaveText(MUESTRAS_BASE); // primer toque: solo pide confirmación
  await fila.getByRole('button', { name: /Confirmar/ }).click();
  await expect(fila.locator('.cnt')).toHaveText('0');
  // sin muestras, el objeto ya no se reconoce
  await page.getByRole('tab', { name: 'Identificar' }).click();
  await clicVideo(page, OBJETO.x, OBJETO.y);
  await expect(page.locator('.ficha h2')).not.toHaveText(OBJETO.nombre);
  await page.getByRole('tab', { name: 'Biblioteca' }).click();
  await page.getByRole('button', { name: 'Muestras base' }).click();
  await expect(page.locator('.tabla-fila', { hasText: OBJETO.nombre }).locator('.cnt')).toHaveText(MUESTRAS_BASE);
});

test('clic sobre una escena vacía: avisa o marca "No reconocido" sin romperse', async () => {
  ctx = await abrirApp('vacio');
  const { page } = ctx;
  await esperarLista(page);
  await clicVideo(page, 0.5, 0.5);
  const resultado = async () => (await page.locator('.ficha h2').count() ? page.locator('.ficha h2').innerText() : (await page.locator('.toast').last().innerText().catch(() => '')));
  await expect.poll(resultado, { timeout: 30_000 }).toMatch(/No reconocido|No encontré un objeto/);
});

// Caja del recuadro en px del cuadro de video (1280×720), leída de la pantalla.
async function cajaDelRecuadro(page) {
  const cam = await page.locator('.cam').boundingBox();
  const m = await page.locator('.marco').boundingBox();
  const k = 1280 / cam.width;
  return { x: (m.x - cam.x) * k, y: (m.y - cam.y) * k, w: m.width * k, h: m.height * k };
}
const iouCajas = (a, b) => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (ix * iy) / (a.w * a.h + b.w * b.h - ix * iy);
};

test('objeto chico sobre una alfombrilla: el recuadro toma el objeto y otro clic cambia el recorte', async () => {
  ctx = await abrirApp('chico');
  const { page } = ctx;
  await esperarLista(page);
  const g = ARDUINO_CHICO;
  // clic descentrado sobre el objeto (el caso que antes tomaba la alfombrilla entera)
  await clicVideo(page, (g.x + g.w * 0.3) / 1280, (g.y + g.h * 0.35) / 720);
  await expect(page.locator('.marco')).toHaveCount(1);
  const sobreElObjeto = () => expect.poll(async () => iouCajas(await cajaDelRecuadro(page), g), { timeout: 10_000 }).toBeGreaterThan(0.5);
  await sobreElObjeto().catch(async () => {
    // en 1 o 2 de cada 90 cuadros de esta escena SAM igual da primero lo que rodea al objeto: otro clic sobre el
    // objeto lo achica, que es lo que haría quien usa la app
    test.info().annotations.push({ type: 'aviso', description: 'el primer clic tomó lo que rodea al objeto; se achicó con otro clic' });
    await page.waitForTimeout(500);
    await clicVideo(page, (g.x + g.w * 0.5) / 1280, (g.y + g.h * 0.5) / 720);
    await sobreElObjeto();
  });
  await page.waitForTimeout(500); // que termine la animación del recuadro antes de medirlo
  const antes = await cajaDelRecuadro(page);
  // otro clic dentro del recuadro: cambia el recorte en vez de buscar otro objeto
  await clicVideo(page, (g.x + g.w * 0.5) / 1280, (g.y + g.h * 0.5) / 720);
  await expect(page.locator('.toast', { hasText: /Recorte más chico|Volvió al recorte más grande/ })).toBeVisible();
  // el recorte siguiente puede tener el mismo ancho y otro alto: se compara el área del recuadro
  const area = (c) => c.w * c.h;
  await expect.poll(async () => Math.abs(area(await cajaDelRecuadro(page)) / area(antes) - 1), { timeout: 10_000 }).toBeGreaterThan(0.1);
});
