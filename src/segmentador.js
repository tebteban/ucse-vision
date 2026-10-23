// Cliente del worker de SAM: el cálculo pesado corre fuera del hilo de la interfaz.
const LIMITE_GPU_MS = 30000; // si la GPU no termina de arrancar en este tiempo, se usa la CPU

let worker = null;
let contador = 0;
const pendientes = new Map();
export let dispositivo = ''; // 'webgpu' | 'wasm' una vez cargado

function nuevoWorker() {
  const w = new Worker(new URL('./sam.worker.js', import.meta.url), { type: 'module' });
  w.onmessage = ({ data: { id, resultado, error } }) => {
    const p = pendientes.get(id);
    pendientes.delete(id);
    error ? p.reject(new Error(error)) : p.resolve(resultado);
  };
  return w;
}

function llamar(tipo, args = {}, transfer = []) {
  worker ??= nuevoWorker();
  return new Promise((resolve, reject) => {
    const id = ++contador;
    pendientes.set(id, { resolve, reject });
    worker.postMessage({ id, tipo, ...args }, transfer);
  });
}

async function cargarCon(device, limite) {
  const carga = llamar('load', { base: document.baseURI, device });
  if (!limite) return carga;
  let t;
  try {
    return await Promise.race([carga, new Promise((_, rej) => (t = setTimeout(() => rej(new Error('GPU sin respuesta')), limite)))]);
  } finally {
    clearTimeout(t);
  }
}

let carga;
export function cargarSam() {
  carga ??= (async () => {
    if (navigator.gpu) {
      try {
        await cargarCon('webgpu', LIMITE_GPU_MS);
        return (dispositivo = 'webgpu');
      } catch (e) {
        console.warn('SAM en GPU no disponible, se usa CPU:', e);
        worker.terminate(); // un worker colgado en la GPU no se puede reusar
        worker = null;
        pendientes.clear();
      }
    }
    await cargarCon('wasm');
    return (dispositivo = 'wasm');
  })().catch((e) => {
    carga = null;
    throw e;
  });
  return carga;
}

// Calcula la escena del cuadro actual del video. Devuelve cuánto tardó (ms).
export async function analizarEscena(video) {
  const bitmap = await createImageBitmap(video);
  return llamar('embed', { bitmap }, [bitmap]);
}

// Caja {x,y,w,h} (px del video) del objeto bajo el punto, según la última escena analizada.
export const objetoEn = (x, y) => llamar('decode', { x, y });
