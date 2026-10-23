import { describe, it, expect, beforeEach } from 'vitest';
import catalogo from '../../src/data/catalogo.json';
import semilla from '../../src/data/semilla.json';
import { normalizar, efectiva, soloCategoria, borrarObjeto, restaurarBase, match, loadLibrary, saveLibrary, baseIds } from '../../src/library.js';

const vec = (i) => Array.from({ length: 512 }, (_, k) => (k === i ? 1 : 0));
const vacia = { objetos: [], muestras: [], sinBase: [] };

describe('catálogo', () => {
  it('cada objeto tiene nombre, categoría, descripción corta y larga', () => {
    for (const o of catalogo) {
      expect(o.nombre, o.id).toBeTruthy();
      expect(['Informática', 'Electrónica']).toContain(o.categoria);
      expect(o.resumen.length, o.id).toBeGreaterThan(20);
      expect(o.detalle.split('\n').length, o.id).toBeGreaterThanOrEqual(2);
    }
  });
  it('ids únicos y todas las muestras base apuntan a objetos del catálogo', () => {
    expect(new Set(catalogo.map((o) => o.id)).size).toBe(catalogo.length);
    expect(semilla.every((m) => baseIds.has(m.id) && m.v.length === 512)).toBe(true);
  });
});

describe('normalizar (archivos importados y guardados)', () => {
  it('rechaza lo que no es una biblioteca', () => {
    expect(() => normalizar(null)).toThrow();
    expect(() => normalizar({ objetos: 'x', muestras: [] })).toThrow();
    expect(() => normalizar({ objetos: [], muestras: [{ id: 'a', v: [1, 2] }] })).toThrow(/dañadas/);
    expect(() => normalizar({ objetos: [], muestras: [{ id: 'a', v: Array(512).fill(NaN) }] })).toThrow(/dañadas/);
  });
  it('descarta fichas que pisan objetos del catálogo y muestras de objetos desconocidos', () => {
    const r = normalizar({
      objetos: [{ id: 'ram', nombre: 'trucho' }, { id: 'sensor', nombre: 'Sensor', categoria: 'Electrónica' }],
      muestras: [{ id: 'sensor', v: vec(1) }, { id: 'fantasma', v: vec(2) }, { id: 'ram', v: vec(3) }],
    });
    expect(r.objetos.map((o) => o.id)).toEqual(['sensor']);
    expect(r.muestras.map((m) => m.id).sort()).toEqual(['ram', 'sensor']);
  });
  it('migra el formato v1 (muestras base marcadas con s:1)', () => {
    const r = normalizar({ objetos: catalogo, muestras: [{ id: 'ram', v: vec(0), s: 1 }, { id: 'ram', v: vec(1) }] });
    expect(r.objetos).toEqual([]);
    expect(r.muestras).toHaveLength(1);
    expect(r.sinBase).toEqual([]);
  });
  it('recorta textos enormes', () => {
    const r = normalizar({ objetos: [{ id: 'x', nombre: 'n'.repeat(5000), resumen: 'r'.repeat(9000) }], muestras: [] });
    expect(r.objetos[0].nombre.length).toBe(120);
    expect(r.objetos[0].resumen.length).toBe(2000);
  });
});

describe('biblioteca efectiva', () => {
  it('suma catálogo, muestras base y lo propio', () => {
    const lib = { objetos: [{ id: 'mio', nombre: 'Mío', categoria: 'Informática' }], muestras: [{ id: 'mio', v: vec(5) }], sinBase: [] };
    const e = efectiva(lib);
    expect(e.objetos).toHaveLength(catalogo.length + 1);
    expect(e.muestras).toHaveLength(semilla.length + 1);
  });
  it('borrar un objeto base quita sus muestras base y las propias; restaurar las devuelve', () => {
    let lib = { ...vacia, muestras: [{ id: 'ram', v: vec(1) }] };
    lib = borrarObjeto(lib, 'ram');
    expect(efectiva(lib).muestras.some((m) => m.id === 'ram')).toBe(false);
    expect(efectiva(lib).objetos.some((o) => o.id === 'ram')).toBe(true); // la ficha sigue
    lib = restaurarBase(lib);
    expect(efectiva(lib).muestras.filter((m) => m.id === 'ram').length).toBe(semilla.filter((m) => m.id === 'ram').length);
  });
  it('borrar un objeto propio quita la ficha y sus muestras', () => {
    const lib = borrarObjeto({ objetos: [{ id: 'mio', nombre: 'Mío' }], muestras: [{ id: 'mio', v: vec(1) }], sinBase: [] }, 'mio');
    expect(lib.objetos).toEqual([]);
    expect(lib.muestras).toEqual([]);
  });
  it('filtra por categoría', () => {
    const e = soloCategoria(efectiva(vacia), 'Electrónica');
    expect(e.objetos.every((o) => o.categoria === 'Electrónica')).toBe(true);
    const ids = new Set(e.objetos.map((o) => o.id));
    expect(e.muestras.every((m) => ids.has(m.id))).toBe(true);
    expect(soloCategoria(efectiva(vacia), '').objetos).toHaveLength(catalogo.length);
  });
});

describe('match', () => {
  it('ordena por parecido y promedia las 2 mejores muestras', () => {
    const lib = {
      objetos: [{ id: 'a' }, { id: 'b' }, { id: 'sin-muestras' }],
      muestras: [{ id: 'a', v: vec(0) }, { id: 'a', v: vec(1) }, { id: 'b', v: vec(2) }],
    };
    const q = vec(0);
    const r = match(lib, q);
    expect(r.map((x) => x.objeto.id)).toEqual(['a', 'b']);
    expect(r[0].score).toBeCloseTo(0.5); // (1 + 0) / 2
  });
  it('una muestra base de un objeto se reconoce a sí misma primero', () => {
    const e = efectiva(vacia);
    const m = semilla.find((x) => x.id === 'arduino');
    expect(match(e, m.v)[0].objeto.id).toBe('arduino');
  });
});

describe('guardar y cargar', () => {
  beforeEach(() => {
    const datos = new Map();
    globalThis.localStorage = { getItem: (k) => datos.get(k) ?? null, setItem: (k, v) => datos.set(k, v) };
  });
  it('ida y vuelta', () => {
    const lib = { objetos: [{ id: 'mio', nombre: 'Mío', categoria: 'Electrónica', resumen: 'r', detalle: 'd' }], muestras: [{ id: 'mio', v: vec(3) }], sinBase: ['ram'] };
    expect(saveLibrary(lib)).toBe(true);
    expect(loadLibrary()).toEqual(lib);
  });
  it('almacenamiento lleno: devuelve false sin romper', () => {
    globalThis.localStorage.setItem = () => {
      throw new DOMException('lleno', 'QuotaExceededError');
    };
    expect(saveLibrary(vacia)).toBe(false);
  });
  it('dato guardado corrupto: arranca vacía', () => {
    globalThis.localStorage.setItem('ucse-vision-library-v2', '{no es json');
    expect(loadLibrary()).toEqual(vacia);
  });
});
