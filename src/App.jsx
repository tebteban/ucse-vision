import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, MotionConfig } from 'motion/react';
import {
  Camera, ScanSearch, GraduationCap, LibraryBig, Loader2, Plus, Download, Upload, RotateCcw, Trash2,
  ChevronDown, Aperture, X, Zap, MousePointerClick, LayoutGrid, Cpu, CircuitBoard, HeartPulse, FlaskConical, Cog,
} from 'lucide-react';
import { loadEmbedder, cropToCanvas, embed } from './embedder.js';
import { cargarSam, analizarEscena, objetoEn } from './segmentador.js';
import { crearSeguidor } from './seguidor.js';
import { loadLibrary, saveLibrary, normalizar, match, efectiva, soloCategoria, restaurarBase, borrarObjeto, baseIds } from './library.js';
import { Numero, Anillo, Splash } from './ui.jsx';

const MIN_ARRASTRE = 8; // px de pantalla: menos que esto es un clic, más es un encuadre manual
const RAFAGA = 8;
const CAMBIO_ESCENA = 8; // diferencia media (0-255) a partir de la cual la escena analizada quedó vieja
const CAMBIO_LOCAL = 10; // ídem, pero solo alrededor del punto del clic
const QUIETA = 4; // diferencia entre cuadros seguidos por debajo de la cual la imagen está quieta (ruido de cámara ~1-3)
const REIDENTIFICAR_MS = 2500;
const SPLASH_MIN_MS = 1800;
const CATEGORIAS = [
  ['', 'Todas', LayoutGrid],
  ['Informática', 'Informática', Cpu],
  ['Electrónica', 'Electrónica', CircuitBoard],
];
const PROXIMAMENTE = [
  ['Medicina', HeartPulse],
  ['Química', FlaskConical],
  ['Mecánica', Cog],
];
const TABS = [
  ['identificar', 'Identificar', ScanSearch],
  ['ensenar', 'Enseñar', GraduationCap],
  ['biblioteca', 'Biblioteca', LibraryBig],
];
const SUAVE = [0.22, 1, 0.36, 1];
const teachVacio = { target: null, nombre: '', categoria: 'Informática', resumen: '', detalle: '', muestras: [], miniaturas: [] };

// Miniatura gris 64×36 del video, para medir cuánto cambió la escena.
const miniatura = (() => {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 36;
  const g = c.getContext('2d', { willReadFrequently: true });
  return (video) => {
    g.drawImage(video, 0, 0, 64, 36);
    const d = g.getImageData(0, 0, 64, 36).data;
    return Uint8Array.from({ length: 64 * 36 }, (_, i) => (d[4 * i] + d[4 * i + 1] + d[4 * i + 2]) / 3);
  };
})();
const diferencia = (a, b) => a.reduce((s, x, i) => s + Math.abs(x - b[i]), 0) / a.length;
// Igual, pero en una ventana de la miniatura alrededor de un punto del video (~1/4 del ancho).
const diferenciaLocal = (a, b, { px, py }, v) => {
  const cx = Math.round((px / v.videoWidth) * 64);
  const cy = Math.round((py / v.videoHeight) * 36);
  let s = 0;
  let n = 0;
  for (let y = Math.max(0, cy - 6); y <= Math.min(35, cy + 6); y++) {
    for (let x = Math.max(0, cx - 8); x <= Math.min(63, cx + 8); x++) {
      s += Math.abs(a[y * 64 + x] - b[y * 64 + x]);
      n++;
    }
  }
  return s / n;
};

// Agranda un poco la caja para que el reconocimiento vea algo de contexto.
const conMargen = (b, v) => {
  const m = 0.08 * Math.max(b.w, b.h);
  const x = Math.max(0, b.x - m);
  const y = Math.max(0, b.y - m);
  return { x, y, w: Math.min(v.videoWidth - x, b.w + 2 * m), h: Math.min(v.videoHeight - y, b.h + 2 * m) };
};

const aparecer = {
  oculto: { opacity: 0, y: 10 },
  visible: (i = 0) => ({ opacity: 1, y: 0, transition: { delay: i * 0.06, duration: 0.4, ease: SUAVE } }),
};

