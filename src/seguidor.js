// Sigue una caja entre cuadros del video por coincidencia de plantilla (SAD) en gris y baja resolución.
// shortcut: solo traslación (no sigue giros ni cambios de tamaño) y radio de búsqueda corto;
// sirve para "pequeños movimientos". Para más, usar un tracker real (p. ej. KCF de OpenCV).
const ANCHO = 320;
const RADIO = 18; // px de búsqueda (en la imagen reducida) por paso
const OK = 0.14; // diferencia media máxima (0-1) para aceptar la coincidencia
const MAX_PERDIDOS = 12; // pasos seguidos sin coincidir antes de darlo por perdido
const MEZCLA = 0.12; // cuánto se renueva la plantilla en cada paso

export function crearSeguidor(video, caja) {
  const k = ANCHO / video.videoWidth;
  const W = ANCHO;
  const H = Math.round(video.videoHeight * k);
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d', { willReadFrequently: true });

  const gris = () => {
    g.drawImage(video, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data;
    const out = new Uint8Array(W * H);
    for (let i = 0; i < out.length; i++) out[i] = (d[4 * i] * 77 + d[4 * i + 1] * 150 + d[4 * i + 2] * 29) >> 8;
    return out;
  };
  const recortar = (f, b) => {
    const t = new Uint8Array(b.w * b.h);
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) t[y * b.w + x] = f[(b.y + y) * W + b.x + x];
    return t;
  };

  const w = Math.max(10, Math.min(W - 2, Math.round(caja.w * k)));
  const h = Math.max(10, Math.min(H - 2, Math.round(caja.h * k)));
  let b = {
    x: Math.min(Math.max(Math.round(caja.x * k), 0), W - w),
    y: Math.min(Math.max(Math.round(caja.y * k), 0), H - h),
    w,
    h,
  };
  const plantilla = Float32Array.from(recortar(gris(), b));
  const paso = Math.max(1, Math.round(Math.sqrt((b.w * b.h) / 3000))); // acota el costo de cajas grandes
  const muestras = Math.ceil(b.h / paso) * Math.ceil(b.w / paso);
  let perdidos = 0;

  return {
    // Avanza al cuadro actual. Devuelve la caja en px del video y si el seguimiento sigue válido.
    paso() {
      const f = gris();
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
          for (let y = 0; y < b.h && s < mejor; y += paso) {
            const fi = (oy + y) * W + ox;
            const ti = y * b.w;
            for (let x = 0; x < b.w; x += paso) s += Math.abs(f[fi + x] - plantilla[ti + x]);
          }
          if (s < mejor) {
            mejor = s;
            bx = ox;
            by = oy;
          }
        }
      }
      if (mejor / (muestras * 255) <= OK) {
        b = { ...b, x: bx, y: by };
        const nuevo = recortar(f, b);
        for (let i = 0; i < plantilla.length; i++) plantilla[i] += (nuevo[i] - plantilla[i]) * MEZCLA;
        perdidos = 0;
      } else {
        perdidos++;
      }
      return { x: b.x / k, y: b.y / k, w: b.w / k, h: b.h / k, ok: perdidos < MAX_PERDIDOS };
    },
  };
}
