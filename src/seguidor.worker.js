// Seguimiento del recuadro fuera del hilo de la interfaz: recibe cuadros reducidos y devuelve la caja.
import { aGris, iniciar, paso } from './seguimiento.js';

let estado = null;
let lienzo = null;

function gris(bitmap) {
  if (!lienzo || lienzo.width !== bitmap.width || lienzo.height !== bitmap.height) lienzo = new OffscreenCanvas(bitmap.width, bitmap.height);
  const g = lienzo.getContext('2d', { willReadFrequently: true });
  g.drawImage(bitmap, 0, 0);
  bitmap.close();
  return aGris(g.getImageData(0, 0, lienzo.width, lienzo.height).data, lienzo.width, lienzo.height);
}

const acciones = {
  hola: () => true,
  iniciar({ bitmap, caja }) {
    const W = bitmap.width;
    const H = bitmap.height;
    estado = iniciar(gris(bitmap), W, H, caja);
    return { ...estado.b, ok: true };
  },
  paso({ bitmap }) {
    if (!estado) {
      bitmap.close();
      throw new Error('No hay un objeto fijado');
    }
    paso(estado, gris(bitmap));
    return { ...estado.b, ok: estado.ok };
  },
  soltar() {
    estado = null;
    return true;
  },
};

self.onmessage = async ({ data: { id, tipo, ...args } }) => {
  try {
    self.postMessage({ id, resultado: await acciones[tipo](args) });
  } catch (e) {
    self.postMessage({ id, error: String(e?.message || e) });
  }
};
