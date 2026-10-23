import { env, AutoProcessor, CLIPVisionModelWithProjection, RawImage } from '@huggingface/transformers';

// Todo local: el modelo y el wasm viajan dentro de la app (public/), sin internet.
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false;
env.localModelPath = new URL('models/clip/', document.baseURI).href;
env.backends.onnx.wasm.wasmPaths = new URL('ort/', document.baseURI).href;
env.backends.onnx.wasm.numThreads = 1; // varios hilos se cuelgan con este wasm (y exigen COOP/COEP, que file:// no da)

const MODEL = 'Xenova/clip-vit-base-patch32';
const SIZE = 224;

let ready = null;

export function loadEmbedder() {
  ready ??= Promise.all([
    AutoProcessor.from_pretrained(MODEL),
    CLIPVisionModelWithProjection.from_pretrained(MODEL, { dtype: 'q8', device: 'wasm' }),
  ]).catch((e) => {
    ready = null; // permite reintentar
    throw e;
  });
  return ready;
}

// Recorta la región (en px del video) a un cuadrado 224x224 con bordes grises:
// igual para enseñar y para consultar, así las muestras son comparables.
export function cropToCanvas(video, { x, y, w, h }) {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d');
  g.fillStyle = '#808080';
  g.fillRect(0, 0, SIZE, SIZE);
  const s = SIZE / Math.max(w, h);
  g.drawImage(video, x, y, w, h, (SIZE - w * s) / 2, (SIZE - h * s) / 2, w * s, h * s);
  return c;
}

export async function embed(canvas) {
  const [processor, model] = await loadEmbedder();
  const inputs = await processor(await RawImage.fromCanvas(canvas));
  const { image_embeds } = await model(inputs);
  const v = Array.from(image_embeds.data);
  const n = Math.hypot(...v);
  return v.map((x) => +(x / n).toFixed(4));
}
