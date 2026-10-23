// Algoritmo de seguimiento por coincidencia de plantilla (SAD) sobre imágenes en gris de baja resolución.
// Funciones puras: las usa seguidor.worker.js y se pueden probar sin navegador.
// shortcut: solo traslación (no sigue giros ni cambios de tamaño) y radio de búsqueda corto;
// sirve para "pequeños movimientos". Para más, usar un tracker real (p. ej. KCF de OpenCV).
export const RADIO = 18; // px de búsqueda (en la imagen reducida) por paso
export const OK = 0.14; // diferencia media máxima (0-1) para aceptar la coincidencia
export const MAX_PERDIDOS = 12; // pasos seguidos sin coincidir antes de darlo por perdido
const MEZCLA = 0.12; // cuánto se renueva la plantilla en cada paso

// RGBA -> gris (luminancia aproximada).
export function aGris(rgba, W, H) {
  const out = new Uint8Array(W * H);
  for (let i = 0; i < out.length; i++) out[i] = (rgba[4 * i] * 77 + rgba[4 * i + 1] * 150 + rgba[4 * i + 2] * 29) >> 8;
  return out;
}

function recortar(f, W, b) {
  const t = new Float32Array(b.w * b.h);
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) t[y * b.w + x] = f[(b.y + y) * W + b.x + x];
  return t;
}

// caja en px de la imagen reducida. Devuelve el estado inicial del seguimiento.
export function iniciar(gris, W, H, caja) {
  const w = Math.max(10, Math.min(W - 2, Math.round(caja.w)));
  const h = Math.max(10, Math.min(H - 2, Math.round(caja.h)));
  const b = { x: Math.min(Math.max(Math.round(caja.x), 0), W - w), y: Math.min(Math.max(Math.round(caja.y), 0), H - h), w, h };
  const salto = Math.max(1, Math.round(Math.sqrt((w * h) / 3000))); // acota el costo de cajas grandes
  return { W, H, b, plantilla: recortar(gris, W, b), salto, muestras: Math.ceil(h / salto) * Math.ceil(w / salto), perdidos: 0 };
}

// Avanza un cuadro: busca la plantilla cerca de la posición anterior. Modifica y devuelve el estado.
export function paso(e, gris) {
  const { W, H, b, plantilla, salto } = e;
  let mejor = Infinity;
  let bx = b.x;
  let by = b.y;
  const x0 = Math.max(0, b.x - RADIO);
  const x1 = Math.min(W - b.w, b.x + RADIO);
  const y0 = Math.max(0, b.y - RADIO);
  const y1 = Math.min(H - b.h, b.y + RADIO);
  for (let oy = y0; oy <= y1; oy++) {
    for (let ox = x0; ox <= x1; ox++) {
      let s = 0;
      for (let y = 0; y < b.h && s < mejor; y += salto) {
        const fi = (oy + y) * W + ox;
        const ti = y * b.w;
        for (let x = 0; x < b.w; x += salto) s += Math.abs(gris[fi + x] - plantilla[ti + x]);
      }
      if (s < mejor) {
        mejor = s;
        bx = ox;
        by = oy;
      }
    }
  }
  if (mejor / (e.muestras * 255) <= OK) {
    e.b = { ...b, x: bx, y: by };
    const nuevo = recortar(gris, W, e.b);
    for (let i = 0; i < plantilla.length; i++) plantilla[i] += (nuevo[i] - plantilla[i]) * MEZCLA;
    e.perdidos = 0;
  } else {
    e.perdidos++;
  }
  e.ok = e.perdidos < MAX_PERDIDOS;
  return e;
}

// --- comparación de escenas (miniaturas 64×36 en gris) ---
export const MINI_W = 64;
export const MINI_H = 36;

export const diferencia = (a, b) => a.reduce((s, x, i) => s + Math.abs(x - b[i]), 0) / a.length;

// Igual, pero en una ventana alrededor de un punto (fx, fy en 0-1), de ~1/4 del ancho.
export function diferenciaLocal(a, b, fx, fy) {
  const cx = Math.round(fx * MINI_W);
  const cy = Math.round(fy * MINI_H);
  let s = 0;
  let n = 0;
  for (let y = Math.max(0, cy - 6); y <= Math.min(MINI_H - 1, cy + 6); y++) {
    for (let x = Math.max(0, cx - 8); x <= Math.min(MINI_W - 1, cx + 8); x++) {
      s += Math.abs(a[y * MINI_W + x] - b[y * MINI_W + x]);
      n++;
    }
  }
  return s / n;
}
