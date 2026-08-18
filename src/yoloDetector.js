import * as ort from 'onnxruntime-web';

// Configurar WebAssembly para máxima compatibilidad
ort.env.wasm.numThreads = 1; // Un solo hilo para evitar race conditions
// Dejar que onnxruntime-web resuelva sus propios .wasm automáticamente
// (NO sobreescribir wasmPaths: Vite/Electron lo resuelve correctamente por defecto)

const LABELS = [
  'auriculares',
  'cable_usb',
  'disco_duro',
  'gabinete',
  'impresora',
  'joystick',
  'memoria_ram',
  'microfono',
  'monitor',
  'mouse',
  'parlante',
  'pendrive',
  'procesador',
  'router',
  'teclado',
  'webcam'
];

const MODEL_WIDTH = 640;
const MODEL_HEIGHT = 640;
const CHANNEL_SIZE = MODEL_WIDTH * MODEL_HEIGHT;

let session = null;
let isProcessing = false;
let lastCleanupTime = 0;
const CLEANUP_INTERVAL = 5000; // Limpiar memoria cada 5 segundos

// Canvas offscreen reutilizable
const offscreenCanvas = document.createElement('canvas');
offscreenCanvas.width = MODEL_WIDTH;
offscreenCanvas.height = MODEL_HEIGHT;
const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true });

// Buffer de datos reutilizable
const float32Data = new Float32Array(3 * CHANNEL_SIZE);

export async function loadYoloModel(modelPath = 'models/best.onnx') {
  if (session) return session;

  try {
    session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all'
    });
    console.log('✅ Modelo YOLOv8 ONNX cargado exitosamente en modo WASM ultra-estable');
    return session;
  } catch (e) {
    console.error('Error cargando modelo ONNX:', e);
    throw e;
  }
}

export async function detectYoloObjects(videoElement, confidenceThreshold = 0.5) {
  if (!session || !videoElement || videoElement.readyState !== 4 || isProcessing) {
    return [];
  }

  isProcessing = true;

  try {
    // Dibujar frame en canvas offscreen
    ctx.drawImage(videoElement, 0, 0, MODEL_WIDTH, MODEL_HEIGHT);
    const imageData = ctx.getImageData(0, 0, MODEL_WIDTH, MODEL_HEIGHT);
    const data = imageData.data;

    // Conversión a formato CHW (Channel-Height-Width)
    for (let i = 0; i < CHANNEL_SIZE; i++) {
      const idx = i * 4;
      float32Data[i] = data[idx] / 255.0;                    // Red
      float32Data[i + CHANNEL_SIZE] = data[idx + 1] / 255.0; // Green
      float32Data[i + 2 * CHANNEL_SIZE] = data[idx + 2] / 255.0; // Blue
    }

    const inputTensor = new ort.Tensor('float32', float32Data, [1, 3, MODEL_HEIGHT, MODEL_WIDTH]);
    const feeds = { [session.inputNames[0]]: inputTensor };
    
    const results = await session.run(feeds);
    const output = results[session.outputNames[0]];

    const rawData = output.data;
    const numAnchors = output.dims[2]; // 8400 o similar

    const scaleX = videoElement.videoWidth / MODEL_WIDTH;
    const scaleY = videoElement.videoHeight / MODEL_HEIGHT;

    const boxes = [];

    for (let i = 0; i < numAnchors; i++) {
      let maxScore = 0;
      let maxClassId = -1;

      // Encontrar la clase con mayor confianza
      for (let c = 0; c < LABELS.length; c++) {
        const score = rawData[(4 + c) * numAnchors + i];
        if (score > maxScore) {
          maxScore = score;
          maxClassId = c;
        }
      }

      if (maxScore >= confidenceThreshold && maxClassId >= 0) {
        const cx = rawData[0 * numAnchors + i];
        const cy = rawData[1 * numAnchors + i];
        const w = rawData[2 * numAnchors + i];
        const h = rawData[3 * numAnchors + i];

        const x = (cx - w / 2) * scaleX;
        const y = (cy - h / 2) * scaleY;
        const width = w * scaleX;
        const height = h * scaleY;

        boxes.push({
          class: LABELS[maxClassId],
          score: maxScore,
          bbox: [x, y, width, height]
        });
      }
    }

    // Limpiar memoria
    if (inputTensor.dispose) inputTensor.dispose();
    if (output.dispose) output.dispose();
    
    // Cleanup periódico
    const now = Date.now();
    if (now - lastCleanupTime > CLEANUP_INTERVAL) {
      lastCleanupTime = now;
      if (typeof globalThis !== 'undefined' && typeof globalThis.gc === 'function') {
        globalThis.gc();
      }
    }

    return nms(boxes, 0.40);
  } catch (err) {
    console.error('Error durante inferencia YOLO:', err);
    return [];
  } finally {
    isProcessing = false;
  }
}

function nms(boxes, iouThreshold) {
  if (boxes.length === 0) return boxes;

  // Ordenar por score descendente
  boxes.sort((a, b) => b.score - a.score);

  const selected = [];
  const active = new Array(boxes.length).fill(true);

  for (let i = 0; i < boxes.length; i++) {
    if (!active[i]) continue;

    selected.push(boxes[i]);
    const currentBox = boxes[i];

    // NMS clásico: suprime cualquier box (de cualquier clase) que se solape
    // fuertemente con la seleccionada, sin importar la clase.
    for (let j = i + 1; j < boxes.length; j++) {
      if (!active[j]) continue;

      const iou = calculateIoU(currentBox.bbox, boxes[j].bbox);
      if (iou > iouThreshold) {
        active[j] = false;
      }
    }
  }

  return selected;
}

function calculateIoU(boxA, boxB) {
  const [xA, yA, wA, hA] = boxA;
  const [xB, yB, wB, hB] = boxB;

  const x1 = Math.max(xA, xB);
  const y1 = Math.max(yA, yB);
  const x2 = Math.min(xA + wA, xB + wB);
  const y2 = Math.min(yA + hA, yB + hB);

  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = wA * hA;
  const areaB = wB * hB;

  const union = areaA + areaB - intersection;
  return union === 0 ? 0 : intersection / union;
}

