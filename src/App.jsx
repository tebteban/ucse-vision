import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, MotionConfig, useSpring, useTransform } from 'motion/react';
import {
  Camera, ScanSearch, GraduationCap, LibraryBig, Loader2, Plus, Download, Upload, RotateCcw, Trash2,
  ChevronDown, Aperture, X, Zap, MousePointerClick, LayoutGrid, Cpu, CircuitBoard, HeartPulse, FlaskConical, Cog, RefreshCw,
} from 'lucide-react';
import { loadEmbedder, cropToCanvas, embed, reconocimientoOcupado, _matarReconocimiento } from './embedder.js';
import { cargarSam, analizarEscena, recortesEn, alCambiarDispositivo, alPerderEscena, _matarSegmentacion, _analizarImagen } from './segmentador.js';
import { elegirRecorte, siguienteRecorte } from './recorte.js';
import { crearSeguidor, soltarSeguidor } from './seguidor.js';
import { diferencia, diferenciaLocal, MINI_W, MINI_H } from './seguimiento.js';
import { loadLibrary, saveLibrary, normalizar, match, efectiva, soloCategoria, restaurarBase, borrarObjeto, baseIds } from './library.js';
import { Numero, Anillo, Splash } from './ui.jsx';

const MIN_ARRASTRE = 8; // px de pantalla: menos que esto es un clic, más es un encuadre manual
const RAFAGA = 8;
const CAMBIO_ESCENA = 8; // diferencia media (0-255) a partir de la cual la escena analizada quedó vieja
const CAMBIO_LOCAL = 10; // ídem, pero solo alrededor del punto del clic
const QUIETA = 4; // diferencia entre cuadros seguidos por debajo de la cual la imagen está quieta (ruido de cámara ~1-3)
const REIDENTIFICAR_MS = 2500;
const SPLASH_MIN_MS = 1800;
const REINTENTO_CAMARA_MS = 2500;
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
const RESORTE = { stiffness: 500, damping: 45, mass: 0.6 };
const teachVacio = { target: null, nombre: '', categoria: 'Informática', resumen: '', detalle: '', muestras: [], miniaturas: [] };
const SIN_RESUMEN = 'Objeto enseñado en vivo con la cámara.';
const SIN_DETALLE = 'Este objeto se agregó a la biblioteca durante una demostración. Podés sumarle más muestras desde Enseñar para mejorar su reconocimiento.';
const MODO_PRUEBA = new URLSearchParams(location.search).has('test');

// Miniatura gris 64×36 del video, para medir cuánto cambió la escena.
const miniatura = (() => {
  const c = document.createElement('canvas');
  c.width = MINI_W;
  c.height = MINI_H;
  const g = c.getContext('2d', { willReadFrequently: true });
  return (video) => {
    g.drawImage(video, 0, 0, MINI_W, MINI_H);
    const d = g.getImageData(0, 0, MINI_W, MINI_H).data;
    return Uint8Array.from({ length: MINI_W * MINI_H }, (_, i) => (d[4 * i] + d[4 * i + 1] + d[4 * i + 2]) / 3);
  };
})();

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

const parrafos = (texto) => texto.split(/\n+/).filter(Boolean);

