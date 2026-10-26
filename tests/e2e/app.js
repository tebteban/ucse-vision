// Utilidades compartidas de las pruebas E2E: abre la app de escritorio real (dist/ + electron.js) con una
// cámara falsa que reproduce tests/.tmp/<escena>.mjpeg y un perfil vacío, y mide la fluidez de la interfaz.
import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '../..');

export async function abrirApp(escena = 'quieto', { perfil, ollama = 'http://127.0.0.1:9' } = {}) {
  const video = path.join(RAIZ, 'tests/.tmp', `${escena}.mjpeg`);
  if (!fs.existsSync(video)) throw new Error(`Falta ${video}: corré "node tests/fixtures/generar.mjs"`);
  const userData = perfil ?? fs.mkdtempSync(path.join(os.tmpdir(), 'ucse-prueba-'));
  const ejecutable = process.env.UCSE_EJECUTABLE; // el paquete portable (release/UCSE-Vision/UCSE Vision.exe)
  const app = await electron.launch({
    cwd: process.env.UCSE_APP_DIR ?? RAIZ, // otra carpeta con electron.js + dist/, para medir versiones anteriores
    ...(ejecutable && { executablePath: path.resolve(RAIZ, ejecutable) }),
    args: [
      ...(ejecutable ? [] : ['.']),
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${video}`,
      // si otra ventana tapa la app, Windows/Chromium la pausan y las mediciones salen a 1 cuadro por segundo
      '--disable-features=CalculateNativeWinOcclusion',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--enable-precise-memory-info',
    ],
    env: { ...process.env, NODE_ENV: 'production', UCSE_TEST: '1', UCSE_USER_DATA: userData, UCSE_OLLAMA: ollama }, // por defecto sin Ollama, aunque la PC lo tenga
  });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setAlwaysOnTop(true);
    w.show();
    w.focus();
  });
  const errores = [];
  page.on('pageerror', (e) => errores.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errores.push(m.text()));
  return { app, page, errores, userData };
}

// Espera a que pase la pantalla de inicio y a que la selección por clic esté lista.
export async function esperarLista(page, { escena = true } = {}) {
  // primero que React haya dibujado (si no, "no hay pantalla de inicio" pasa enseguida con la página en blanco)
  await expect(page.locator('.estado').first()).toHaveText(/Reconocimiento listo/, { timeout: 90_000 });
  await expect(page.locator('.splash')).toHaveCount(0, { timeout: 60_000 });
  if (escena) await expect(page.locator('.estado').nth(1)).toHaveText(/Escena lista/, { timeout: 90_000 });
}

// Clic o arrastre en coordenadas relativas al video (0-1).
export async function clicVideo(page, fx, fy) {
  const r = await page.locator('.cam').boundingBox();
  await page.mouse.click(r.x + r.width * fx, r.y + r.height * fy);
}
export async function arrastrarVideo(page, [x0, y0], [x1, y1]) {
  const r = await page.locator('.cam').boundingBox();
  await page.mouse.move(r.x + r.width * x0, r.y + r.height * y0);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width * x1, r.y + r.height * y1, { steps: 8 });
  await page.mouse.up();
}

// Objeto de las escenas "quieto" y "movil" (centro del cuadro, ver tests/fixtures/generar.mjs): una foto que no está
// entre las muestras base (tests/fixtures/objeto.jpg), para probar el reconocimiento como con la cámara.
export const OBJETO = { x: 0.5, y: (170 + 190) / 720, id: 'cpu', nombre: 'Procesador (CPU)' };
// Escena "chico": una placa de 110 px sobre una alfombrilla que toca el borde (en px del cuadro de 1280×720). Solo
// prueba el recorte, no el reconocimiento: usa la foto del Arduino (tests/fixtures/arduino.jpg).
export const ARDUINO_CHICO = { x: 640 - 55, y: 435, w: 110, h: 110 };

// --- métricas de fluidez ---
// video: intervalo entre cuadros de la cámara efectivamente mostrados (requestVideoFrameCallback).
// cuadros: intervalo entre cuadros de la interfaz (requestAnimationFrame).
// tareasLargas: bloqueos del hilo principal de más de 50 ms (PerformanceObserver "longtask").
export async function iniciarMedicion(page) {
  await page.evaluate(() => {
    window.__med?.parar?.();
    const m = { video: [], cuadros: [], tareas: [], activo: true };
    const obs = new PerformanceObserver((l) => l.getEntries().forEach((e) => m.tareas.push(e.duration)));
    obs.observe({ type: 'longtask' });
    let prev = performance.now();
    const raf = (t) => {
      m.cuadros.push(t - prev);
      prev = t;
      if (m.activo) requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
    const v = document.querySelector('video');
    let pv = null;
    const vf = (now) => {
      if (pv !== null) m.video.push(now - pv);
      pv = now;
      if (m.activo) v.requestVideoFrameCallback(vf);
    };
    v.requestVideoFrameCallback(vf);
    m.inicio = performance.now();
    m.heap0 = performance.memory?.usedJSHeapSize ?? 0;
    m.parar = () => {
      m.activo = false;
      obs.disconnect();
    };
    window.__med = m;
  });
}

const pct = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0);
const r1 = (x) => Math.round(x * 10) / 10;

export async function terminarMedicion(page) {
  const m = await page.evaluate(() => {
    const m = window.__med;
    m.parar();
    return { video: m.video, cuadros: m.cuadros, tareas: m.tareas, ms: performance.now() - m.inicio, heap: (performance.memory?.usedJSHeapSize ?? 0) - m.heap0, heapTotal: performance.memory?.usedJSHeapSize ?? 0, visible: document.visibilityState, foco: document.hasFocus() };
  });
  const seg = m.ms / 1000;
  return {
    segundos: r1(seg),
    videoFps: r1((m.video.length + 1) / seg),
    videoHuecoMaxMs: Math.round(Math.max(0, ...m.video)),
    congelamientos: m.video.filter((x) => x >= 250).length, // la cámara quieta un cuarto de segundo o más
    interfazFps: r1(m.cuadros.length / seg),
    cuadroP95Ms: r1(pct(m.cuadros, 0.95)),
    cuadroMaxMs: Math.round(Math.max(0, ...m.cuadros)),
    tirones: m.cuadros.filter((x) => x > 50).length, // cuadros de interfaz de más de 50 ms
    pausasSistema: m.cuadros.filter((x) => x > 900 && x < 1150).length, // ~1 s exacto: Windows pausó la ventana (no es la app)
    tareasLargas: m.tareas.length,
    bloqueoTotalMs: Math.round(m.tareas.reduce((s, x) => s + x, 0)),
    bloqueoMaxMs: Math.round(Math.max(0, ...m.tareas)),
    heapMb: r1(m.heapTotal / 1e6),
    heapCrecioMb: r1(m.heap / 1e6),
    visible: m.visible,
    foco: m.foco,
  };
}

// Guarda resultados de rendimiento para la tabla comparativa.
export function guardarResultado(nombre, datos) {
  const archivo = path.join(RAIZ, 'tests/.tmp/resultados.json');
  const todos = fs.existsSync(archivo) ? JSON.parse(fs.readFileSync(archivo, 'utf8')) : [];
  todos.push({ nombre, version: process.env.UCSE_VERSION ?? 'actual', fecha: new Date().toISOString(), ...datos });
  fs.writeFileSync(archivo, JSON.stringify(todos, null, 2));
}