export default function App() {
  const videoRef = useRef(null);
  const camRef = useRef(null);
  const dragRef = useRef(null);
  const accionesRef = useRef({}); // el intervalo del análisis necesita la versión vigente de segmentar
  const seguidorRef = useRef(null);
  const cajaRef = useRef(null);
  const escenaRef = useRef({ hay: false, ocupada: false, gris: null, anterior: null, pendiente: null });
  const tabRef = useRef('identificar');
  const identRef = useRef(null);

  const [lib, setLib] = useState(loadLibrary); // solo lo propio; ver library.js
  const [categoria, setCategoria] = useState(''); // '' = todas
  const [umbral, setUmbral] = useState(0.85);
  const [modelo, setModelo] = useState('cargando'); // reconocimiento: cargando | listo | error
  const [sam, setSam] = useState('cargando'); // segmentación: cargando | listo | error
  const [escena, setEscena] = useState('sin'); // sin (aún no hay análisis) | lista
  const [analizando, setAnalizando] = useState(false);
  const [msEscena, setMsEscena] = useState(0);
  const [dispSam, setDispSam] = useState('');
  const [camaras, setCamaras] = useState([]);
  const [camaraId, setCamaraId] = useState('');
  const [camLista, setCamLista] = useState(false);
  const [errorCam, setErrorCam] = useState('');
  const [splashMin, setSplashMin] = useState(true);
  const [dims, setDims] = useState({ w: 16, h: 9 });
  const [caja, setCaja] = useState(null); // {x,y,w,h,perdido} en px del video
  const [fijado, setFijado] = useState(0); // contador: cambia en cada fijado nuevo para repetir la animación
  const [arrastre, setArrastre] = useState(null); // rectángulo en curso, en px de pantalla
  const [buscando, setBuscando] = useState(null); // {x,y} en px de pantalla mientras se segmenta un clic
  const [ondas, setOndas] = useState([]);
  const [flash, setFlash] = useState(0);
  const [aviso, setAviso] = useState('');
  const [busy, setBusy] = useState(false);
  const [inferencia, setInferencia] = useState(0);
  const [tab, setTab] = useState('identificar');
  const [res, setRes] = useState(null); // { ranking, indice }
  const [verMas, setVerMas] = useState(false);
  const [teach, setTeach] = useState(teachVacio);

  const base = useMemo(() => efectiva(lib), [lib]);
  const activa = useMemo(() => soloCategoria(base, categoria), [base, categoria]);

  const update = (next) => {
    setLib(next);
    saveLibrary(next);
  };

  // --- modelos ---
  useEffect(() => {
    const blank = document.createElement('canvas');
    blank.width = blank.height = 224;
    loadEmbedder()
      .then(() => embed(blank)) // la primera inferencia es la lenta: la hacemos antes de la demo
      .then(() => setModelo('listo'))
      .catch(() => setModelo('error'));
    cargarSam()
      .then((d) => {
        setDispSam(d === 'webgpu' ? 'GPU' : 'CPU');
        setSam('listo');
      })
      .catch(() => setSam('error'));
    const t = setTimeout(() => setSplashMin(false), SPLASH_MIN_MS);
    return () => clearTimeout(t);
  }, []);

  // --- cámara ---
  useEffect(() => {
    let stream;
    let cancelado = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: camaraId ? { deviceId: { exact: camaraId }, width: 1280, height: 720 } : { width: 1280, height: 720 },
        });
        if (cancelado) return stream.getTracks().forEach((t) => t.stop());
        videoRef.current.srcObject = stream;
        setErrorCam('');
        setCamLista(true);
        setCamaras((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput'));
      } catch (e) {
        setErrorCam(e.message || 'No se pudo abrir la cámara');
      }
    })();
    return () => {
      cancelado = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [camaraId]);

  // --- seguimiento de la caja ---
  const fijarCaja = (c) => {
    cajaRef.current = c;
    setCaja(c);
  };

  useEffect(() => {
    const id = setInterval(() => {
      const s = seguidorRef.current;
      if (!s || !videoRef.current?.videoWidth) return;
      const r = s.paso();
      const prev = cajaRef.current;
      if (prev && Math.hypot(r.x - prev.x, r.y - prev.y) < 0.5 && prev.perdido === !r.ok) return;
      fijarCaja({ x: r.x, y: r.y, w: r.w, h: r.h, perdido: !r.ok });
    }, 70);
    return () => clearInterval(id);
  }, []);

  // --- análisis de escena en segundo plano (SAM calcula en un worker; el clic luego es rápido) ---
  // Se analiza cuando la imagen cambió y volvió a quedarse quieta, o cuando un clic lo necesita.
  useEffect(() => {
    if (sam !== 'listo') return;
    const e = escenaRef.current;
    const id = setInterval(async () => {
      const v = videoRef.current;
      if (!v?.videoWidth || v.readyState < 2 || e.ocupada) return;
      const ahora = miniatura(v);
      const quieta = e.anterior && diferencia(e.anterior, ahora) <= QUIETA;
      e.anterior = ahora;
      const cambio = !e.hay || diferencia(e.gris, ahora) > CAMBIO_ESCENA;
      if (!e.pendiente && !(cambio && (quieta || !e.hay))) return;
      e.ocupada = true;
      setAnalizando(true);
      const inicio = performance.now();
      try {
        setMsEscena(await analizarEscena(v));
        e.gris = ahora;
        e.hay = true;
        setEscena('lista');
        const p = e.pendiente;
        // el clic se resuelve con esta escena si se analizó después del clic o si la zona no cambió
        if (p && (inicio >= p.desde || diferenciaLocal(ahora, p.gris, p, v) <= CAMBIO_LOCAL)) {
          e.pendiente = null;
          accionesRef.current.segmentar(p.px, p.py);
        }
      } catch {
        setSam('error');
      } finally {
        e.ocupada = false;
        setAnalizando(false);
      }
    }, 500);
    return () => clearInterval(id);
  }, [sam]);

  // --- identificar ---
  const recorte = (c) => cropToCanvas(videoRef.current, conMargen(c, videoRef.current));

  async function identificar(c, silencioso = false) {
    if (modelo !== 'listo') return;
    if (!silencioso) setBusy(true);
    try {
      const t0 = performance.now();
      const ranking = match(activa, await embed(recorte(c)));
      setInferencia(Math.round(performance.now() - t0));
      setRes((r) => (silencioso && r ? { ranking, indice: Math.min(r.indice, ranking.length - 1) } : { ranking, indice: 0 }));
      if (!silencioso) setVerMas(false);
    } finally {
      if (!silencioso) setBusy(false);
    }
  }

  // Fija el objeto: dibuja la caja, empieza a seguirlo y lo identifica.
  function bloquear(c) {
    seguidorRef.current = crearSeguidor(videoRef.current, c);
    fijarCaja({ ...c, perdido: false });
    setFijado((n) => n + 1);
    setBuscando(null);
    setAviso('');
    if (tab === 'identificar') identificar(c);
  }

  // Clic: si la zona del objeto no cambió desde el último análisis, se segmenta al instante.
  function clicEn(px, py, pantalla) {
    setBuscando(pantalla);
    const e = escenaRef.current;
    const v = videoRef.current;
    const ahora = miniatura(v);
    if (e.hay && !e.ocupada && diferenciaLocal(e.gris, ahora, { px, py }, v) <= CAMBIO_LOCAL) return segmentar(px, py);
    e.pendiente = { px, py, gris: ahora, desde: performance.now() };
  }

  async function segmentar(px, py) {
    try {
      const c = await objetoEn(px, py);
      if (c) bloquear(c);
      else {
        setBuscando(null);
        setAviso('No encontré un objeto ahí. Probá arrastrando para encuadrarlo.');
      }
    } catch {
      setBuscando(null);
      setAviso('No se pudo segmentar. Encuadralo arrastrando el mouse.');
    }
  }

  useEffect(() => {
    // los intervalos leen siempre la versión más reciente de estas funciones y del estado
    tabRef.current = tab;
    identRef.current = identificar;
    accionesRef.current = { segmentar };
  });

  // Re-identifica de vez en cuando mientras se sigue el objeto, y al cambiar de categoría.
  useEffect(() => {
    const id = setInterval(() => {
      const c = cajaRef.current;
      if (c && !c.perdido && tabRef.current === 'identificar') identRef.current?.(c, true);
    }, REIDENTIFICAR_MS);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const c = cajaRef.current;
    if (c && !c.perdido && tabRef.current === 'identificar') identRef.current?.(c);
  }, [categoria]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(''), 4500);
    return () => clearTimeout(t);
  }, [aviso]);

  function soltar() {
    seguidorRef.current = null;
    escenaRef.current.pendiente = null;
    fijarCaja(null);
    setBuscando(null);
    setRes(null);
    setAviso('');
  }

  // --- mouse sobre la cámara ---
  const pos = (ev) => {
    const r = camRef.current.getBoundingClientRect();
    return { x: Math.min(Math.max(ev.clientX - r.left, 0), r.width), y: Math.min(Math.max(ev.clientY - r.top, 0), r.height) };
  };
  // pantalla -> video (escalas por eje, por si el contenedor no conserva la proporción)
  const escala = () => ({ kx: videoRef.current.videoWidth / camRef.current.clientWidth, ky: videoRef.current.videoHeight / camRef.current.clientHeight });
  const onDown = (ev) => {
    camRef.current.setPointerCapture(ev.pointerId);
    dragRef.current = pos(ev);
    setArrastre(null);
  };
  const onMove = (ev) => {
    const a = dragRef.current;
    if (!a) return;
    const b = pos(ev);
    if (Math.hypot(b.x - a.x, b.y - a.y) >= MIN_ARRASTRE) setArrastre({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
  };
  const onUp = (ev) => {
    const a = dragRef.current;
    dragRef.current = null;
    setArrastre(null);
    if (!a || !videoRef.current?.videoWidth) return;
    const b = pos(ev);
    const { kx, ky } = escala();
    if (Math.hypot(b.x - a.x, b.y - a.y) < MIN_ARRASTRE) {
      setOndas((o) => [...o, { id: Date.now(), ...b }]);
      if (sam !== 'listo') return setAviso('La selección por clic todavía no está lista. Encuadrá arrastrando el mouse.');
      return clicEn(b.x * kx, b.y * ky, b);
    }
    bloquear({ x: Math.min(a.x, b.x) * kx, y: Math.min(a.y, b.y) * ky, w: Math.abs(a.x - b.x) * kx, h: Math.abs(a.y - b.y) * ky });
  };

  // --- enseñar ---
  async function capturar(n = 1) {
    if (!cajaRef.current || busy) return;
    setBusy(true);
    try {
      for (let i = 0; i < n; i++) {
        const canvas = recorte(cajaRef.current);
        const v = await embed(canvas);
        const mini = canvas.toDataURL('image/jpeg', 0.7);
        setFlash((f) => f + 1);
        setTeach((t) => ({ ...t, muestras: [...t.muestras, v], miniaturas: [...t.miniaturas, mini] }));
        if (i < n - 1) await new Promise((r) => setTimeout(r, 400));
      }
    } finally {
      setBusy(false);
    }
  }

  function guardar() {
    const { target, nombre, resumen, detalle, muestras } = teach;
    let objetos = lib.objetos;
    let id = target?.id;
    if (!id) {
      const slug = nombre.trim().toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'objeto';
      id = base.objetos.some((o) => o.id === slug) ? `${slug}-${Date.now().toString(36)}` : slug;
      objetos = [...objetos, { id, nombre: nombre.trim(), categoria: teach.categoria, resumen: resumen.trim(), detalle: detalle.trim() }];
    }
    update({ ...lib, objetos, muestras: [...lib.muestras, ...muestras.map((v) => ({ id, v }))] });
    setTeach(teachVacio);
    setTab('identificar');
    if (cajaRef.current) identificar(cajaRef.current);
  }

  const puedeGuardar = teach.muestras.length >= 3 && (teach.target || teach.nombre.trim());

  function exportar() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(lib)], { type: 'application/json' }));
    a.download = 'biblioteca-ucse-vision.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importar(e) {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      update(normalizar(JSON.parse(await f.text())));
    } catch (err) {
      alert(err.message);
    }
  }

  function borrar(o) {
    if (confirm(`¿Borrar las muestras de "${o.nombre}"?`)) update(borrarObjeto(lib, o.id));
  }

  const cuentas = base.muestras.reduce((c, m) => ((c[m.id] = (c[m.id] || 0) + 1), c), {});
  const maxCuenta = Math.max(1, ...Object.values(cuentas));
  const actual = res?.ranking[res.indice];
  const reconocido = actual && actual.score >= umbral;
  const etiqueta = !caja ? '' : caja.perdido ? 'Objeto perdido' : busy ? 'Analizando…' : tab !== 'identificar' ? 'Objeto fijado' : actual ? (reconocido ? actual.objeto.nombre : 'No reconocido') : '';
  const splash = splashMin || modelo === 'cargando' || !(camLista || errorCam);
  const pct = (v, total) => `${(v / (total || 1)) * 100}%`;
  const esperandoEscena = analizando || escena === 'sin';
  const nombreCategoria = CATEGORIAS.find(([k]) => k === categoria)[1];

  return (
    <MotionConfig reducedMotion="user">
      <Splash
        visible={splash}
        pasos={[
          ['Modelo de reconocimiento', modelo !== 'cargando'],
          ['Cámara', camLista || !!errorCam],
          ['Modelo de segmentación', sam !== 'cargando'],
        ]}
      />
      <div className="app">
        <header className="nav">
          <div className="brand">
            <span className="logo"><Aperture size={18} aria-hidden="true" /></span>
            <strong>UCSE Vision</strong>
          </div>
          <nav className="cats" aria-label="Categorías">
            {CATEGORIAS.map(([k, n, Icono]) => (
              <button key={n} className={categoria === k ? 'chip on' : 'chip'} aria-pressed={categoria === k} onClick={() => setCategoria(k)}>
                {categoria === k && <motion.span layoutId="chip-ind" className="chip-ind" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />}
                <Icono size={16} aria-hidden="true" />
                <span>{n}</span>
              </button>
            ))}
            <span className="cats-sep" aria-hidden="true" />
            {PROXIMAMENTE.map(([n, Icono]) => (
              <button key={n} className="chip pronto" disabled title="Próximamente">
                <Icono size={16} aria-hidden="true" />
                <span>{n}</span>
              </button>
            ))}
          </nav>
          <div className="estados" role="status" aria-live="polite">
            <span className={`estado ${modelo}`}>
              {modelo === 'cargando' ? <Loader2 size={14} className="giro" aria-hidden="true" /> : <i className="punto" />}
              {modelo === 'cargando' ? 'Cargando modelo' : modelo === 'error' ? 'Error de modelo' : 'Reconocimiento listo'}
            </span>
            <span className={`estado ${sam === 'error' ? 'error' : esperandoEscena || sam === 'cargando' ? 'cargando' : 'listo'}`}>
              {sam === 'cargando' || (sam === 'listo' && esperandoEscena) ? <Loader2 size={14} className="giro" aria-hidden="true" /> : <i className="punto" />}
              {sam === 'error' ? 'Sin selección por clic' : sam === 'cargando' ? 'Cargando selección' : escena === 'sin' ? 'Preparando escena' : analizando ? 'Actualizando escena' : 'Escena lista'}
            </span>
          </div>
        </header>

        <main className="main">
          <section className="visor" aria-label="Cámara">
            <div className="barra">
              <label className="selcam">
                <Camera size={16} aria-hidden="true" />
                <select value={camaraId} onChange={(e) => setCamaraId(e.target.value)} aria-label="Cámara">
                  <option value="">Cámara predeterminada</option>
                  {camaras.map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || `Cámara ${i + 1}`}</option>
                  ))}
                </select>
                <ChevronDown size={16} aria-hidden="true" />
              </label>
              <span className="ayuda">
                <MousePointerClick size={16} aria-hidden="true" />
                {tab === 'ensenar' ? 'Hacé clic en el objeto y capturá muestras' : 'Hacé clic sobre un objeto, o arrastrá para encuadrarlo'}
              </span>
              <AnimatePresence>
                {caja && (
                  <motion.button className="pill sutil" onClick={soltar} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
                    <X size={16} aria-hidden="true" /> Soltar objeto
                  </motion.button>
                )}
              </AnimatePresence>
            </div>

            <div
              className="cam"
              ref={camRef}
              style={{ '--ar': dims.w / dims.h }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
            >
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                onLoadedMetadata={(e) => setDims({ w: e.target.videoWidth, h: e.target.videoHeight })}
              />

              <div className="flotantes" aria-hidden="true">
                <span className="flotante"><i className="vivo" /> En vivo</span>
                <span className="flotante">{TABS.find(([k]) => k === tab)[1]} · {nombreCategoria}</span>
              </div>

              {caja && (
                <motion.div
                  className={caja.perdido ? 'marco perdido' : 'marco'}
                  initial={false}
                  animate={{ left: pct(caja.x, dims.w), top: pct(caja.y, dims.h), width: pct(caja.w, dims.w), height: pct(caja.h, dims.h) }}
                  transition={{ type: 'spring', stiffness: 500, damping: 45, mass: 0.6 }}
                >
                  <motion.div
                    key={fijado}
                    className="marco-interior"
                    initial={{ scale: 1.4, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                  >
                    <span /><span /><span /><span />
                  </motion.div>
                  <AnimatePresence mode="wait">
                    {etiqueta && (
                      <motion.b key={etiqueta} className="rotulo" initial={{ opacity: 0, y: 6, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }}>
                        {busy && <Loader2 size={14} className="giro" aria-hidden="true" />}
                        {etiqueta}
                        {tab === 'identificar' && actual && !busy && !caja.perdido && <em>{Math.round(actual.score * 100)}%</em>}
                      </motion.b>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}

              {arrastre && <div className="arrastre" style={{ left: arrastre.x, top: arrastre.y, width: arrastre.w, height: arrastre.h }} />}

              {ondas.map((o) => (
                <motion.span
                  key={o.id}
                  className="onda"
                  style={{ left: o.x, top: o.y }}
                  initial={{ scale: 0, opacity: 0.9 }}
                  animate={{ scale: 1, opacity: 0 }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                  onAnimationComplete={() => setOndas((l) => l.filter((x) => x.id !== o.id))}
                />
              ))}

              <AnimatePresence>
                {buscando && (
                  <motion.div className="reticula" style={{ left: buscando.x, top: buscando.y }} initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 1.5, opacity: 0 }}>
                    <i />
                  </motion.div>
                )}
              </AnimatePresence>

              {flash > 0 && <motion.div key={flash} className="flash" initial={{ opacity: 0.5 }} animate={{ opacity: 0 }} transition={{ duration: 0.45 }} />}

              <AnimatePresence>
                {(buscando || aviso) && (
                  <motion.div
                    key={aviso || 'buscando'}
                    className="toast"
                    role={aviso ? 'alert' : 'status'}
                    initial={{ opacity: 0, y: 16, x: '-50%' }}
                    animate={{ opacity: 1, y: 0, x: '-50%' }}
                    exit={{ opacity: 0, y: 10, x: '-50%' }}
                  >
                    {aviso || (
                      <>
                        <Loader2 size={16} className="giro" aria-hidden="true" />
                        {esperandoEscena ? `Analizando la escena${msEscena ? ` (~${Math.ceil(msEscena / 1000)} s)` : ''}…` : 'Detectando objeto…'}
                        {esperandoEscena && msEscena > 0 && (
                          <span className="toast-barra"><motion.i key={msEscena} initial={{ width: '0%' }} animate={{ width: '100%' }} transition={{ duration: msEscena / 1000, ease: 'linear' }} /></span>
                        )}
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
              {errorCam && <div className="cam-error">{errorCam}</div>}
            </div>

            <div className="stats">
              {[
                ['Objetos', activa.objetos.length, ''],
                ['Muestras', activa.muestras.length, ''],
                ['Reconocimiento', inferencia, ' ms'],
                ['Escena', msEscena / 1000, ' s', 1, dispSam],
                ['Umbral', Math.round(umbral * 100), '%'],
              ].map(([nombre, valor, suf, dec = 0, marca], i) => (
                <motion.div key={nombre} className="stat" variants={aparecer} initial="oculto" animate="visible" custom={i + 2}>
                  <small>{nombre}</small>
                  <strong>
                    <Numero valor={valor} sufijo={suf} decimales={dec} />
                    {marca && <em className="marca">{marca}</em>}
                  </strong>
                </motion.div>
              ))}
            </div>
          </section>

          <aside className="panel">
            <div className="tabs" role="tablist">
              {TABS.map(([k, n, Icono]) => (
                <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'tab on' : 'tab'} onClick={() => setTab(k)}>
                  {tab === k && <motion.span layoutId="tab-ind" className="tab-ind" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />}
                  <Icono size={16} aria-hidden="true" />
                  <span>{n}</span>
                </button>
              ))}
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={tab}
                className="body"
                role="tabpanel"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22, ease: SUAVE }}
              >
                {tab === 'identificar' && (
                  <>
                    {!activa.muestras.length && <p className="vacio">No hay muestras en esta categoría. Importá una biblioteca o enseñá un objeto para empezar.</p>}
                    {activa.muestras.length > 0 && !res && (
                      <div className="espera">
                        <div className="espera-ico" aria-hidden="true">
                          <i /><i />
                          <ScanSearch size={28} />
                        </div>
                        <h2>Apuntá y hacé clic</h2>
                        <p>Ubicá un objeto frente a la cámara y hacé clic sobre él. El sistema lo recorta, lo sigue y te muestra su ficha.</p>
                        <ol className="pasos-espera">
                          {['Colocá el objeto frente a la cámara', 'Hacé clic sobre él', 'Leé su ficha'].map((t, i) => (
                            <motion.li key={t} variants={aparecer} initial="oculto" animate="visible" custom={i + 1}><span>{i + 1}</span>{t}</motion.li>
                          ))}
                        </ol>
                      </div>
                    )}
                    {res && actual && (
                      <motion.div key={`${actual.objeto.id}-${reconocido}`} className="ficha" role="status" aria-live="polite" initial="oculto" animate="visible">
                        <motion.div className="ficha-cabeza" variants={aparecer} custom={0}>
                          <Anillo valor={actual.score} color={reconocido ? 'var(--ink)' : 'var(--mute)'} />
                          <div>
                            <span className="eyebrow">{reconocido ? actual.objeto.categoria : 'Sin coincidencia'}</span>
                            <h2>{reconocido ? actual.objeto.nombre : 'No reconocido'}</h2>
                          </div>
                        </motion.div>
                        {reconocido ? (
                          <>
                            <motion.p className="lead" variants={aparecer} custom={1}>{actual.objeto.resumen}</motion.p>
                            <AnimatePresence initial={false}>
                              {verMas && (
                                <motion.div className="mas" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: SUAVE }}>
                                  <p>{actual.objeto.detalle}</p>
                                </motion.div>
                              )}
                            </AnimatePresence>
                            <motion.div className="acciones" variants={aparecer} custom={2}>
                              <button className="pill sutil" onClick={() => setVerMas(!verMas)} aria-expanded={verMas}>
                                {verMas ? 'Ver menos' : 'Ver más'}
                                <motion.span animate={{ rotate: verMas ? 180 : 0 }} style={{ display: 'inline-flex' }}><ChevronDown size={16} aria-hidden="true" /></motion.span>
                              </button>
                              <button className="link" onClick={() => { setTeach({ ...teachVacio, target: actual.objeto }); setTab('ensenar'); }}>
                                Mejorar reconocimiento
                              </button>
                            </motion.div>
                          </>
                        ) : (
                          <>
                            <motion.p className="lead" variants={aparecer} custom={1}>No hay un objeto parecido en la biblioteca. Podés enseñárselo ahora, en vivo.</motion.p>
                            <motion.button variants={aparecer} custom={2} className="pill primario" onClick={() => { setTeach({ ...teachVacio, categoria: categoria || 'Informática' }); setTab('ensenar'); }}>
                              <GraduationCap size={16} aria-hidden="true" /> Enseñar este objeto
                            </motion.button>
                          </>
                        )}
                        {res.ranking.length > 1 && (
                          <motion.div className="otros" variants={aparecer} custom={3}>
                            <h3>Candidatos</h3>
                            {res.ranking.slice(0, 4).map((r, i) => (
                              <button key={r.objeto.id} className={i === res.indice ? 'otro on' : 'otro'} onClick={() => { setRes({ ...res, indice: i }); setVerMas(false); }}>
                                <span className="otro-nombre">{r.objeto.nombre}</span>
                                <span className="otro-pct">{Math.round(r.score * 100)}%</span>
                                <span className="otro-barra">
                                  <motion.i initial={{ width: 0 }} animate={{ width: `${Math.max(0, (r.score - 0.5) / 0.5) * 100}%` }} transition={{ delay: 0.25 + i * 0.07, duration: 0.6, ease: SUAVE }} />
                                </span>
                              </button>
                            ))}
                          </motion.div>
                        )}
                      </motion.div>
                    )}
                  </>
                )}

                {tab === 'ensenar' && (
                  <>
                    <div className="ensenar-cabeza">
                      <Anillo
                        valor={Math.min(1, teach.muestras.length / RAFAGA)}
                        color={teach.muestras.length >= 3 ? 'var(--ink)' : 'var(--hair)'}
                        etiqueta="muestras"
                        contenido={<Numero valor={teach.muestras.length} />}
                        tam={80}
                      />
                      <div>
                        <h2>Entrenamiento en vivo</h2>
                        <p>El sistema aprende un objeto nuevo con unas pocas muestras de la cámara, sin reentrenar la red.</p>
                      </div>
                    </div>
                    <label>Objeto
                      <select value={teach.target?.id || ''} onChange={(e) => setTeach({ ...teach, target: base.objetos.find((o) => o.id === e.target.value) || null })}>
                        <option value="">Objeto nuevo</option>
                        {['Informática', 'Electrónica'].map((c) => (
                          <optgroup key={c} label={c}>
                            {base.objetos.filter((o) => o.categoria === c).map((o) => (
                              <option key={o.id} value={o.id}>{o.nombre} ({cuentas[o.id] || 0} muestras)</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </label>
                    <AnimatePresence initial={false}>
                      {!teach.target && (
                        <motion.div className="campos" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                          <label>Nombre<input value={teach.nombre} onChange={(e) => setTeach({ ...teach, nombre: e.target.value })} placeholder="Ej: Sensor de temperatura" /></label>
                          <label>Categoría
                            <select value={teach.categoria} onChange={(e) => setTeach({ ...teach, categoria: e.target.value })}>
                              <option>Informática</option>
                              <option>Electrónica</option>
                            </select>
                          </label>
                          <label>Descripción corta<textarea rows={2} value={teach.resumen} onChange={(e) => setTeach({ ...teach, resumen: e.target.value })} /></label>
                          <label>Información ampliada<textarea rows={3} value={teach.detalle} onChange={(e) => setTeach({ ...teach, detalle: e.target.value })} /></label>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <ol className="pasos">
                      <li className={caja ? 'hecho' : ''}>Hacé clic en el objeto en la cámara</li>
                      <li className={teach.muestras.length >= 3 ? 'hecho' : ''}>Capturá muestras girándolo (mínimo 3)</li>
                    </ol>
                    <div className="fila">
                      <button className="pill sutil" disabled={!caja || busy || modelo !== 'listo'} onClick={() => capturar(1)}><Camera size={16} aria-hidden="true" /> Capturar</button>
                      <button className="pill sutil" disabled={!caja || busy || modelo !== 'listo'} onClick={() => capturar(RAFAGA)}><Zap size={16} aria-hidden="true" /> Ráfaga ×{RAFAGA}</button>
                      {teach.muestras.length > 0 && <button className="link" onClick={() => setTeach({ ...teach, muestras: [], miniaturas: [] })}>Reiniciar</button>}
                    </div>
                    {teach.miniaturas.length > 0 && (
                      <div className="minis">
                        <AnimatePresence>
                          {teach.miniaturas.map((src, i) => (
                            <motion.img key={i} src={src} alt={`Muestra ${i + 1}`} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 22 }} />
                          ))}
                        </AnimatePresence>
                      </div>
                    )}
                    <button className="grande" disabled={!puedeGuardar} onClick={guardar}><Plus size={18} aria-hidden="true" /> Guardar y reconocer</button>
                  </>
                )}

                {tab === 'biblioteca' && (
                  <>
                    <label>Umbral de reconocimiento: {Math.round(umbral * 100)}%
                      <input type="range" min="0.6" max="0.98" step="0.01" value={umbral} onChange={(e) => setUmbral(+e.target.value)} />
                    </label>
                    <div className="fila">
                      <button className="pill sutil" onClick={exportar}><Download size={16} aria-hidden="true" /> Exportar</button>
                      <label className="pill sutil archivo"><Upload size={16} aria-hidden="true" /> Importar<input type="file" accept="application/json" onChange={importar} hidden /></label>
                      <button className="pill sutil" onClick={() => update(restaurarBase(lib))}><RotateCcw size={16} aria-hidden="true" /> Muestras base</button>
                    </div>
                    <div className="tabla" role="table" aria-label="Objetos de la biblioteca">
                      <div className="tabla-cab" role="row"><span role="columnheader">Objeto</span><span role="columnheader">Muestras</span></div>
                      {activa.objetos.length === 0 && <p className="vacio">No hay objetos en esta categoría.</p>}
                      {base.objetos.filter((o) => !categoria || o.categoria === categoria).map((o, i) => (
                        <motion.div key={o.id} className="tabla-fila" role="row" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 20) * 0.02 }}>
                          <span className="tabla-nombre" role="cell">
                            {o.nombre}
                            <small>{o.categoria}{baseIds.has(o.id) ? '' : ' · propio'}</small>
                          </span>
                          <span className="tabla-barra" role="cell"><motion.i initial={{ width: 0 }} animate={{ width: `${((cuentas[o.id] || 0) / maxCuenta) * 100}%` }} transition={{ delay: 0.15 + Math.min(i, 20) * 0.02, duration: 0.5 }} /></span>
                          <span className="cnt" role="cell">{cuentas[o.id] || 0}</span>
                          <button className="icono" onClick={() => borrar(o)} disabled={!cuentas[o.id] && baseIds.has(o.id)} aria-label={`Borrar muestras de ${o.nombre}`}><Trash2 size={16} aria-hidden="true" /></button>
                        </motion.div>
                      ))}
                    </div>
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </aside>
        </main>
      </div>
    </MotionConfig>
  );
}