export default function App() {
  const videoRef = useRef(null);
  const camRef = useRef(null);
  const dragRef = useRef(null);
  const accionesRef = useRef({}); // los intervalos necesitan la versión vigente de estas funciones
  const seguidorRef = useRef(null);
  const cajaRef = useRef(null); // {x,y,w,h,perdido} en px del video; la posición NO vive en el estado de React
  const generacion = useRef(0); // cambia al fijar o soltar: descarta respuestas que llegan tarde
  const escenaRef = useRef({ hay: false, ocupada: false, gris: null, anterior: null, pendiente: null });
  const tabRef = useRef('identificar');
  const avisoRef = useRef(0);
  const segRef = useRef({ enCurso: false, siguiente: null }); // una segmentación a la vez; del resto, solo el último clic

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
  const [estadoCam, setEstadoCam] = useState('iniciando'); // iniciando | activa | desconectada | error
  const [errorCam, setErrorCam] = useState('');
  const [intentoCam, setIntentoCam] = useState(0);
  const [splashMin, setSplashMin] = useState(true);
  const [dims, setDims] = useState({ w: 16, h: 9 });
  const [fijado, setFijado] = useState(null); // {n, perdido} mientras hay un objeto fijado; n cambia en cada fijado
  const [arrastre, setArrastre] = useState(null); // rectángulo en curso, en px de pantalla
  const [buscando, setBuscando] = useState(null); // {x,y} en px de pantalla mientras se segmenta un clic
  const [ondas, setOndas] = useState([]);
  const [flash, setFlash] = useState(0);
  const [aviso, setAviso] = useState('');
  const [busy, setBusy] = useState(false);
  const [falloIdent, setFalloIdent] = useState(false); // la última identificación falló (p. ej. se reinició el worker)
  const [inferencia, setInferencia] = useState(0);
  const [tab, setTab] = useState('identificar');
  const [res, setRes] = useState(null); // { ranking, indice }
  const [verMas, setVerMas] = useState(true);
  const [teach, setTeach] = useState(teachVacio);
  const [porBorrar, setPorBorrar] = useState(null);

  // posición del recuadro en % del video, animada sin pasar por React (sin re-render en cada cuadro)
  const mx = useSpring(0, RESORTE);
  const my = useSpring(0, RESORTE);
  const mw = useSpring(0, RESORTE);
  const mh = useSpring(0, RESORTE);
  const left = useTransform(mx, (v) => `${v}%`);
  const top = useTransform(my, (v) => `${v}%`);
  const width = useTransform(mw, (v) => `${v}%`);
  const height = useTransform(mh, (v) => `${v}%`);

  const base = useMemo(() => efectiva(lib), [lib]);
  const activa = useMemo(() => soloCategoria(base, categoria), [base, categoria]);

  const avisar = useCallback((texto) => {
    avisoRef.current = Date.now();
    setAviso(texto);
  }, []);

  const update = (next) => {
    setLib(next);
    if (!saveLibrary(next)) avisar('No se pudo guardar la biblioteca en esta PC. Exportala como archivo para no perderla.');
  };

  // --- modelos (con reintento manual si fallan) ---
  const cargarModelos = useCallback(() => {
    loadEmbedder()
      .then(() => setModelo('listo'))
      .catch((e) => {
        console.error('Reconocimiento:', e);
        setModelo('error');
      });
    cargarSam()
      .then((d) => {
        setDispSam(d === 'webgpu' ? 'GPU' : 'CPU');
        setSam('listo');
      })
      .catch((e) => {
        console.error('Segmentación:', e);
        setSam('error');
      });
  }, []);

  useEffect(() => {
    alCambiarDispositivo((d) => setDispSam(d === 'webgpu' ? 'GPU' : 'CPU'));
    alPerderEscena(() => {
      escenaRef.current.hay = false;
      setEscena('sin');
    });
    cargarModelos();
    const t = setTimeout(() => setSplashMin(false), SPLASH_MIN_MS);
    return () => clearTimeout(t);
  }, [cargarModelos]);

  // --- cámara: reconexión automática si se desconecta o la usa otro programa ---
  useEffect(() => {
    let stream;
    let cancelado = false;
    let reintento;
    const reintentar = () => {
      clearTimeout(reintento);
      reintento = setTimeout(() => !cancelado && setIntentoCam((n) => n + 1), REINTENTO_CAMARA_MS);
    };
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: camaraId ? { deviceId: { exact: camaraId }, width: 1280, height: 720 } : { width: 1280, height: 720 },
        });
        if (cancelado) return stream.getTracks().forEach((t) => t.stop());
        const [pista] = stream.getVideoTracks();
        pista.addEventListener('ended', () => {
          if (cancelado) return;
          setEstadoCam('desconectada');
          setErrorCam('La cámara se desconectó. Reintentando…');
          reintentar();
        });
        videoRef.current.srcObject = stream;
        escenaRef.current.hay = false; // la escena analizada era de otra imagen
        setEstadoCam('activa');
        setErrorCam('');
        setCamaras((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput'));
      } catch (e) {
        if (cancelado) return;
        if (e.name === 'OverconstrainedError' && camaraId) return setCamaraId(''); // la cámara elegida ya no existe
        setEstadoCam('error');
        setErrorCam(
          e.name === 'NotReadableError' ? 'La cámara está en uso por otro programa. Reintentando…'
          : e.name === 'NotFoundError' ? 'No se encontró ninguna cámara. Conectá una; se detecta sola.'
          : e.name === 'NotAllowedError' ? 'No hay permiso para usar la cámara.'
          : `No se pudo abrir la cámara (${e.message || e.name}). Reintentando…`,
        );
        if (e.name !== 'NotAllowedError') reintentar();
      }
    })();
    return () => {
      cancelado = true;
      clearTimeout(reintento);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [camaraId, intentoCam]);

  // Cámara enchufada o desenchufada: se actualiza la lista y, si no había imagen, se reintenta ya.
  useEffect(() => {
    const md = navigator.mediaDevices;
    const alCambiar = async () => {
      const lista = (await md.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      setCamaras(lista);
      setCamaraId((id) => (id && !lista.some((d) => d.deviceId === id) ? '' : id));
      setEstadoCam((e) => {
        if (e !== 'activa') setIntentoCam((n) => n + 1);
        return e;
      });
    };
    md?.addEventListener('devicechange', alCambiar);
    return () => md?.removeEventListener('devicechange', alCambiar);
  }, []);

  // --- recuadro ---
  const moverMarco = (c, saltar = false) => {
    const v = videoRef.current;
    const pos = [[mx, (c.x / v.videoWidth) * 100], [my, (c.y / v.videoHeight) * 100], [mw, (c.w / v.videoWidth) * 100], [mh, (c.h / v.videoHeight) * 100]];
    for (const [m, val] of pos) (saltar ? m.jump(val) : m.set(val));
  };

  // Seguimiento: un paso por cada cuadro nuevo de la cámara, sin solapar pasos.
  useEffect(() => {
    const v = videoRef.current;
    let id;
    let vivo = true;
    let enCurso = false;
    const cb = () => {
      if (!vivo) return;
      id = v.requestVideoFrameCallback(cb);
      const s = seguidorRef.current;
      if (!s || enCurso || !v.videoWidth) return;
      enCurso = true;
      const gen = generacion.current;
      s.paso()
        .then((r) => {
          if (gen !== generacion.current || !cajaRef.current) return;
          const perdido = !r.ok;
          cajaRef.current = { x: r.x, y: r.y, w: r.w, h: r.h, perdido };
          moverMarco(r);
          setFijado((f) => (f && f.perdido !== perdido ? { ...f, perdido } : f));
        })
        .catch(() => {
          // el worker se reinició: el objeto queda donde estaba, marcado como perdido
          if (gen === generacion.current && cajaRef.current) {
            seguidorRef.current = null;
            cajaRef.current = { ...cajaRef.current, perdido: true };
            setFijado((f) => f && { ...f, perdido: true });
          }
        })
        .finally(() => (enCurso = false));
    };
    id = v.requestVideoFrameCallback(cb);
    return () => {
      vivo = false;
      v.cancelVideoFrameCallback(id);
    };
    // moverMarco solo usa refs y valores animados estables
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- análisis de escena en segundo plano (SAM calcula en un worker; el clic luego es rápido) ---
  // Se analiza cuando la imagen cambió y volvió a quedarse quieta, o cuando un clic lo necesita.
  useEffect(() => {
    if (sam !== 'listo') return;
    const e = escenaRef.current;
    const id = setInterval(async () => {
      const v = videoRef.current;
      if (!v?.videoWidth || v.readyState < 2 || e.ocupada || e.pausada) return;
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
        if (p && (inicio >= p.desde || diferenciaLocal(ahora, p.gris, p.fx, p.fy) <= CAMBIO_LOCAL)) {
          e.pendiente = null;
          accionesRef.current.segmentar(p.px, p.py, p.reintento, p.cajaActual);
        }
      } catch (err) {
        console.error('Análisis de escena:', err);
        e.hay = false; // el worker se reinicia solo; se vuelve a analizar en el próximo ciclo
        if (e.pendiente) {
          e.pendiente = null;
          setBuscando(null);
          accionesRef.current.avisar('La selección por clic tuvo un problema y se reinició. Probá de nuevo.');
        }
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
    if (modelo !== 'listo' || !videoRef.current?.videoWidth) return;
    if (silencioso && reconocimientoOcupado()) return; // no se encolan re-identificaciones
    const gen = generacion.current;
    if (!silencioso) setBusy(true);
    try {
      const t0 = performance.now();
      const vector = await embed(recorte(c));
      if (gen !== generacion.current) return; // se soltó o se fijó otro objeto mientras tanto
      const ranking = match(activa, vector);
      setInferencia(Math.round(performance.now() - t0));
      setFalloIdent(false);
      setRes((r) => (silencioso && r ? { ranking, indice: Math.min(r.indice, Math.max(0, ranking.length - 1)) } : { ranking, indice: 0 }));
      if (!silencioso) setVerMas(true);
    } catch (e) {
      console.error('Reconocimiento:', e);
      if (!silencioso) {
        setFalloIdent(true); // la re-identificación periódica lo vuelve a intentar sola
        avisar('No se pudo reconocer el objeto; se reintenta solo en unos segundos.');
      }
    } finally {
      if (!silencioso) setBusy(false);
    }
  }

  // Fija el objeto: dibuja la caja, empieza a seguirlo y lo identifica.
  async function bloquear(c) {
    const gen = ++generacion.current;
    seguidorRef.current = null;
    cajaRef.current = { ...c, perdido: false };
    moverMarco(c, true);
    setFijado({ n: gen, perdido: false });
    setFalloIdent(false);
    setBuscando(null);
    setAviso('');
    if (tabRef.current === 'identificar') identificar(c);
    try {
      const s = await crearSeguidor(videoRef.current, c);
      if (gen === generacion.current) seguidorRef.current = s;
    } catch (e) {
      console.error('Seguimiento:', e); // el recuadro queda fijo en su lugar
    }
  }

  // Clic: si la zona del objeto no cambió desde el último análisis, se segmenta al instante.
  // Un clic dentro del objeto ya fijado no busca otro objeto: cambia su recorte por el siguiente más chico.
  function clicEn(px, py, pantalla) {
    setBuscando(pantalla);
    const e = escenaRef.current;
    const v = videoRef.current;
    const c = cajaRef.current;
    const cajaActual = c && !c.perdido && px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.h ? c.w * c.h : 0; // px² del recuadro actual
    const ahora = miniatura(v);
    const fx = px / v.videoWidth;
    const fy = py / v.videoHeight;
    if (e.hay && !e.ocupada && diferenciaLocal(e.gris, ahora, fx, fy) <= CAMBIO_LOCAL) return segmentar(px, py, false, cajaActual);
    e.pendiente = { px, py, fx, fy, gris: ahora, desde: performance.now(), cajaActual };
  }

  async function segmentar(px, py, reintento = false, cajaActual = 0) {
    const seg = segRef.current;
    if (seg.enCurso) {
      seg.siguiente = [px, py, reintento, cajaActual]; // clics rápidos: los intermedios se descartan
      return;
    }
    seg.enCurso = true;
    const gen = generacion.current;
    try {
      const v = videoRef.current;
      const candidatos = await recortesEn(px, py);
      const c = cajaActual ? siguienteRecorte(candidatos, cajaActual) : elegirRecorte(candidatos, v.videoWidth, v.videoHeight);
      if (MODO_PRUEBA) window.__ucse.ultimoRecorte = { candidatos, elegido: c, cajaActual, video: [v.videoWidth, v.videoHeight] };
      if (gen !== generacion.current || seg.siguiente) return; // ya hubo otro clic: manda el último
      if (c) {
        bloquear(c);
        if (cajaActual) avisar(c.w * c.h < cajaActual ? 'Recorte más chico. Hacé clic otra vez sobre el objeto para seguir ajustándolo.' : 'Volvió al recorte más grande. Hacé clic otra vez para achicarlo.');
      } else {
        setBuscando(null);
        avisar('No encontré un objeto ahí. Probá arrastrando para encuadrarlo.');
      }
    } catch (e) {
      if (seg.siguiente) return;
      console.error('Segmentación:', e);
      const esc = escenaRef.current;
      esc.hay = false;
      if (!reintento && gen === generacion.current) {
        // típicamente el worker se reinició y perdió la escena: se analiza de nuevo y se reintenta una vez
        const v = videoRef.current;
        esc.pendiente = { px, py, fx: px / v.videoWidth, fy: py / v.videoHeight, gris: miniatura(v), desde: performance.now(), reintento: true, cajaActual };
        return;
      }
      setBuscando(null);
      avisar('No se pudo detectar el objeto. Probá de nuevo o encuadralo arrastrando el mouse.');
    } finally {
      seg.enCurso = false;
      const sig = seg.siguiente;
      seg.siguiente = null;
      if (sig) accionesRef.current.segmentar(...sig);
    }
  }

  useEffect(() => {
    // los intervalos leen siempre la versión más reciente de estas funciones y del estado
    tabRef.current = tab;
    accionesRef.current = { segmentar, identificar, avisar };
  });

  // Re-identifica de vez en cuando mientras se sigue el objeto, y al cambiar de categoría.
  useEffect(() => {
    const id = setInterval(() => {
      const c = cajaRef.current;
      if (c && !c.perdido && tabRef.current === 'identificar') accionesRef.current.identificar(c, true);
    }, REIDENTIFICAR_MS);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const c = cajaRef.current;
    if (c && !c.perdido && tabRef.current === 'identificar') accionesRef.current.identificar(c);
  }, [categoria]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(''), 4500);
    return () => clearTimeout(t);
  }, [aviso]);

  useEffect(() => {
    if (!porBorrar) return;
    const t = setTimeout(() => setPorBorrar(null), 3000);
    return () => clearTimeout(t);
  }, [porBorrar]);

  // Errores no previstos: se registran y se avisa sin cortar la app.
  useEffect(() => {
    const alError = (e) => {
      const msg = String(e.reason?.message ?? e.message ?? e.reason ?? '');
      if (msg.includes('ResizeObserver')) return;
      console.error('Error no previsto:', e.reason ?? e.error ?? e);
      if (Date.now() - avisoRef.current > 5000) avisar('Ocurrió un error inesperado, pero la app sigue funcionando.');
    };
    window.addEventListener('error', alError);
    window.addEventListener('unhandledrejection', alError);
    return () => {
      window.removeEventListener('error', alError);
      window.removeEventListener('unhandledrejection', alError);
    };
  }, [avisar]);

  // Ganchos para las pruebas de tolerancia a fallos (solo con ?test).
  useEffect(() => {
    if (!MODO_PRUEBA) return;
    window.__ucse = {
      matarReconocimiento: _matarReconocimiento,
      matarSegmentacion: _matarSegmentacion,
      // banco de pruebas de recortes: analiza una imagen (url) y devuelve los candidatos para cada punto
      async recortesDeImagen(url, puntos) {
        const e = escenaRef.current;
        e.pausada = true; // que el análisis automático de la cámara no pise la escena de prueba
        while (e.ocupada) await new Promise((r) => setTimeout(r, 50));
        try {
          await _analizarImagen(await createImageBitmap(await (await fetch(url)).blob()));
          const r = [];
          for (const [x, y] of puntos) r.push(await recortesEn(x, y));
          return r;
        } finally {
          e.hay = false; // la escena del worker ya no es la de la cámara
          e.pausada = false;
        }
      },
    };
  }, []);

  function soltar() {
    generacion.current++;
    seguidorRef.current = null;
    cajaRef.current = null;
    escenaRef.current.pendiente = null;
    soltarSeguidor();
    setFijado(null);
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
    if (ev.button !== 0) return;
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
    if (!a || !videoRef.current?.videoWidth || estadoCam !== 'activa') return;
    const b = pos(ev);
    const { kx, ky } = escala();
    if (Math.hypot(b.x - a.x, b.y - a.y) < MIN_ARRASTRE) {
      setOndas((o) => [...o.slice(-4), { id: performance.now(), ...b }]);
      if (sam !== 'listo') return avisar('La selección por clic todavía no está lista. Encuadrá arrastrando el mouse.');
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
        if (!cajaRef.current || !videoRef.current?.videoWidth) break; // se soltó el objeto o se cortó la cámara
        const canvas = recorte(cajaRef.current);
        const mini = canvas.toDataURL('image/jpeg', 0.7);
        const v = await embed(canvas);
        setFlash((f) => f + 1);
        setTeach((t) => ({ ...t, muestras: [...t.muestras, v], miniaturas: [...t.miniaturas, mini] }));
        if (i < n - 1) await new Promise((r) => setTimeout(r, 300));
      }
    } catch (e) {
      console.error('Captura:', e);
      avisar('Se interrumpió la captura de muestras. Las ya tomadas se conservan.');
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
      objetos = [...objetos, { id, nombre: nombre.trim(), categoria: teach.categoria, resumen: resumen.trim() || SIN_RESUMEN, detalle: detalle.trim() || SIN_DETALLE }];
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
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function importar(e) {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      if (f.size > 50e6) throw new Error('El archivo es demasiado grande para ser una biblioteca.');
      const nueva = normalizar(JSON.parse(await f.text()));
      update(nueva);
      const n = nueva.objetos.length;
      const m = nueva.muestras.length;
      avisar(`Biblioteca importada: ${n} ${n === 1 ? 'objeto propio' : 'objetos propios'} y ${m} ${m === 1 ? 'muestra' : 'muestras'}.`);
    } catch (err) {
      avisar(err instanceof SyntaxError ? 'El archivo no es un JSON válido.' : err.message);
    }
  }

  function borrar(o) {
    if (porBorrar !== o.id) return setPorBorrar(o.id);
    setPorBorrar(null);
    update(borrarObjeto(lib, o.id));
  }

  const cuentas = base.muestras.reduce((c, m) => ((c[m.id] = (c[m.id] || 0) + 1), c), {});
  const maxCuenta = Math.max(1, ...Object.values(cuentas));
  const actual = res?.ranking[res.indice];
  const reconocido = actual && actual.score >= umbral;
  const perdido = fijado?.perdido;
  const etiqueta = !fijado ? '' : perdido ? 'Objeto perdido' : busy && !res ? 'Analizando…' : tab !== 'identificar' ? 'Objeto fijado' : actual ? (reconocido ? actual.objeto.nombre : 'No reconocido') : falloIdent ? 'Reintentando…' : 'Analizando…';
  const mostrarResumen = fijado && !perdido && tab === 'identificar' && reconocido;
  const splash = splashMin || modelo === 'cargando' || estadoCam === 'iniciando';
  const esperandoEscena = analizando || escena === 'sin';
  const nombreCategoria = CATEGORIAS.find(([k]) => k === categoria)[1];

  return (
    <MotionConfig reducedMotion="user">
      <Splash
        visible={splash}
        pasos={[
          ['Modelo de reconocimiento', modelo !== 'cargando'],
          ['Cámara', estadoCam !== 'iniciando'],
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
            {modelo === 'error' || sam === 'error' ? (
              <button className="estado error" onClick={() => { setModelo('cargando'); setSam('cargando'); cargarModelos(); }}>
                <RefreshCw size={14} aria-hidden="true" />
                {modelo === 'error' ? 'Error de reconocimiento' : 'Error de selección'} · Reintentar
              </button>
            ) : (
              <>
                <span className={`estado ${modelo}`}>
                  {modelo === 'cargando' ? <Loader2 size={14} className="giro" aria-hidden="true" /> : <i className="punto" />}
                  {modelo === 'cargando' ? 'Cargando modelo' : 'Reconocimiento listo'}
                </span>
                <span className={`estado ${esperandoEscena || sam === 'cargando' ? 'cargando' : 'listo'}`}>
                  {sam === 'cargando' || esperandoEscena ? <Loader2 size={14} className="giro" aria-hidden="true" /> : <i className="punto" />}
                  {sam === 'cargando' ? 'Cargando selección' : escena === 'sin' ? 'Preparando escena' : analizando ? 'Actualizando escena' : 'Escena lista'}
                </span>
              </>
            )}
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
                    <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Cámara ${i + 1}`}</option>
                  ))}
                </select>
                <ChevronDown size={16} aria-hidden="true" />
              </label>
              <span className="ayuda">
                <MousePointerClick size={16} aria-hidden="true" />
                {tab === 'ensenar' ? 'Hacé clic en el objeto (otra vez para ajustar el recorte) y capturá muestras' : 'Hacé clic sobre un objeto (otra vez para ajustar el recorte), o arrastrá para encuadrarlo'}
              </span>
              <AnimatePresence>
                {fijado && (
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
                <span className="flotante"><i className={estadoCam === 'activa' ? 'vivo' : 'vivo apagado'} /> {estadoCam === 'activa' ? 'En vivo' : 'Sin señal'}</span>
                <span className="flotante">{TABS.find(([k]) => k === tab)[1]} · {nombreCategoria}</span>
              </div>

              {fijado && (
                <motion.div className={perdido ? 'marco perdido' : 'marco'} style={{ left, top, width, height }}>
                  <motion.div
                    key={fijado.n}
                    className="marco-interior"
                    initial={{ scale: 1.4, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                  >
                    <span /><span /><span /><span />
                  </motion.div>
                  <AnimatePresence mode="wait">
                    {etiqueta && (
                      <motion.div
                        key={etiqueta}
                        className={mostrarResumen ? 'rotulo con-resumen' : 'rotulo'}
                        initial={{ opacity: 0, y: 6, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.2 }}
                        onPointerDown={(e) => mostrarResumen && e.stopPropagation()}
                        onClick={() => mostrarResumen && setVerMas(true)}
                        title={mostrarResumen ? 'Ver la descripción completa en el panel' : undefined}
                      >
                        <span className="rotulo-cabeza">
                          {(busy || etiqueta === 'Analizando…') && <Loader2 size={14} className="giro" aria-hidden="true" />}
                          <b>{etiqueta}</b>
                          {tab === 'identificar' && actual && !busy && !perdido && <em>{Math.round(actual.score * 100)}%</em>}
                        </span>
                        {mostrarResumen && <span className="rotulo-resumen">{actual.objeto.resumen}</span>}
                      </motion.div>
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
              {estadoCam !== 'activa' && estadoCam !== 'iniciando' && (
                <div className="cam-error" role="alert">
                  <p>{errorCam}</p>
                  <button className="pill secundario" onPointerDown={(e) => e.stopPropagation()} onClick={() => setIntentoCam((n) => n + 1)}>
                    <RefreshCw size={16} aria-hidden="true" /> Reintentar ahora
                  </button>
                </div>
              )}
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
                transition={{ duration: 0.18, ease: SUAVE }}
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
                            <motion.p className="lead" variants={aparecer} custom={1}>{actual.objeto.resumen || SIN_RESUMEN}</motion.p>
                            <motion.div className="acciones" variants={aparecer} custom={2}>
                              <button className="pill sutil" onClick={() => setVerMas(!verMas)} aria-expanded={verMas}>
                                {verMas ? 'Ocultar información' : 'Más información'}
                                <motion.span animate={{ rotate: verMas ? 180 : 0 }} style={{ display: 'inline-flex' }}><ChevronDown size={16} aria-hidden="true" /></motion.span>
                              </button>
                              <button className="link" onClick={() => { setTeach({ ...teachVacio, target: actual.objeto }); setTab('ensenar'); }}>
                                Mejorar reconocimiento
                              </button>
                            </motion.div>
                            <AnimatePresence initial={false}>
                              {verMas && (
                                <motion.div className="mas" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: SUAVE }}>
                                  <div className="mas-caja">
                                    <h3>Más información</h3>
                                    {parrafos(actual.objeto.detalle || SIN_DETALLE).map((p, i) => <p key={i}>{p}</p>)}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
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
                              <button key={r.objeto.id} className={i === res.indice ? 'otro on' : 'otro'} onClick={() => { setRes({ ...res, indice: i }); setVerMas(true); }}>
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
                          <label>Nombre<input value={teach.nombre} maxLength={120} onChange={(e) => setTeach({ ...teach, nombre: e.target.value })} placeholder="Ej: Sensor de temperatura" /></label>
                          <label>Categoría
                            <select value={teach.categoria} onChange={(e) => setTeach({ ...teach, categoria: e.target.value })}>
                              <option>Informática</option>
                              <option>Electrónica</option>
                            </select>
                          </label>
                          <label>Descripción corta<textarea rows={2} maxLength={300} value={teach.resumen} onChange={(e) => setTeach({ ...teach, resumen: e.target.value })} placeholder="Qué es, en una oración." /></label>
                          <label>Descripción larga<textarea rows={4} maxLength={2000} value={teach.detalle} onChange={(e) => setTeach({ ...teach, detalle: e.target.value })} placeholder="Cómo funciona, para qué se usa, datos clave." /></label>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <ol className="pasos">
                      <li className={fijado ? 'hecho' : ''}>Hacé clic en el objeto en la cámara</li>
                      <li className={teach.muestras.length >= 3 ? 'hecho' : ''}>Capturá muestras girándolo (mínimo 3)</li>
                    </ol>
                    <p className="nota">¿El recuadro toma de más? Hacé clic otra vez sobre el objeto para achicarlo, o arrastrá para encuadrarlo a mano.</p>
                    <div className="fila">
                      <button className="pill sutil" disabled={!fijado || busy || modelo !== 'listo'} onClick={() => capturar(1)}><Camera size={16} aria-hidden="true" /> Capturar</button>
                      <button className="pill sutil" disabled={!fijado || busy || modelo !== 'listo'} onClick={() => capturar(RAFAGA)}><Zap size={16} aria-hidden="true" /> Ráfaga ×{RAFAGA}</button>
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
                      <label className="pill sutil archivo"><Upload size={16} aria-hidden="true" /> Importar<input type="file" accept="application/json,.json" onChange={importar} hidden /></label>
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
                          <button
                            className={porBorrar === o.id ? 'icono confirmar' : 'icono'}
                            onClick={() => borrar(o)}
                            disabled={!cuentas[o.id] && baseIds.has(o.id)}
                            aria-label={porBorrar === o.id ? `Confirmar: borrar muestras de ${o.nombre}` : `Borrar muestras de ${o.nombre}`}
                            title={porBorrar === o.id ? 'Tocá de nuevo para confirmar' : 'Borrar muestras'}
                          >
                            {porBorrar === o.id ? '¿Sí?' : <Trash2 size={16} aria-hidden="true" />}
                          </button>
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
