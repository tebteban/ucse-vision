import { describe, it, expect, vi, afterEach } from 'vitest';
import { modeloDisponible, enGPU, describir, nombrar, separarFicha } from '../../src/descripciones.js';

// Respuesta de /api/generate como la manda Ollama: una línea JSON por pedazo de texto. cortes: en cuántos pedazos de
// bytes llega (para probar líneas partidas entre dos pedazos).
function enVivo(texto, cortes = 1) {
  const lineas = texto.match(/.{1,7}/gs).map((t) => JSON.stringify({ response: t, done: false }) + '\n').join('') + JSON.stringify({ response: '', done: true }) + '\n';
  const n = Math.ceil(lineas.length / cortes);
  const pedazos = Array.from({ length: cortes }, (_, i) => lineas.slice(i * n, (i + 1) * n));
  return new Response(new ReadableStream({ start(c) { pedazos.forEach((p) => c.enqueue(new TextEncoder().encode(p))); c.close(); } }));
}
// fetch simulado: cada ruta de Ollama con su respuesta (un objeto JSON, o una función del cuerpo pedido)
const ollama = (rutas) =>
  vi.stubGlobal('fetch', vi.fn(async (url, op = {}) => {
    const r = rutas[url.replace('ollama/api/', '')];
    if (r === undefined) return new Response('no', { status: 404 });
    const v = typeof r === 'function' ? r(JSON.parse(op.body)) : r;
    return v instanceof Response ? v : Response.json(v);
  }));
const modelos = (...nombres) => ({ models: nombres.map((name) => ({ name })) });
const ejemplo = { resumen: 'Placa con microcontrolador.', detalle: 'Uno.\nDos.' };
const FICHA = 'Componente que procesa instrucciones.\n\nPárrafo uno.\n\nPárrafo dos.';
afterEach(() => vi.unstubAllGlobals());

describe('modeloDisponible', () => {
  it('prefiere un modelo chico conocido y averigua si ve imágenes', async () => {
    ollama({ tags: modelos('qwen3.5:latest', 'qwen2.5:3b', 'gemma3:4b'), show: { capabilities: ['completion', 'vision'] } });
    expect(await modeloDisponible()).toEqual({ nombre: 'gemma3:4b', vision: true });
  });
  it('si no hay preferidos usa el primero que no sea de embeddings; sin el dato de visión, solo texto', async () => {
    ollama({ tags: modelos('nomic-embed-text:latest', 'mistral:7b') });
    expect(await modeloDisponible()).toEqual({ nombre: 'mistral:7b', vision: false });
  });
  it('null sin modelos de texto o sin Ollama', async () => {
    ollama({ tags: modelos('nomic-embed-text:latest') });
    expect(await modeloDisponible()).toBeNull();
    ollama({});
    expect(await modeloDisponible()).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    expect(await modeloDisponible()).toBeNull();
  });
});

describe('enGPU', () => {
  it('porcentaje del modelo cargado que está en la GPU', async () => {
    ollama({ ps: { models: [{ name: 'otro', size: 10, size_vram: 0 }, { name: 'gemma3:4b', size: 3000, size_vram: 2100 }] } });
    expect(await enGPU('gemma3:4b')).toBe(70);
  });
  it('null si no está cargado o no hay Ollama', async () => {
    ollama({ ps: { models: [] } });
    expect(await enGPU('gemma3:4b')).toBeNull();
    ollama({});
    expect(await enGPU('gemma3:4b')).toBeNull();
  });
});

describe('separarFicha', () => {
  it('primer bloque: resumen; el resto: detalle en párrafos', () => {
    expect(separarFicha(FICHA)).toEqual({ resumen: 'Componente que procesa instrucciones.', detalle: 'Párrafo uno.\nPárrafo dos.' });
  });
  it('saca numeración, rótulos y negritas, y acepta saltos simples', () => {
    expect(separarFicha('1. **Resumen:** Qué es.\n2. Párrafo uno.\n3. Párrafo dos.')).toEqual({ resumen: 'Qué es.', detalle: 'Párrafo uno.\nPárrafo dos.' });
  });
  it('recorta al largo del formulario y rechaza respuestas incompletas, salvo a medio escribir', () => {
    expect(separarFicha(`${'a'.repeat(400)}\n\nb`).resumen).toHaveLength(300);
    expect(() => separarFicha('Solo una oración.')).toThrow(/incompleta/);
    expect(() => separarFicha('')).toThrow(/incompleta/);
    expect(separarFicha('Solo una ora', true)).toEqual({ resumen: 'Solo una ora', detalle: '' });
  });
});

describe('describir', () => {
  it('pide la ficha por nombre, sin imagen, y la muestra mientras se escribe', async () => {
    ollama({ generate: () => enVivo(FICHA, 3) }); // 3 pedazos: hay líneas JSON partidas al medio
    const parciales = [];
    const f = await describir('qwen2.5:3b', 'Procesador', 'Informática', ejemplo, (p) => parciales.push(p));
    expect(f).toEqual({ resumen: 'Componente que procesa instrucciones.', detalle: 'Párrafo uno.\nPárrafo dos.' });
    expect(parciales.length).toBeGreaterThan(1);
    expect(parciales[0].resumen.length).toBeLessThan(f.resumen.length); // primero llega el principio
    const pedido = JSON.parse(fetch.mock.calls[0][1].body);
    expect(pedido).toMatchObject({ model: 'qwen2.5:3b', stream: true });
    expect(pedido.prompt).toContain('Procesador');
    expect(pedido.images).toBeUndefined();
  });
  it('si Ollama falla, avisa con el error', async () => {
    ollama({});
    await expect(describir('m', 'X', 'Informática', ejemplo)).rejects.toThrow(/404/);
    ollama({ generate: () => new Response(JSON.stringify({ error: 'model not found' }) + '\n') });
    await expect(describir('m', 'X', 'Informática', ejemplo)).rejects.toThrow(/model not found/);
  });
});

describe('nombrar', () => {
  it('nombre y categoría mirando la foto', async () => {
    ollama({ generate: () => enVivo('1. Memoria RAM.\n2. Informática') });
    expect(await nombrar('gemma3:4b', 'QUJD')).toEqual({ nombre: 'Memoria RAM', categoria: 'Informática' });
    expect(JSON.parse(fetch.mock.calls[0][1].body).images).toEqual(['QUJD']);
  });
  it('reconoce la categoría Electrónica', async () => {
    ollama({ generate: () => enVivo('Servomotor\nElectrónica') });
    expect((await nombrar('m', 'x')).categoria).toBe('Electrónica');
  });
  it('si no distingue ningún objeto, falla', async () => {
    ollama({ generate: () => enVivo('NINGUNO') });
    await expect(nombrar('m', 'x')).rejects.toThrow(/no distinguió/);
  });
});
