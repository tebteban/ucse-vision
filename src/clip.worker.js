// Reconocimiento (CLIP) fuera del hilo de la interfaz: recibe un recorte de 224×224 y devuelve su vector.
import { env, AutoProcessor, CLIPVisionModelWithProjection, RawImage } from '@huggingface/transformers';

const MODEL = 'Xenova/clip-vit-base-patch32';
let processor, model;

const acciones = {
  async load({ base }) {
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.useBrowserCache = false;
    env.localModelPath = new URL('models/clip/', base).href;
    env.backends.onnx.wasm.wasmPaths = new URL('ort/', base).href;
    env.backends.onnx.wasm.numThreads = 1; // varios hilos se cuelgan con este wasm (y exigen COOP/COEP, que file:// no da)
    [processor, model] = await Promise.all([
      AutoProcessor.from_pretrained(MODEL),
      CLIPVisionModelWithProjection.from_pretrained(MODEL, { dtype: 'q8', device: 'wasm' }),
    ]);
    await acciones.embed({ pixeles: new Uint8ClampedArray(224 * 224 * 4), lado: 224 }); // la primera inferencia es la lenta
  },

  // pixeles: RGBA de un cuadrado de lado×lado. Devuelve el vector normalizado (512 números, 4 decimales).
  async embed({ pixeles, lado }) {
    const { image_embeds } = await model(await processor(new RawImage(pixeles, lado, lado, 4)));
    const v = Array.from(image_embeds.data);
    const n = Math.hypot(...v);
    return v.map((x) => +(x / n).toFixed(4));
  },
};

self.onmessage = async ({ data: { id, tipo, ...args } }) => {
  try {
    self.postMessage({ id, resultado: await acciones[tipo](args) });
  } catch (e) {
    self.postMessage({ id, error: String(e?.message || e) });
  }
};
