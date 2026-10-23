import catalogo from './data/catalogo.json';
import semilla from './data/semilla.json';

const KEY = 'ucse-vision-library-v2';
const KEY_V1 = 'ucse-vision-library-v1'; // formato anterior: catálogo y muestras base guardados junto con lo propio
export const baseIds = new Set(catalogo.map((o) => o.id));

// Lo que se guarda es solo lo propio: las fichas creadas en Enseñar, las muestras capturadas con la cámara
// y qué objetos del catálogo dejaron de usar sus muestras base. Catálogo y muestras base vienen con el programa.
const vacia = () => ({ objetos: [], muestras: [], sinBase: [] });

const texto = (x, max = 2000) => String(x ?? '').slice(0, max);

// Valida y limpia una biblioteca leída de disco o de un archivo importado (acepta también el formato v1).
export function normalizar(data) {
  if (!Array.isArray(data?.objetos) || !Array.isArray(data?.muestras)) throw new Error('El archivo no es una biblioteca válida');
  const muestras = data.muestras.filter((m) => !m?.s); // en v1, s:1 marcaba las muestras base
  const ok = muestras.every((m) => typeof m.id === 'string' && Array.isArray(m.v) && m.v.length === 512 && m.v.every(Number.isFinite));
  if (!ok) throw new Error('El archivo tiene muestras dañadas');
  const objetos = data.objetos
    .filter((o) => o && typeof o.id === 'string' && !baseIds.has(o.id))
    .map((o) => ({ id: texto(o.id, 80), nombre: texto(o.nombre, 120), categoria: texto(o.categoria || 'Informática', 60), resumen: texto(o.resumen), detalle: texto(o.detalle) }));
  const conocidos = new Set([...baseIds, ...objetos.map((o) => o.id)]);
  return {
    objetos,
    muestras: muestras.filter((m) => conocidos.has(m.id)).map((m) => ({ id: m.id, v: m.v })),
    sinBase: Array.isArray(data.sinBase) ? data.sinBase.filter((id) => baseIds.has(id)) : [],
  };
}

export function loadLibrary() {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(KEY_V1);
    if (raw) return normalizar(JSON.parse(raw));
  } catch {
    /* sin almacenamiento o dato corrupto: arrancamos solo con el catálogo base */
  }
  return vacia();
}

// Devuelve false si no se pudo guardar (almacenamiento lleno o bloqueado); la app avisa sin trabarse.
export function saveLibrary(lib) {
  try {
    localStorage.setItem(KEY, JSON.stringify(lib));
    return true;
  } catch {
    return false;
  }
}

// Biblioteca con la que se trabaja: catálogo + muestras base (salvo las quitadas) + lo propio.
export function efectiva(lib) {
  const sin = new Set(lib.sinBase);
  return { objetos: [...catalogo, ...lib.objetos], muestras: [...semilla.filter((m) => !sin.has(m.id)), ...lib.muestras] };
}

export const soloCategoria = (lib, categoria) => {
  if (!categoria) return lib;
  const objetos = lib.objetos.filter((o) => o.categoria === categoria);
  const ids = new Set(objetos.map((o) => o.id));
  return { objetos, muestras: lib.muestras.filter((m) => ids.has(m.id)) };
};

export const restaurarBase = (lib) => ({ ...lib, sinBase: [] });

// Borra las muestras de un objeto; si el objeto lo creó el usuario, también su ficha.
export function borrarObjeto(lib, id) {
  const muestras = lib.muestras.filter((m) => m.id !== id);
  return baseIds.has(id)
    ? { ...lib, muestras, sinBase: [...new Set([...lib.sinBase, id])] }
    : { ...lib, muestras, objetos: lib.objetos.filter((o) => o.id !== id) };
}

const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

// Puntaje por objeto = promedio de sus 2 muestras más parecidas. Devuelve todos, mejor primero.
// shortcut: fuerza bruta O(muestras), sirve hasta unos miles; luego usar un índice.
export function match(lib, vector) {
  const porObjeto = new Map();
  for (const m of lib.muestras) {
    if (!porObjeto.has(m.id)) porObjeto.set(m.id, []);
    porObjeto.get(m.id).push(dot(m.v, vector));
  }
  return lib.objetos
    .filter((o) => porObjeto.has(o.id))
    .map((o) => {
      const top = porObjeto.get(o.id).sort((a, b) => b - a).slice(0, 2);
      return { objeto: o, score: top.reduce((s, x) => s + x, 0) / top.length };
    })
    .sort((a, b) => b.score - a.score);
}
