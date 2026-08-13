import * as ort from 'onnxruntime-web';

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

let session = null;
let isProcessing = false;

// Elementos auxiliares persistentes para evitar garbage collection
const modelWidth = 640;
const modelHeight = 640;
const offscreenCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
if (offscreenCanvas) {
  offscreenCanvas.width = modelWidth;
  offscreenCanvas.height = modelHeight;
}
const ctx = offscreenCanvas ? offscreenCanvas.getContext('2d', { willReadFrequently: true }) : null;
const float32Data = new Float32Array(3 * modelWidth * modelHeight);

export async function loadYoloModel(modelPath = 'models/best.onnx') {
  if (session) return session;
  try {
    session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all'
    });
    console.log('✅ Modelo YOLOv8 ONNX cargado exitosamente');
    return session;
  } catch (e) {
    console.error('Error cargando modelo ONNX:', e);
    throw e;
  }
}

export async function detectYoloObjects(videoElement, confidenceThreshold = 0.35) {
  if (!session || !videoElement || videoElement.readyState !== 4 || isProcessing) {
    return [];
  }

  isProcessing = true;

  try {
    ctx.drawImage(videoElement, 0, 0, modelWidth, modelHeight);
    const imageData = ctx.getImageData(0, 0, modelWidth, modelHeight);
    const data = imageData.data;

    // Conversión súper rápida a CHW
    const channelSize = modelWidth * modelHeight;
    for (let i = 0; i < channelSize; i++) {
      const idx = i * 4;
      float32Data[i] = data[idx] / 255.0;                   // Red
      float32Data[i + channelSize] = data[idx + 1] / 255.0; // Green
      float32Data[i + 2 * channelSize] = data[idx + 2] / 255.0; // Blue
    }

    const inputTensor = new ort.Tensor('float32', float32Data, [1, 3, modelHeight, modelWidth]);
    const feeds = { [session.inputNames[0]]: inputTensor };
    const results = await session.run(feeds);
    const output = results[session.outputNames[0]];

    const rawData = output.data;
    const numAnchors = output.dims[2]; // 8400

    const scaleX = videoElement.videoWidth / modelWidth;
    const scaleY = videoElement.videoHeight / modelHeight;

    const boxes = [];

    for (let i = 0; i < numAnchors; i++) {
      let maxScore = 0;
      let maxClassId = -1;

      for (let c = 0; c < LABELS.length; c++) {
        const score = rawData[(4 + c) * numAnchors + i];
        if (score > maxScore) {
          maxScore = score;
          maxClassId = c;
        }
      }

      if (maxScore >= confidenceThreshold) {
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

    return nms(boxes, 0.40);
  } finally {
    isProcessing = false;
  }
}

function nms(boxes, iouThreshold) {
  boxes.sort((a, b) => b.score - a.score);
  const selected = [];

  while (boxes.length > 0) {
    const current = boxes.shift();
    selected.push(current);

    boxes = boxes.filter(box => {
      if (box.class !== current.class) return true;
      const iou = calculateIoU(current.bbox, box.bbox);
      return iou < iouThreshold;
    });
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
