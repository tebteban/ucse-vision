import { describe, it, expect, vi, afterEach } from 'vitest';
import { crearTrabajador } from '../../src/trabajador.js';

// Worker falso: responde según "comportamiento" (ok | error | colgado | caer).
function workerFalso(registro, comportamiento) {
  return () => {
    const w = {
      terminado: false,
      postMessage({ id, tipo, ...args }) {
        registro.push(tipo);
        const modo = comportamiento(tipo, args);
        if (modo === 'colgado') return;
        if (modo === 'caer') return setTimeout(() => w.onerror?.({ message: 'se cayó', preventDefault() {} }), 0);
        setTimeout(() => w.onmessage?.({ data: modo === 'error' ? { id, error: 'falló' } : { id, resultado: `${tipo}-ok` } }), 0);
      },
      terminate() {
        w.terminado = true;
      },
    };
    registro.workers = (registro.workers ?? 0) + 1;
    return w;
  };
}

describe('crearTrabajador', () => {
  afterEach(() => vi.useRealTimers());
  it('inicializa y responde pedidos', async () => {
    const reg = [];
    const t = crearTrabajador(workerFalso(reg, () => 'ok'));
    await t.iniciar('load');
    await expect(t.llamar('embed')).resolves.toBe('embed-ok');
    expect([...reg]).toEqual(['load', 'embed']);
  });
  it('propaga errores del worker sin reiniciarlo', async () => {
    const reg = [];
    const t = crearTrabajador(workerFalso(reg, (tipo) => (tipo === 'embed' ? 'error' : 'ok')));
    t.iniciar('load');
    await expect(t.llamar('embed')).rejects.toThrow('falló');
    await expect(t.llamar('decode')).resolves.toBe('decode-ok');
    expect(reg.workers).toBe(1);
  });
  it('un pedido colgado vence, se descarta el worker y el siguiente pedido levanta otro', async () => {
    vi.useFakeTimers();
    const reg = [];
    let colgar = true;
    const alReiniciar = vi.fn();
    const t = crearTrabajador(workerFalso(reg, (tipo) => (tipo === 'embed' && colgar ? 'colgado' : 'ok')), { limiteMs: 1000, alReiniciar });
    t.iniciar('load');
    await vi.advanceTimersByTimeAsync(1);
    const p = t.llamar('embed');
    const r = expect(p).rejects.toThrow(/no respondió/);
    await vi.advanceTimersByTimeAsync(1001);
    await r;
    expect(alReiniciar).toHaveBeenCalledTimes(1);
    colgar = false;
    const q = t.llamar('embed');
    await vi.advanceTimersByTimeAsync(5);
    await expect(q).resolves.toBe('embed-ok');
    expect(reg.workers).toBe(2);
    expect([...reg]).toEqual(['load', 'embed', 'load', 'embed']); // re-inicializó antes de seguir
  });
  it('si el worker se cae, rechaza los pendientes y se recupera', async () => {
    const reg = [];
    let caer = true;
    const t = crearTrabajador(workerFalso(reg, (tipo) => (tipo === 'embed' && caer ? 'caer' : 'ok')));
    t.iniciar('load');
    await expect(t.llamar('embed')).rejects.toThrow(/falló/);
    caer = false;
    await expect(t.llamar('embed')).resolves.toBe('embed-ok');
    expect(reg.workers).toBe(2);
  });
  it('matar() simula una caída', async () => {
    const reg = [];
    const t = crearTrabajador(workerFalso(reg, () => 'ok'));
    await t.iniciar('load');
    t.matar();
    await expect(t.llamar('embed')).resolves.toBe('embed-ok');
    expect(reg.workers).toBe(2);
  });
  it('sin inicializar no acepta pedidos', async () => {
    const t = crearTrabajador(workerFalso([], () => 'ok'));
    await expect(t.llamar('embed')).rejects.toThrow(/no fue inicializado/);
  });
});
