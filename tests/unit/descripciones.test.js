import { describe, it, expect, vi, afterEach } from 'vitest';
import { modeloDisponible, describir } from '../../src/descripciones.js';

const responder = (cuerpo, ok = true) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => cuerpo })));
const modelos = (...nombres) => ({ models: nombres.map((name) => ({ name })) });
const ejemplo = { resumen: 'Placa con microcontrolador.', detalle: 'Uno.\nDos.' };
afterEach(() => vi.unstubAllGlobals());

describe('modeloDisponible', () => {
  it('prefiere un modelo chico conocido', async () => {
    responder(modelos('qwen3.5:latest', 'llama3.2:3b', 'qwen2.5:3b'));
    expect(await modeloDisponible()).toBe('qwen2.5:3b');
  });
  it('si no hay preferidos usa el primero que no sea de embeddings', async () => {
    responder(modelos('nomic-embed-text:latest', 'mistral:7b'));
    expect(await modeloDisponible()).toBe('mistral:7b');
  });
  it('null sin modelos de texto, con error o sin Ollama', async () => {
    responder(modelos('nomic-embed-text:latest'));
    expect(await modeloDisponible()).toBeNull();
    responder({}, false);
    expect(await modeloDisponible()).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    expect(await modeloDisponible()).toBeNull();
  });
});

describe('describir', () => {
  it('devuelve resumen y detalle recortados al largo del formulario', async () => {
    responder({ response: JSON.stringify({ resumen: `  ${'a'.repeat(400)} `, detalle: 'Párrafo uno.\nPárrafo dos.' }) });
    const d = await describir('qwen2.5:3b', 'Procesador', 'Informática', ejemplo);
    expect(d.resumen).toHaveLength(300);
    expect(d.detalle).toBe('Párrafo uno.\nPárrafo dos.');
    const pedido = JSON.parse(fetch.mock.calls[0][1].body);
    expect(pedido.model).toBe('qwen2.5:3b');
    expect(pedido.prompt).toContain('Procesador');
    expect(pedido.stream).toBe(false);
  });
  it('rechaza respuestas rotas o incompletas', async () => {
    responder({ response: 'no es json' });
    await expect(describir('m', 'X', 'Informática', ejemplo)).rejects.toThrow();
    responder({ response: JSON.stringify({ resumen: '', detalle: 'algo' }) });
    await expect(describir('m', 'X', 'Informática', ejemplo)).rejects.toThrow(/incompleta/);
    responder({}, false);
    await expect(describir('m', 'X', 'Informática', ejemplo)).rejects.toThrow(/500/);
  });
});
