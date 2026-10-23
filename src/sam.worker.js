import { env, AutoProcessor, SamModel, RawImage, Tensor } from '@huggingface/transformers';

const MODEL = 'Xenova/slimsam-77-uniform';
const MAX_AREA = 0.6; // una máscara que cubre más que esto es el fondo, no el objeto
const MIN_IOU = 0.5; // confianza mínima que SAM se da a sí mismo para aceptar una máscara
const LADO = 1024; // lado al que SAM reescala la imagen

let processor, model, escena; // escena = { embeddings, original_sizes, reshaped_input_sizes }

// Caja {x,y,w,h} de una máscara binaria de w×h, con su área relativa.
function cajaDeMascara(m, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1, area = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      area++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, area: area / (w * h) };
}

const acciones = {
  // device 'webgpu': encoder (lo pesado) en la GPU en fp32, decoder en CPU. 'wasm': todo en CPU cuantizado.
  // hilos > 1 solo funciona con la página aislada (crossOriginIsolated: SharedArrayBuffer disponible).
  async load({ base, device, hilos = 1 }) {
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.useBrowserCache = false;
    env.localModelPath = new URL('models/clip/', base).href;
    env.backends.onnx.wasm.wasmPaths = new URL('ort/', base).href;
    env.backends.onnx.wasm.numThreads = hilos;
    processor = await AutoProcessor.from_pretrained(MODEL);
    model = await SamModel.from_pretrained(
      MODEL,
      device === 'webgpu'
        ? { dtype: { vision_encoder: 'fp32', prompt_encoder_mask_decoder: 'q8' }, device: { vision_encoder: 'webgpu', prompt_encoder_mask_decoder: 'wasm' } }
        : { dtype: 'q8', device: 'wasm' },
    );
    // la GPU recién falla (o se cuelga) al ejecutar: se prueba acá, con una imagen chica
    const c = new OffscreenCanvas(64, 64);
    c.getContext('2d').fillRect(0, 0, 64, 64);
    await acciones.embed({ bitmap: await createImageBitmap(c) });
    await acciones.decode({ x: 32, y: 32 }); // también se calienta el decodificador: el primer clic real sale rápido
    escena = null;
  },

  // Calcula (lento: segundos) los embeddings de la imagen; los clics posteriores son rápidos.
  async embed({ bitmap }) {
    const t0 = performance.now();
    const c = new OffscreenCanvas(bitmap.width, bitmap.height);
    c.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    const inputs = await processor(await RawImage.fromCanvas(c));
    escena = {
      embeddings: await model.get_image_embeddings(inputs),
      original_sizes: inputs.original_sizes,
      reshaped_input_sizes: inputs.reshaped_input_sizes,
    };
    return Math.round(performance.now() - t0);
  },

  // Segmenta el objeto bajo el punto (px de la imagen embebida) y devuelve su caja, o null.
  async decode({ x, y }) {
    if (!escena) throw new Error('Todavía no hay una escena analizada');
    const [alto, ancho] = escena.original_sizes[0];
    const k = LADO / Math.max(alto, ancho);
    const out = await model({
      ...escena.embeddings,
      input_points: new Tensor('float32', [x * k, y * k], [1, 1, 1, 2]),
      input_labels: new Tensor('int64', [1n], [1, 1, 1]),
    });
    const [masks] = await processor.post_process_masks(out.pred_masks, escena.original_sizes, escena.reshaped_input_sizes);
    const [, n, h, w] = masks.dims;
    const iou = Array.from(out.iou_scores.data);
    const cajas = [...Array(n).keys()].map((i) => {
      const caja = cajaDeMascara(masks.data.subarray(i * h * w, (i + 1) * h * w), w, h);
      return caja && caja.area < MAX_AREA ? { ...caja, iou: iou[i] } : null;
    }).filter(Boolean);
    // un punto da máscaras de parte y de objeto entero: de las confiables, la más grande
    return cajas.filter((c) => c.iou >= MIN_IOU).sort((a, b) => b.area - a.area)[0] ?? cajas.sort((a, b) => b.iou - a.iou)[0] ?? null;
  },
};

self.onmessage = async ({ data: { id, tipo, ...args } }) => {
  try {
    self.postMessage({ id, resultado: await acciones[tipo](args) });
  } catch (e) {
    self.postMessage({ id, error: String(e?.message || e) });
  }
};
