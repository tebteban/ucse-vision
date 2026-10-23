// Pruebas de tolerancia a fallos: la app tiene que recuperarse sola de cada problema y seguir funcionando.
import { test, expect } from '@playwright/test';
import { abrirApp, esperarLista, clicVideo, ARDUINO } from './app.js';

let ctx;
test.afterEach(async () => {
  await ctx?.app.close();
  ctx = null;
});

// La prueba final de cada caso: un clic identifica el Arduino.
async function identificaArduino(page) {
  if (await page.locator('.marco').count()) await page.getByRole('button', { name: 'Soltar objeto' }).click();
  await clicVideo(page, ARDUINO.x, ARDUINO.y);
  await expect(page.locator('.ficha h2')).toHaveText('Placa Arduino', { timeout: 60_000 });
}

test('la cámara se desconecta y la app se reconecta sola', async () => {
  ctx = await abrirApp('quieto');
  const { page } = ctx;
  await esperarLista(page);
  // simula que se desenchufa: se corta la pista y se avisa como lo haría el sistema
  await page.evaluate(() => {
    const [pista] = document.querySelector('video').srcObject.getVideoTracks();
    pista.stop();
    pista.dispatchEvent(new Event('ended'));
  });
  await expect(page.locator('.cam-error')).toContainText('se desconectó');
  await expect(page.locator('.flotante').first()).toHaveText(/Sin señal/);
  await expect(page.locator('.cam-error')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('.flotante').first()).toHaveText(/En vivo/);
  await esperarLista(page);
  await identificaArduino(page);
});

test('el botón "Reintentar ahora" reabre la cámara sin esperar', async () => {
  ctx = await abrirApp('quieto');
  const { page } = ctx;
  await esperarLista(page);
  await page.evaluate(() => {
    const [pista] = document.querySelector('video').srcObject.getVideoTracks();
    pista.stop();
    pista.dispatchEvent(new Event('ended'));
  });
  await page.getByRole('button', { name: 'Reintentar ahora' }).click();
  await expect(page.locator('.cam-error')).toHaveCount(0, { timeout: 10_000 });
  await identificaArduino(page);
});

test('el proceso de reconocimiento se cae y se reinicia solo', async () => {
  ctx = await abrirApp('quieto');
  const { page } = ctx;
  await esperarLista(page);
  await page.evaluate(() => window.__ucse.matarReconocimiento());
  await identificaArduino(page);
  // caída en medio de una identificación: avisa, no se cuelga, y el siguiente intento funciona
  await page.getByRole('button', { name: 'Soltar objeto' }).click();
  await clicVideo(page, ARDUINO.x, ARDUINO.y);
  await page.evaluate(() => window.__ucse.matarReconocimiento());
  await expect(page.locator('.rotulo b')).toHaveText(/Placa Arduino|Reintentando…/, { timeout: 30_000 });
  await identificaArduino(page);
});

test('el proceso de segmentación se cae y el clic se resuelve igual', async () => {
  ctx = await abrirApp('quieto');
  const { page } = ctx;
  await esperarLista(page);
  await page.evaluate(() => window.__ucse.matarSegmentacion());
  await identificaArduino(page); // re-analiza la escena y reintenta el clic sin intervención
});

test('la página se cae y Electron la recarga', async () => {
  ctx = await abrirApp('quieto');
  const { page, app } = ctx;
  await esperarLista(page);
  // se espera la recarga que hace electron.js (evento did-finish-load de la página nueva)
  const recargada = app.evaluate(({ BrowserWindow }) => new Promise((ok) => BrowserWindow.getAllWindows()[0].webContents.once('did-finish-load', () => ok(true))));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
  expect(await recargada).toBe(true);
  // Playwright no se reengancha a la página recargada: se verifica y se opera desde el proceso principal de Electron.
  // Cada consulta tiene límite de tiempo: si la página está caída, executeJavaScript no responde nunca.
  const enPagina = (js) => app.evaluate(({ BrowserWindow }, codigo) => Promise.race([
    BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(codigo).catch(() => null),
    new Promise((ok) => setTimeout(() => ok(null), 3000)),
  ]), js);
  await expect.poll(() => enPagina(`!document.querySelector('.splash') && !!document.querySelectorAll('.estado')[1]?.innerText.includes('Escena lista')`), { timeout: 90_000 }).toBe(true);
  const r = await enPagina(`(() => { const r = document.querySelector('.cam').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  await app.evaluate(({ BrowserWindow }, p) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  }, { x: Math.round(r.x + r.w * ARDUINO.x), y: Math.round(r.y + r.h * ARDUINO.y) });
  await expect.poll(() => enPagina(`document.querySelector('.ficha h2')?.innerText`), { timeout: 60_000 }).toBe('Placa Arduino');
});

test('almacenamiento lleno: avisa y el objeto enseñado igual se puede usar', async () => {
  ctx = await abrirApp('quieto');
  const { page } = ctx;
  await esperarLista(page);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('lleno', 'QuotaExceededError');
    };
  });
  await clicVideo(page, ARDUINO.x, ARDUINO.y);
  await expect(page.locator('.marco')).toHaveCount(1);
  await page.getByRole('tab', { name: 'Enseñar' }).click();
  await page.getByLabel('Nombre').fill('Arduino de prueba');
  await page.getByRole('button', { name: /Ráfaga/ }).click();
  await expect(page.locator('.minis img')).toHaveCount(8, { timeout: 60_000 });
  await page.getByRole('button', { name: 'Guardar y reconocer' }).click();
  await expect(page.locator('.toast', { hasText: /No se pudo guardar/ })).toBeVisible();
  await expect(page.locator('.ficha h2')).toHaveText('Arduino de prueba');
});

test('un error inesperado no tumba la app', async () => {
  ctx = await abrirApp('quieto');
  const { page } = ctx;
  await esperarLista(page);
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('falla provocada por la prueba');
    });
    Promise.reject(new Error('promesa rechazada por la prueba'));
  });
  await expect(page.locator('.toast', { hasText: /error inesperado/ })).toBeVisible();
  await identificaArduino(page);
});
