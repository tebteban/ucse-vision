// Pruebas de estrés: uso abusivo y prolongado. La app no debe tirar errores, perder memoria ni trabarse.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirApp, esperarLista, clicVideo, arrastrarVideo, iniciarMedicion, terminarMedicion, guardarResultado, ARDUINO } from './app.js';

let ctx;
test.afterEach(async () => {
  expect(ctx?.errores ?? [], 'errores en la consola de la app').toEqual([]);
  await ctx?.app.close();
  ctx = null;
});
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

test('100 clics rápidos por toda la cámara', async () => {
  ctx = await abrirApp('quieto');
  const { page } = ctx;
  await esperarLista(page);
  await iniciarMedicion(page);
  for (let i = 0; i < 100; i++) await clicVideo(page, 0.05 + Math.random() * 0.9, 0.05 + Math.random() * 0.9);
  await espera(5000);
  const m = await terminarMedicion(page);
  guardarResultado('estres-clics', m);
  // después del abuso sigue respondiendo bien
  if (await page.locator('.marco').count()) await page.getByRole('button', { name: 'Soltar objeto' }).click();
  await clicVideo(page, ARDUINO.x, ARDUINO.y);
  await expect(page.locator('.ficha h2')).toHaveText('Placa Arduino');
});

test('200 cambios rápidos de pestaña y categoría con un objeto fijado', async () => {
  ctx = await abrirApp('quieto');
  const { page } = ctx;
  await esperarLista(page);
  await clicVideo(page, ARDUINO.x, ARDUINO.y);
  await expect(page.locator('.ficha h2')).toHaveText('Placa Arduino');
  await iniciarMedicion(page);
  const tabs = ['Enseñar', 'Biblioteca', 'Identificar'];
  const cats = ['Informática', 'Electrónica', 'Todas'];
  for (let i = 0; i < 200; i++) {
    if (i % 2) await page.getByRole('tab', { name: tabs[i % 3] }).click();
    else await page.getByRole('button', { name: cats[i % 3], exact: true }).click();
  }
  const m = await terminarMedicion(page);
  guardarResultado('estres-pestanas', m);
  await page.getByRole('tab', { name: 'Identificar' }).click();
  await page.getByRole('button', { name: 'Todas', exact: true }).click();
  await expect(page.locator('.ficha h2')).toHaveText('Placa Arduino');
});

test('10 ráfagas seguidas (80 muestras) sobre un objeto del catálogo', async () => {
  ctx = await abrirApp('quieto');
  const { page } = ctx;
  await esperarLista(page);
  await clicVideo(page, ARDUINO.x, ARDUINO.y);
  await expect(page.locator('.marco')).toHaveCount(1);
  await page.getByRole('tab', { name: 'Enseñar' }).click();
  await page.getByLabel('Objeto').selectOption('arduino');
  await iniciarMedicion(page);
  const t0 = Date.now();
  for (let r = 1; r <= 10; r++) {
    await page.getByRole('button', { name: /Ráfaga/ }).click();
    await expect(page.locator('.minis img')).toHaveCount(8 * r, { timeout: 60_000 });
  }
  const m = { ...(await terminarMedicion(page)), muestrasPorSegundo: Math.round((80 / ((Date.now() - t0) / 1000)) * 10) / 10 };
  guardarResultado('estres-rafagas', m);
  await page.getByRole('button', { name: 'Guardar y reconocer' }).click();
  await page.getByRole('tab', { name: 'Biblioteca' }).click();
  await expect(page.locator('.tabla-fila', { hasText: 'Placa Arduino' }).locator('.cnt')).toHaveText('104');
});

test('fijar y soltar 40 veces seguidas', async () => {
  ctx = await abrirApp('quieto');
  const { page } = ctx;
  await esperarLista(page);
  await iniciarMedicion(page);
  for (let i = 0; i < 40; i++) {
    if (i % 2) await clicVideo(page, ARDUINO.x, ARDUINO.y);
    else await arrastrarVideo(page, [0.33, 0.22], [0.67, 0.78]);
    await expect(page.locator('.marco')).toHaveCount(1, { timeout: 30_000 });
    await page.getByRole('button', { name: 'Soltar objeto' }).click();
  }
  guardarResultado('estres-fijar-soltar', await terminarMedicion(page));
  await clicVideo(page, ARDUINO.x, ARDUINO.y);
  await expect(page.locator('.ficha h2')).toHaveText('Placa Arduino');
});

test('biblioteca grande: 3000 muestras propias importadas', async () => {
  ctx = await abrirApp('quieto');
  const { page } = ctx;
  await esperarLista(page);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ucse-grande-'));
  const archivo = path.join(dir, 'grande.json');
  const vec = () => {
    const v = Array.from({ length: 512 }, () => Math.random() - 0.5);
    const n = Math.hypot(...v);
    return v.map((x) => +(x / n).toFixed(4));
  };
  const objetos = Array.from({ length: 60 }, (_, i) => ({ id: `obj-${i}`, nombre: `Objeto ${i}`, categoria: i % 2 ? 'Informática' : 'Electrónica', resumen: 'r', detalle: 'd' }));
  fs.writeFileSync(archivo, JSON.stringify({ objetos, muestras: Array.from({ length: 3000 }, (_, i) => ({ id: `obj-${i % 60}`, v: vec() })), sinBase: [] }));
  await page.getByRole('tab', { name: 'Biblioteca' }).click();
  await page.locator('input[type=file]').setInputFiles(archivo);
  await expect(page.locator('.toast', { hasText: /60 objetos propios y 3000 muestras/ })).toBeVisible();
  await page.getByRole('tab', { name: 'Identificar' }).click();
  await iniciarMedicion(page);
  const t0 = Date.now();
  await clicVideo(page, ARDUINO.x, ARDUINO.y);
  await expect(page.locator('.ficha h2')).toHaveText('Placa Arduino');
  const fichaMs = Date.now() - t0;
  await espera(5000); // re-identificaciones periódicas con la biblioteca grande
  guardarResultado('estres-biblioteca-grande', { fichaMs, ...(await terminarMedicion(page)) });
});

test('corrida larga: 3 minutos siguiendo un objeto en movimiento', async () => {
  test.setTimeout(420_000);
  ctx = await abrirApp('movil');
  const { page } = ctx;
  await esperarLista(page);
  await clicVideo(page, 0.5, ARDUINO.y);
  await expect(page.locator('.ficha h2')).toHaveText('Placa Arduino', { timeout: 60_000 });
  await iniciarMedicion(page);
  let perdido = 0;
  for (let s = 0; s < 180; s++) {
    await espera(1000);
    if (await page.locator('.marco.perdido').count()) perdido++;
  }
  const m = await terminarMedicion(page);
  guardarResultado('estres-3-minutos', { ...m, segundosPerdido: perdido });
  expect(perdido).toBeLessThan(10);
  expect(m.heapCrecioMb).toBeLessThan(40);
  await expect(page.locator('.ficha h2')).toHaveText('Placa Arduino');
});
