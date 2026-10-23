// Genera los videos MJPEG que usa la cámara falsa de Chromium en las pruebas (tests/.tmp/<escena>.mjpeg).
// Chromium los reproduce en bucle a 30 cuadros por segundo. Uso: node tests/fixtures/generar.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const W = 1280;
const H = 720;
const FPS = 30;
const SALIDA = path.resolve('tests/.tmp');
const ARDUINO = path.resolve('tests/fixtures/arduino.jpg');

// Fondo tipo escritorio con ruido de sensor distinto en cada cuadro (±3 niveles), como una webcam real.
const base = Buffer.alloc(W * H * 3);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    const veta = 8 * Math.sin(x / 37 + Math.sin(y / 53) * 2); // vetas suaves para que no sea un color plano
    base[i] = 196 + veta;
    base[i + 1] = 190 + veta;
    base[i + 2] = 180 + veta;
  }
}
function fondoConRuido() {
  const b = Buffer.from(base);
  for (let i = 0; i < b.length; i++) b[i] = Math.max(0, Math.min(255, b[i] + ((Math.random() * 7) | 0) - 3));
  return b;
}

const arduino = await sharp(ARDUINO).resize({ height: 380 }).toBuffer({ resolveWithObject: true });

// Objeto sintético que no está en el catálogo, para enseñarlo en vivo.
const nuevo = await sharp(Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">
  <rect x="10" y="40" width="280" height="220" rx="40" fill="#7c3aed"/>
  <circle cx="90" cy="120" r="34" fill="#facc15"/><circle cx="210" cy="120" r="34" fill="#facc15"/>
  <circle cx="150" cy="200" r="34" fill="#22c55e"/>
  <rect x="120" y="10" width="60" height="40" rx="10" fill="#0f172a"/>
</svg>`)).png().toBuffer({ resolveWithObject: true });

const ESCENAS = {
  // [segundos, función que devuelve los objetos del cuadro t]
  quieto: [5, () => [{ img: arduino, x: (W - arduino.info.width) / 2, y: 170 }]],
  // movimiento suave: ±70 px horizontal y ±20 px vertical, período de 4 s (el bucle de 8 s empalma sin salto)
  movil: [8, (t) => [{ img: arduino, x: (W - arduino.info.width) / 2 + 70 * Math.sin((2 * Math.PI * t) / 4), y: 170 + 20 * Math.cos((2 * Math.PI * t) / 4) }]],
  nuevo: [5, () => [{ img: nuevo, x: (W - 300) / 2, y: 210 }]],
  vacio: [3, () => []],
};

await fs.mkdir(SALIDA, { recursive: true });
for (const [nombre, [segundos, objetos]] of Object.entries(ESCENAS)) {
  const cuadros = [];
  for (let f = 0; f < segundos * FPS; f++) {
    const capas = objetos(f / FPS).map((o) => ({ input: o.img.data, left: Math.round(o.x), top: Math.round(o.y) }));
    cuadros.push(await sharp(fondoConRuido(), { raw: { width: W, height: H, channels: 3 } }).composite(capas).jpeg({ quality: 80 }).toBuffer());
  }
  const archivo = path.join(SALIDA, `${nombre}.mjpeg`);
  await fs.writeFile(archivo, Buffer.concat(cuadros));
  console.log(nombre, cuadros.length, 'cuadros', ((await fs.stat(archivo)).size / 1e6).toFixed(1), 'MB');
}
