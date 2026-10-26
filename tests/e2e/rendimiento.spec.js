// Escenarios de rendimiento: miden fluidez de cámara e interfaz y latencias. Cada uno se repite UCSE_REPS veces
// (3 por defecto) con la app recién abierta, y guarda los números en tests/.tmp/resultados.json.
import { test, expect } from '@playwright/test';
import { abrirApp, esperarLista, clicVideo, iniciarMedicion, terminarMedicion, guardarResultado, OBJETO } from './app.js';

const REPS = +(process.env.UCSE_REPS ?? 3);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function escenario(nombre, escena, cuerpo) {
  for (let i = 1, invalidas = 0; i <= REPS; ) {
    const { app, page, errores } = await abrirApp(escena);
    try {
      await esperarLista(page);
      await espera(1500); // que se asienten las animaciones de entrada
      const extra = (await cuerpo(page)) ?? {};
      // si el sistema pausó la ventana (pantalla apagada, ventana tapada) la interfaz cae a ~1 cuadro por segundo:
      // esa corrida no mide la app, se descarta y se repite (hasta 3 veces por escenario)
      if ((extra.interfazFps < 10 || extra.pausasSistema >= 2) && invalidas < 3) {
        invalidas++;
        console.log(`  ${nombre}: corrida descartada, ventana pausada por el sistema (${extra.interfazFps} fps)`);
        continue;
      }
      const escenaTxt = await page.locator('.stat').nth(3).locator('strong').innerText(); // "1.3 s GPU"
      guardarResultado(nombre, { repeticion: i, ...extra, escenaS: parseFloat(escenaTxt), samEn: escenaTxt.replace(/[\d.\s]+s/, '').trim(), descartadas: invalidas, errores: errores.length });
      i++;
    } finally {
      await app.close();
    }
  }
}

// Mide desde el clic hasta que aparece el recuadro y hasta que aparece la ficha.
async function clicYFicha(page, fx, fy) {
  const t0 = Date.now();
  await clicVideo(page, fx, fy);
  await expect(page.locator('.marco')).toHaveCount(1, { timeout: 30_000 });
  const recuadroMs = Date.now() - t0;
  await expect(page.locator('.ficha h2')).toBeVisible({ timeout: 30_000 });
  return { recuadroMs, fichaMs: Date.now() - t0 };
}

test('reposo: cámara sin interacción', async () => {
  await escenario('reposo', 'quieto', async (page) => {
    await iniciarMedicion(page);
    await espera(10_000);
    return terminarMedicion(page);
  });
});

test('identificar: clic sobre el objeto y ficha', async () => {
  await escenario('identificar', 'quieto', async (page) => {
    await iniciarMedicion(page);
    const lat = await clicYFicha(page, OBJETO.x, OBJETO.y);
    const reconocido = await page.locator('.ficha h2').textContent();
    await espera(8_000); // incluye las re-identificaciones periódicas
    return { ...lat, reconocido, ...(await terminarMedicion(page)) };
  });
});

test('seguimiento: objeto en movimiento durante 15 s', async () => {
  await escenario('seguimiento', 'movil', async (page) => {
    await iniciarMedicion(page);
    const lat = await clicYFicha(page, 0.5, OBJETO.y);
    let perdido = 0;
    for (let s = 0; s < 15; s++) {
      await espera(1000);
      if (await page.locator('.marco.perdido').count()) perdido++;
    }
    return { ...lat, segundosPerdido: perdido, ...(await terminarMedicion(page)) };
  });
});

test('ráfaga: 8 muestras en Enseñar', async () => {
  await escenario('rafaga', 'quieto', async (page) => {
    await clicVideo(page, OBJETO.x, OBJETO.y);
    await expect(page.locator('.marco')).toHaveCount(1, { timeout: 30_000 });
    await page.getByRole('tab', { name: 'Enseñar' }).click();
    await iniciarMedicion(page);
    const t0 = Date.now();
    await page.getByRole('button', { name: /Ráfaga/ }).click();
    await expect(page.locator('.minis img')).toHaveCount(8, { timeout: 60_000 });
    const rafagaMs = Date.now() - t0;
    await espera(1000);
    return { rafagaMs, ...(await terminarMedicion(page)) };
  });
});

test('clics en movimiento: 4 selecciones seguidas con la escena cambiando', async () => {
  await escenario('clics-movimiento', 'movil', async (page) => {
    await iniciarMedicion(page);
    const lats = [];
    for (let k = 0; k < 4; k++) {
      lats.push((await clicYFicha(page, 0.5, OBJETO.y)).fichaMs);
      await page.getByRole('button', { name: 'Soltar objeto' }).click();
      await espera(1500);
    }
    return { fichaMs: Math.round(lats.reduce((s, x) => s + x, 0) / lats.length), fichaMaxMs: Math.max(...lats), ...(await terminarMedicion(page)) };
  });
});
