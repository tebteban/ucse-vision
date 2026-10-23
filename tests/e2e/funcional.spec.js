// Pruebas E2E funcionales: los flujos que se usan en la demo, sobre la app de escritorio real.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import catalogo from '../../src/data/catalogo.json' with { type: 'json' };
import { abrirApp, esperarLista, clicVideo, arrastrarVideo, ARDUINO } from './app.js';

const ARDUINO_FICHA = catalogo.find((o) => o.id === 'arduino');
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
  await expect(page.locator('.stat').first()).toContainText('43');
  await expect(page.locator('.flotante').first()).toHaveText(/En vivo/);
  await expect(page.locator('.espera h2')).toHaveText('Apuntá y hacé clic');
});

test('clic sobre el objeto: recuadro, nombre, descripción corta y larga', async () => {
  ctx = await abrirApp('quieto');
  const { page } = ctx;
  await esperarLista(page);
  await clicVideo(page, ARDUINO.x, ARDUINO.y);
  // sobre la cámara: nombre, % y descripción corta
  await expect(page.locator('.rotulo b')).toHaveText('Placa Arduino');
  await expect(page.locator('.rotulo-resumen')).toHaveText(ARDUINO_FICHA.resumen);
  // en el panel: descripción corta y larga (abierta por defecto)
  await expect(page.locator('.ficha h2')).toHaveText('Placa Arduino');
  await expect(page.locator('.ficha .eyebrow')).toHaveText('Electrónica');
  await expect(page.locator('.ficha .lead')).toHaveText(ARDUINO_FICHA.resumen);
  const [p1, p2] = ARDUINO_FICHA.detalle.split('\n');
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
  await expect(page.locator('.ficha h2')).toHaveText('Placa Arduino');
});

test('el filtro de categoría cambia lo que se puede reconocer', async () => {
  ctx = await abrirApp('quieto');
  const { page } = ctx;
  await esperarLista(page);
  await clicVideo(page, ARDUINO.x, ARDUINO.y);
  await expect(page.locator('.ficha h2')).toHaveText('Placa Arduino');
  await page.getByRole('button', { name: 'Informática', exact: true }).click();
  await expect(page.locator('.ficha h2')).not.toHaveText('Placa Arduino');
  await expect(page.locator('.stat').first()).toContainText('28');
  await page.getByRole('button', { name: 'Electrónica', exact: true }).click();
  await expect(page.locator('.ficha h2')).toHaveText('Placa Arduino');
  await expect(page.locator('.stat').first()).toContainText('15');
});

test('enseñar un objeto nuevo en vivo, reconocerlo y que persista al reiniciar', async () => {
  ctx = await abrirApp('nuevo');
  const { page, userData } = ctx;
  await esperarLista(page, { escena: false });
  await arrastrarVideo(page, NUEVO.a, NUEVO.b);
  await expect(page.locator('.marco')).toHaveCount(1);
  await page.getByRole('tab', { name: 'Enseñar' }).click();
  await page.getByLabel('Nombre').fill('Pastillero violeta');
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

test('borrar muestras pide confirmación y "Muestras base" las restaura', async () => {
  ctx = await abrirApp('quieto');
  const { page } = ctx;
  await esperarLista(page);
  await page.getByRole('tab', { name: 'Biblioteca' }).click();
  const fila = page.locator('.tabla-fila', { hasText: 'Placa Arduino' });
  await expect(fila.locator('.cnt')).toHaveText('24');
  await fila.getByRole('button', { name: /Borrar muestras/ }).click();
  await expect(fila.locator('.cnt')).toHaveText('24'); // primer toque: solo pide confirmación
  await fila.getByRole('button', { name: /Confirmar/ }).click();
  await expect(fila.locator('.cnt')).toHaveText('0');
  // sin muestras, el Arduino ya no se reconoce como Arduino
  await page.getByRole('tab', { name: 'Identificar' }).click();
  await clicVideo(page, ARDUINO.x, ARDUINO.y);
  await expect(page.locator('.ficha h2')).not.toHaveText('Placa Arduino');
  await page.getByRole('tab', { name: 'Biblioteca' }).click();
  await page.getByRole('button', { name: 'Muestras base' }).click();
  await expect(page.locator('.tabla-fila', { hasText: 'Placa Arduino' }).locator('.cnt')).toHaveText('24');
});

test('clic sobre una escena vacía: avisa o marca "No reconocido" sin romperse', async () => {
  ctx = await abrirApp('vacio');
  const { page } = ctx;
  await esperarLista(page);
  await clicVideo(page, 0.5, 0.5);
  const resultado = async () => (await page.locator('.ficha h2').count() ? page.locator('.ficha h2').innerText() : (await page.locator('.toast').last().innerText().catch(() => '')));
  await expect.poll(resultado, { timeout: 30_000 }).toMatch(/No reconocido|No encontré un objeto/);
});
