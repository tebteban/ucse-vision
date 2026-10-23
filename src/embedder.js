// Cliente del reconocimiento (CLIP): el modelo corre en clip.worker.js para no trabar la interfaz.
import { crearTrabajador } from './trabajador.js';

const SIZE = 224;

const clip = crearTrabajador(() => new Worker(new URL('./clip.worker.js', import.meta.url), { type: 'module' }), { limiteMs: 15000 });

// Todo local: el modelo y el wasm viajan dentro de la app (public/), sin internet.
export const loadEmbedder = () => clip.iniciar('load', { base: document.baseURI });

// Recorta la región (en px del video) a un cuadrado 224x224 con bordes grises:
// igual para enseñar y para consultar, así las muestras son comparables.
export function cropToCanvas(video, { x, y, w, h }) {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#808080';
  g.fillRect(0, 0, SIZE, SIZE);
  const s = SIZE / Math.max(w, h);
  g.drawImage(video, x, y, w, h, (SIZE - w * s) / 2, (SIZE - h * s) / 2, w * s, h * s);
  return c;
}

export async function embed(canvas) {
  const pixeles = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, SIZE, SIZE).data;
  return clip.llamar('embed', { pixeles, lado: SIZE }, [pixeles.buffer]);
}

export const reconocimientoOcupado = () => clip.ocupado();
export const _matarReconocimiento = () => clip.matar(); // pruebas de tolerancia a fallos
