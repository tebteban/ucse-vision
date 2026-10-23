// Embebe datos/fotos/<id>/*, descarta las fotos que no muestran el objeto y escribe src/data/semilla.json.
// Filtro: CLIP "lee" cada foto contra descripciones en texto de todos los objetos y de cosas que no queremos
// (edificios, diagramas, personas...). Queda si su objeto está entre las 15 descripciones más parecidas (hay objetos
// muy parecidos entre sí, como SSD y RAM) y le gana
// a todas las de descarte. El modelo de texto vive en datos/clip (no viaja en la app).
// También deja hojas de contacto en datos/hojas/ para revisar a ojo. Uso: node scripts/construir-semilla.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { env, AutoProcessor, AutoTokenizer, CLIPVisionModelWithProjection, CLIPTextModelWithProjection, RawImage } from '@huggingface/transformers';

const MAX_POR_OBJETO = 24;
const MIN_POR_OBJETO = 8; // por debajo de esto se avisa para buscar más fotos (no se rellena con fotos dudosas)
const RANGO_MAX = 15;
env.allowRemoteModels = false;
env.localModelPath = path.resolve('datos/clip') + path.sep;
const M = 'Xenova/clip-vit-base-patch32';
const [proc, vision, tok, texto] = await Promise.all([
  AutoProcessor.from_pretrained(M),
  CLIPVisionModelWithProjection.from_pretrained(M, { dtype: 'q8' }),
  AutoTokenizer.from_pretrained(M),
  CLIPTextModelWithProjection.from_pretrained(M, { dtype: 'q8' }),
]);

const DESCRIPCION = {
  ram: 'a RAM memory module', cpu: 'a computer processor chip', gpu: 'a graphics card', 'placa-madre': 'a computer motherboard',
  ssd: 'a solid state drive', hdd: 'a hard disk drive', fuente: 'a computer power supply unit', cooler: 'a CPU cooler with a fan',
  mouse: 'a computer mouse', teclado: 'a computer keyboard', webcam: 'a webcam', pendrive: 'a USB flash drive', hdmi: 'an HDMI cable',
  'cable-red': 'an ethernet network cable', router: 'a wifi router', arduino: 'an Arduino board', protoboard: 'a breadboard for electronics',
  resistencia: 'a resistor electronic component', led: 'an LED diode', multimetro: 'a multimeter', monitor: 'a computer monitor',
  notebook: 'a laptop computer', gabinete: 'a desktop computer tower case', impresora: 'a printer', auriculares: 'headphones',
  parlantes: 'computer speakers', microfono: 'a microphone', joystick: 'a game controller', 'cable-usb': 'a USB cable',
  switch: 'a network switch', 'tarjeta-sd': 'an SD memory card', smartphone: 'a smartphone', disquete: 'a floppy disk',
  capacitor: 'a capacitor electronic component', transistor: 'a transistor', potenciometro: 'a potentiometer', servo: 'a small servo motor',
  'sensor-ultrasonico': 'an ultrasonic distance sensor module', lcd: 'an LCD character display module', 'bateria-9v': 'a 9 volt battery',
  soldador: 'a soldering iron', rele: 'a relay module', 'raspberry-pi': 'a Raspberry Pi board',
};
const DESCARTE = ['a building', 'a house', 'a person', 'a group of people', 'a landscape', 'a street', 'a diagram', 'a chart or graph',
  'a screenshot of text', 'source code on a screen', 'a logo', 'a painting', 'a car', 'an animal', 'a room interior', 'a map', 'a product box or packaging'];

const normal = (data) => {
  const v = Array.from(data);
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
};
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

// Mismo preprocesado que la app: cuadrado 224 con bordes grises (src/embedder.js cropToCanvas).
async function embedImagen(file) {
  const buf = await sharp(file).resize(224, 224, { fit: 'contain', background: '#808080' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { image_embeds } = await vision(await proc(new RawImage(new Uint8ClampedArray(buf.data), 224, 224, 3)));
  return normal(image_embeds.data);
}
async function embedTexto(t) {
  const { text_embeds } = await texto(tok([`a photo of ${t}`], { padding: true, truncation: true }));
  return normal(text_embeds.data);
}

const objetos = JSON.parse(await fs.readFile('src/data/catalogo.json', 'utf8'));
const faltan = objetos.filter((o) => !DESCRIPCION[o.id]);
if (faltan.length) throw new Error(`Falta la descripción en inglés de: ${faltan.map((o) => o.id).join(', ')}`);
const textos = { objetos: [], descarte: [] };
for (const o of objetos) textos.objetos.push(await embedTexto(DESCRIPCION[o.id]));
for (const d of DESCARTE) textos.descarte.push(await embedTexto(d));

const muestras = [];
await fs.mkdir('datos/hojas', { recursive: true });
for (const [k, o] of objetos.entries()) {
  const dir = `datos/fotos/${o.id}`;
  const files = (await fs.readdir(dir).catch(() => [])).filter((f) => /\.(jpg|png)$/.test(f));
  if (!files.length) {
    console.log(o.id, 'SIN FOTOS');
    continue;
  }
  const items = [];
  for (const f of files) {
    const v = await embedImagen(path.join(dir, f));
    const simObjetos = textos.objetos.map((t) => dot(v, t));
    const propia = simObjetos[k];
    const rango = simObjetos.filter((s) => s > propia).length; // 0 = es la descripción más parecida
    const peorDescarte = Math.max(...textos.descarte.map((t) => dot(v, t)));
    items.push({ f, v, propia, pasa: rango < RANGO_MAX && propia > peorDescarte });
  }
  const buenos = items.filter((it) => it.pasa);
  if (!buenos.length) {
    console.log(o.id, 'NINGUNA FOTO PASA EL FILTRO');
    continue;
  }
  // entre las que pasan, las más típicas primero (cercanas al centro del grupo)
  const c = buenos[0].v.map((_, i) => buenos.reduce((s, it) => s + it.v[i], 0) / buenos.length);
  buenos.forEach((it) => (it.s = dot(it.v, c)));
  const keep = new Set(buenos.sort((a, b) => b.s - a.s).slice(0, MAX_POR_OBJETO));
  for (const it of keep) muestras.push({ id: o.id, v: it.v.map((x) => +x.toFixed(4)) });

  // hoja de contacto: conservadas primero, descartadas con borde rojo al final
  const T = 130;
  const orden = [...items].sort((a, b) => keep.has(b) - keep.has(a));
  const tiles = await Promise.all(orden.map(async (it, i) => {
    const img = await sharp(path.join(dir, it.f)).resize(T, T, { fit: 'contain', background: '#222' }).extend({ top: 3, bottom: 3, left: 3, right: 3, background: keep.has(it) ? '#222' : '#d33' }).png().toBuffer();
    return { input: img, left: (i % 8) * (T + 6), top: Math.floor(i / 8) * (T + 6) };
  }));
  await sharp({ create: { width: 8 * (T + 6), height: Math.ceil(items.length / 8) * (T + 6), channels: 3, background: '#000' } }).composite(tiles).jpeg().toFile(`datos/hojas/${o.id}.jpg`);
  console.log(o.id, `${keep.size}/${items.length}`, keep.size < MIN_POR_OBJETO ? '(pocas: buscar más fotos)' : '');
}
await fs.writeFile('src/data/semilla.json', JSON.stringify(muestras));
console.log('muestras', muestras.length);
