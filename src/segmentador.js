// Cliente del worker de SAM: el cálculo pesado corre fuera del hilo de la interfaz.
import { crearTrabajador } from './trabajador.js';

const LIMITE_GPU_MS = 30000; // si la GPU no termina de arrancar en este tiempo, se usa la CPU
const FALLOS_GPU_MAX = 2; // caídas del worker en GPU antes de pasar a CPU para el resto de la sesión

export let dispositivo = ''; // 'webgpu' | 'wasm' una vez cargado
let alCambiar = () => {};
export const alCambiarDispositivo = (fn) => (alCambiar = fn);
let alPerder = () => {};
export const alPerderEscena = (fn) => (alPerder = fn); // un worker nuevo no tiene la escena analizada

let fallosGpu = 0;
const sam = crearTrabajador(() => new Worker(new URL('./sam.worker.js', import.meta.url), { type: 'module' }), {
  limiteMs: 60000, // el análisis en CPU de una PC lenta puede tardar decenas de segundos
  alReiniciar: () => {
    alPerder();
    if (dispositivo === 'webgpu' && ++fallosGpu >= FALLOS_GPU_MAX) {
      console.warn('La GPU falló varias veces: la selección por clic sigue en CPU');
      usar('wasm');
    }
  },
});

function usar(device) {
  dispositivo = device;
  alCambiar(device);
  // en CPU, con la página aislada se reparte el cálculo en varios núcleos (dejando dos libres para la interfaz)
  const hilos = device === 'wasm' && self.crossOriginIsolated ? Math.max(1, Math.min(6, navigator.hardwareConcurrency - 2)) : 1;
  return sam.iniciar('load', { base: document.baseURI, device, hilos }, device === 'webgpu' ? LIMITE_GPU_MS : 180000);
}

let carga;
export function cargarSam() {
  carga ??= (async () => {
    // Con la página aislada, la CPU con varios hilos analiza en ~2-3 s sin competir con el video por la GPU
    // (en GPU es más rápido pero congela la imagen mientras calcula). Sin aislamiento, la CPU usaría un solo hilo
    // (~8 s), así que ahí conviene la GPU. ?sam=gpu|cpu fuerza uno u otro.
    const pedido = new URLSearchParams(location.search).get('sam');
    const gpuPrimero = pedido === 'gpu' || (pedido !== 'cpu' && !self.crossOriginIsolated);
    if (navigator.gpu && gpuPrimero) {
      try {
        await usar('webgpu');
        return dispositivo;
      } catch (e) {
        console.warn('SAM en GPU no disponible, se usa CPU:', e);
      }
    }
    await usar('wasm');
    return dispositivo;
  })().catch((e) => {
    carga = null;
    throw e;
  });
  return carga;
}

// Calcula la escena del cuadro actual del video. Devuelve cuánto tardó (ms).
export async function analizarEscena(video) {
  const bitmap = await createImageBitmap(video);
  return sam.llamar('embed', { bitmap }, [bitmap]);
}

// Caja {x,y,w,h} (px del video) del objeto bajo el punto, según la última escena analizada.
export const objetoEn = (x, y) => sam.llamar('decode', { x, y }, [], 15000);

export const _matarSegmentacion = () => sam.matar(); // pruebas de tolerancia a fallos
