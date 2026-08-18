import { useRef, useState, useEffect, useCallback } from 'react';
import { loadYoloModel, detectYoloObjects } from './yoloDetector';

const DICCIONARIO = {
  'auriculares': 'Auriculares',
  'cable_usb': 'Cable USB',
  'disco_duro': 'Disco Duro',
  'gabinete': 'Gabinete',
  'impresora': 'Impresora',
  'joystick': 'Joystick',
  'memoria_ram': 'Memoria RAM',
  'microfono': 'Micrófono',
  'monitor': 'Monitor',
  'mouse': 'Mouse',
  'parlante': 'Parlante',
  'pendrive': 'Pendrive',
  'procesador': 'Procesador',
  'router': 'Router',
  'teclado': 'Teclado',
  'webcam': 'Webcam'
};

const ICONOS_OBJETO = {
  'auriculares': '🎧',
  'cable_usb': '🔌',
  'disco_duro': '💽',
  'gabinete': '🖥️',
  'impresora': '🖨️',
  'joystick': '🎮',
  'memoria_ram': '💾',
  'microfono': '🎙️',
  'monitor': '📺',
  'mouse': '🖱️',
  'parlante': '🔊',
  'pendrive': '🏷️',
  'procesador': '🔲',
  'router': '📡',
  'teclado': '⌨️',
  'webcam': '📷'
};

const OBJETOS_BUSCADOS = Object.keys(DICCIONARIO);
const FRAMES_PARA_VALIDAR = 2; // Requiere 2 frames seguidos (~0.12s) para escaneo rápido
const FRAMES_PARA_PENALIZAR = 2; // 2 frames sosteniendo tarjeta incorrecta (~0.24s a ~8 FPS)
const PENALTY_COOLDOWN_MS = 2500; // Cooldown entre penalizaciones
const PENALTY_POINTS = 500; // Puntos que se restan por tarjeta incorrecta
const OPCIONES_TIEMPO = [60, 90, 120]; // Opciones de tiempo total de partida
const RANKING_KEY = 'ucse-vision-ranking';
const LEGENDARY_EVERY = 5;
const LEGENDARY_SECONDS = 10;
// Decay exponencial de puntaje: 5s de gracia, luego mitad del valor cada 8s, mínimo 100pts
const SCORE_GRACE_SECONDS = 5;
const SCORE_HALF_LIFE_SECONDS = 8;
const SCORE_MIN_POINTS = 100;

const formatScore = (score) => String(score).padStart(7, '0');

// Anima un número hacia su valor target (efecto "tragamonedas") usando rAF.
// Solo corre mientras dura la transición, no deja nada en loop.
function useAnimatedNumber(target, duration = 350) {
  const [display, setDisplay] = useState(target);
  const rafRef = useRef(null);
  const fromRef = useRef(target);

  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return undefined;
    const start = performance.now();

    const animate = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (target - from) * eased));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        fromRef.current = target;
      }
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => rafRef.current && cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return display;
}

// Cuenta de 0 al valor target una sola vez al montar (para el score final de Game Over)
function useCountUp(target, duration = 1200) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    let rafId;
    const start = performance.now();

    const animate = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(target * eased));
      if (t < 1) rafId = requestAnimationFrame(animate);
    };

    rafId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return display;
}

function ParticleField() {
  return <div className="arcade-particles" aria-hidden="true" />;
}

function CornerBrackets() {
  return (
    <>
      <div className="corner-bracket corner-tl" aria-hidden="true" />
      <div className="corner-bracket corner-tr" aria-hidden="true" />
      <div className="corner-bracket corner-bl" aria-hidden="true" />
      <div className="corner-bracket corner-br" aria-hidden="true" />
    </>
  );
}

function CRTOverlay() {
  return <div className="crt-overlay" aria-hidden="true" />;
}

function PixelEmoji({ emoji, size = 64, resolution = 16 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, resolution, resolution);
    ctx.font = `${resolution - 2}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, resolution / 2, resolution / 2 + 1);
  }, [emoji, resolution]);

  return (
    <canvas
      ref={canvasRef}
      width={resolution}
      height={resolution}
      className="pixel-emoji"
      style={{
        width: size,
        height: size,
      }}
    />
  );
}

const leerRanking = () => {
  try {
    const raw = localStorage.getItem(RANKING_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.error('No se pudo leer el ranking local:', error);
    return [];
  }
};

function TrainingCaptureView({ onBack }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [selectedClass, setSelectedClass] = useState(OBJETOS_BUSCADOS[0]);
  const [counts, setCounts] = useState(() => {
    const initial = {};
    OBJETOS_BUSCADOS.forEach((c) => { initial[c] = 0; });
    return initial;
  });
  const [flash, setFlash] = useState(false);
  const [recentImages, setRecentImages] = useState([]);

  useEffect(() => {
    let streamTrack = null;
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' }
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          streamTrack = stream;
        }
      } catch (err) {
        alert('No se pudo acceder a la cámara: ' + err.message);
      }
    };

    startCamera();

    return () => {
      if (streamTrack) {
        streamTrack.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const capturePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    setFlash(true);
    setTimeout(() => setFlash(false), 150);

    const timestamp = Date.now();
    const filename = `${selectedClass}_${timestamp}.png`;

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      setCounts((prev) => ({ ...prev, [selectedClass]: (prev[selectedClass] || 0) + 1 }));

      // Guardar preview usando object URL en lugar de dataURL (libera memoria al desmontar)
      setRecentImages((prev) => {
        const newEntry = { url, key: `${selectedClass}-${timestamp}` };
        // Limpiar los object URLs anteriores para evitar memory leak
        const trimmed = prev.slice(0, 7);
        trimmed.forEach((img) => URL.revokeObjectURL(img.url));
        return [newEntry, ...trimmed];
      });
    }, 'image/png');
  };

  useEffect(() => {
    const handleKey = (e) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        capturePhoto();
      }
      if (e.code === 'ArrowDown' || e.code === 'ArrowRight') {
        e.preventDefault();
        setSelectedClass((curr) => {
          const idx = OBJETOS_BUSCADOS.indexOf(curr);
          return OBJETOS_BUSCADOS[(idx + 1) % OBJETOS_BUSCADOS.length];
        });
      }
      if (e.code === 'ArrowUp' || e.code === 'ArrowLeft') {
        e.preventDefault();
        setSelectedClass((curr) => {
          const idx = OBJETOS_BUSCADOS.indexOf(curr);
          return OBJETOS_BUSCADOS[(idx - 1 + OBJETOS_BUSCADOS.length) % OBJETOS_BUSCADOS.length];
        });
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="app-shell" style={{ overflowY: 'auto', maxHeight: '100vh', padding: '1.2rem' }}>
      <header className="app-header" style={{ justifyContent: 'space-between' }}>
        <button
          type="button"
          onClick={onBack}
          style={{
            background: 'rgba(0,255,245,0.15)',
            border: '2px solid var(--neon-cyan)',
            color: 'var(--neon-cyan)',
            fontFamily: 'var(--font-arcade)',
            fontSize: '0.75rem',
            padding: '0.6rem 1rem',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          ◀ VOLVER AL JUEGO
        </button>
        <div style={{ textAlign: 'center' }}>
          <h1 className="glitch-text" data-text="CAPTURA IA" style={{ fontSize: '1.2rem' }}>CAPTURA DE ENTRENAMIENTO</h1>
          <p style={{ fontFamily: 'var(--font-arcade)', fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            ESPACIO / ENTER PARA CAPTURAR • FLECHAS PARA CAMBIAR CLASE
          </p>
        </div>
        <div className="producer-badge" style={{ margin: 0, padding: '0.4rem 0.8rem' }}>
          <span>PRODUCIDO POR</span>
          <strong>ESTEBAN CEJAS</strong>
        </div>
      </header>

      <main style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1.5rem', flex: 1 }}>
        <section className="arcade-frame" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ position: 'relative', width: '100%', aspectRatio: '4/3', background: '#000', borderRadius: '6px', overflow: 'hidden' }}>
            <video ref={videoRef} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <canvas ref={canvasRef} style={{ display: 'none' }} />
            {flash && (
              <div style={{ position: 'absolute', inset: 0, background: '#fff', opacity: 0.8, pointerEvents: 'none' }} />
            )}
          </div>

          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <label className="input-group" style={{ flex: 1, margin: 0 }}>
              <span>CLASE SELECCIONADA</span>
              <select
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value)}
                style={{ fontFamily: 'var(--font-arcade)', fontSize: '0.8rem', padding: '0.7rem' }}
              >
                {OBJETOS_BUSCADOS.map((c) => (
                  <option key={c} value={c}>
                    {ICONOS_OBJETO[c]} {DICCIONARIO[c].toUpperCase()}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              className="start-button"
              onClick={capturePhoto}
              style={{ padding: '0.8rem 1.4rem', fontSize: '0.85rem' }}
            >
              📸 CAPTURAR ({counts[selectedClass] || 0})
            </button>
          </div>

          <div>
            <span className="mini-label" style={{ marginBottom: '0.5rem', display: 'block' }}>ÚLTIMAS CAPTURAS</span>
            <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
              {recentImages.length === 0 ? (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-arcade)' }}>
                  Aún no hay capturas guardadas.
                </span>
              ) : (
                recentImages.map((img) => (
                  <img
                    key={img.key}
                    src={img.url}
                    alt="Captura reciente"
                    style={{ width: '70px', height: '55px', objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--neon-cyan)' }}
                  />
                ))
              )}
            </div>
          </div>
        </section>

        <aside className="arcade-frame" style={{ padding: '1rem', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--neon-cyan)', paddingBottom: '0.5rem' }}>
            <span style={{ fontFamily: 'var(--font-arcade)', fontSize: '0.9rem', color: 'var(--neon-cyan)' }}>PROGRESO TOTAL</span>
            <strong style={{ fontFamily: 'var(--font-arcade)', fontSize: '1.2rem', color: 'var(--neon-yellow)' }}>{total} FOTOS</strong>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            {OBJETOS_BUSCADOS.map((c) => {
              const num = counts[c] || 0;
              const isSelected = selectedClass === c;
              return (
                <div
                  key={c}
                  onClick={() => setSelectedClass(c)}
                  style={{
                    padding: '0.6rem',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    background: isSelected ? 'rgba(0,255,245,0.2)' : 'rgba(0,0,0,0.4)',
                    border: isSelected ? '2px solid var(--neon-cyan)' : '1px solid rgba(255,255,255,0.1)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontFamily: 'var(--font-arcade)',
                    fontSize: '0.65rem'
                  }}
                >
                  <span>{ICONOS_OBJETO[c]} {DICCIONARIO[c]}</span>
                  <strong style={{ color: num >= 15 ? 'var(--neon-green)' : num > 0 ? 'var(--neon-yellow)' : 'var(--text-muted)' }}>
                    {num}
                  </strong>
                </div>
              );
            })}
          </div>
        </aside>
      </main>
    </div>
  );
}

function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const [model, setModel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [gameStarted, setGameStarted] = useState(false);
  const [gameEnded, setGameEnded] = useState(false);
  const [showCaptureTool, setShowCaptureTool] = useState(false);
  const [playerName, setPlayerName] = useState('');
  const [setupName, setSetupName] = useState('');
  const [timePerObject, setTimePerObject] = useState(OPCIONES_TIEMPO[0]);
  const [timeLeft, setTimeLeft] = useState(OPCIONES_TIEMPO[0]);
  const [sessionTime, setSessionTime] = useState(0);
  const [puntos, setPuntos] = useState(0);
  const [objetoActual, setObjetoActual] = useState(OBJETOS_BUSCADOS[0]);
  const [progresoEscaneo, setProgresoEscaneo] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [ranking, setRanking] = useState(() => leerRanking());
  const [comboCount, setComboCount] = useState(0);
  const [comboActive, setComboActive] = useState(false);
  const [legendaryMode, setLegendaryMode] = useState(false);
  const [legendaryObject, setLegendaryObject] = useState(null);
  const [legendaryTimeLeft, setLegendaryTimeLeft] = useState(0);
  const [objectsFound, setObjectsFound] = useState(0);
  const [aciertoFlash, setAciertoFlash] = useState(null); // { texto, legendary, key } o null
  const [penaltyFlash, setPenaltyFlash] = useState(null); // { key } o null
  const [scorePop, setScorePop] = useState(null); // { texto, penalty, key } o null
  const [scoreBump, setScoreBump] = useState(''); // 'score-bump' | 'score-drop' | ''
  const [powerOnActive, setPowerOnActive] = useState(false); // 8. CRT power-on
  const aciertoTimerRef = useRef(null);
  const penaltyTimerRef = useRef(null);
  const scorePopTimerRef = useRef(null);
  const scoreBumpTimerRef = useRef(null);

  const frameCountRef = useRef(0);
  const wrongFrameCountRef = useRef(0); // Frames sosteniendo tarjeta incorrecta
  const lastWrongClassRef = useRef(null); // Última clase incorrecta detectada
  const lastPenaltyTimeRef = useRef(0); // Cooldown entre penalizaciones
  const objetoActualRef = useRef(OBJETOS_BUSCADOS[0]);
  const audioCtxRef = useRef(null);
  const lastSuccessAtRef = useRef(0);
  const comboCountRef = useRef(0);
  const comboTimerRef = useRef(null);
  const scanToneCooldownRef = useRef(0);
  const comboActiveRef = useRef(false);
  const legendaryModeRef = useRef(false);
  const legendaryObjectRef = useRef(null);
  const objectsFoundRef = useRef(0);
  const puntosRef = useRef(0);
  const sessionTimeRef = useRef(0);
  const playerNameRef = useRef('');
  const gameEndedRef = useRef(false);
  const lastHitTimeRef = useRef(0);
  const streamRef = useRef(null);
  const detectLoopRunningRef = useRef(false);
  const statusTimerRef = useRef(null);
  const statusQueueRef = useRef([]);
  const timeLeftRef = useRef(OPCIONES_TIEMPO[0]);
  const legendaryTimeLeftRef = useRef(0);
  // Contador monotónico para keys de React: evita duplicados cuando dos
  // flashes se disparan sincrónicamente con el mismo Date.now()
  const flashKeyCounterRef = useRef(0);
  const nextFlashKey = () => { flashKeyCounterRef.current += 1; return flashKeyCounterRef.current; };
  // Momento en que se asignó el objeto actual (para decay de puntaje)
  const objectStartTimeRef = useRef(Date.now());

  // Número de puntos animado tipo "tragamonedas" para el HUD del juego (efecto 3)
  const puntosAnimados = useAnimatedNumber(puntos, 350);
  // Conteo ascendente del puntaje final en Game Over (efecto 13)
  const puntajeAnimado = useCountUp(puntos, 1200);

  // Puntaje potencial en tiempo real (decay exponencial tras gracia de 5s)
  const [potentialScore, setPotentialScore] = useState(1000);

  // Calcula los puntos reales en base al tiempo transcurrido desde que se asignó el objeto
  const calcPotentialScore = (basePoints = 1000) => {
    const elapsedSec = (Date.now() - objectStartTimeRef.current) / 1000;
    if (elapsedSec <= SCORE_GRACE_SECONDS) return basePoints;
    const decaySec = elapsedSec - SCORE_GRACE_SECONDS;
    return Math.max(SCORE_MIN_POINTS, Math.round(basePoints * Math.pow(0.5, decaySec / SCORE_HALF_LIFE_SECONDS)));
  };

  // Mantener refs sincronizados para que finalizarPartida, el loop de detección
  // y el interval del timer siempre vean los valores más recientes sin cierres viejos
  useEffect(() => { objetoActualRef.current = objetoActual; }, [objetoActual]);
  useEffect(() => { legendaryObjectRef.current = legendaryObject; }, [legendaryObject]);
  useEffect(() => { puntosRef.current = puntos; }, [puntos]);
  useEffect(() => { sessionTimeRef.current = sessionTime; }, [sessionTime]);
  useEffect(() => { playerNameRef.current = playerName; }, [playerName]);
  useEffect(() => { gameEndedRef.current = gameEnded; }, [gameEnded]);
  useEffect(() => { timeLeftRef.current = timeLeft; }, [timeLeft]);
  useEffect(() => { legendaryTimeLeftRef.current = legendaryTimeLeft; }, [legendaryTimeLeft]);

  // Actualizar puntaje potencial cada 200ms mientras el juego está activo
  useEffect(() => {
    if (!gameStarted || gameEnded) return undefined;
    const interval = setInterval(() => {
      // Base: legendario = 5000, normal = 1000
      const base = legendaryModeRef.current ? 5000 : 1000;
      setPotentialScore(calcPotentialScore(base));
    }, 200);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameStarted, gameEnded]);

  // Efecto 8: dispara la animación de "power-on" tipo CRT al arrancar la partida
  useEffect(() => {
    if (gameStarted && !gameEnded) {
      setPowerOnActive(true);
      const t = setTimeout(() => setPowerOnActive(false), 550);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [gameStarted, gameEnded]);

  const getAudioContext = () => {
    if (typeof window === 'undefined') {
      return null;
    }

    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) {
      return null;
    }

    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioCtor();
    }

    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }

    return audioCtxRef.current;
  };

  const playTone = useCallback((frequency, duration = 0.08, type = 'sine', volume = 0.04) => {
    const audioCtx = getAudioContext();
    if (!audioCtx) {
      return;
    }

    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.type = type;
    oscillator.frequency.value = frequency;

    gainNode.gain.value = volume;
    gainNode.gain.setValueAtTime(volume, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + duration);
  }, []);

  const playScanTone = () => {
    const now = Date.now();
    if (now - scanToneCooldownRef.current < 120) {
      return;
    }

    scanToneCooldownRef.current = now;
    playTone(620, 0.05, 'square', 0.03);
  };

  const playSuccessTone = useCallback(() => {
    playTone(880, 0.08, 'triangle', 0.05);
    setTimeout(() => playTone(1180, 0.1, 'triangle', 0.05), 90);
  }, [playTone]);

  const playErrorBuzzer = useCallback(() => {
    playTone(200, 0.15, 'sawtooth', 0.06);
    setTimeout(() => playTone(150, 0.2, 'sawtooth', 0.06), 100);
  }, [playTone]);

  // Sistema de mensajes con cola y auto-clear.
  // Cada mensaje se muestra 1.6s; si llega otro antes, se encola.
  // Solo se ve el primero; cuando se libera el slot, sale el siguiente.
  const flashStatus = useCallback((message, durationMs = 1600) => {
    if (!message) return;
    statusQueueRef.current.push({ message, durationMs });
    if (statusTimerRef.current) return; // Ya hay uno en pantalla

    const showNext = () => {
      const next = statusQueueRef.current.shift();
      if (!next) {
        statusTimerRef.current = null;
        setStatusMessage('');
        return;
      }
      setStatusMessage(next.message);
      statusTimerRef.current = setTimeout(() => {
        statusTimerRef.current = null;
        if (statusQueueRef.current.length === 0) {
          setStatusMessage('');
        } else {
          showNext();
        }
      }, next.durationMs);
    };
    showNext();
  }, []);

  // Flash grande de acierto sobre la cámara (visual, complementario al statusMessage)
  const triggerAciertoFlash = useCallback((texto, legendary = false) => {
    if (aciertoTimerRef.current) {
      clearTimeout(aciertoTimerRef.current);
    }
    const key = nextFlashKey();
    setAciertoFlash({ texto, legendary, key });
    aciertoTimerRef.current = setTimeout(() => {
      setAciertoFlash(null);
      aciertoTimerRef.current = null;
    }, 700);
  }, []);

  // Flash rojo de penalización + texto
  const triggerPenaltyFlash = useCallback((texto) => {
    if (penaltyTimerRef.current) {
      clearTimeout(penaltyTimerRef.current);
    }
    const key = nextFlashKey();
    setPenaltyFlash({ key });
    penaltyTimerRef.current = setTimeout(() => {
      setPenaltyFlash(null);
      penaltyTimerRef.current = null;
    }, 500);
    // Texto de puntos perdidos
    triggerScorePop(texto, true);
  }, []);

  // Pop-up flotante de puntos ganados/perdidos
  const triggerScorePop = useCallback((texto, penalty = false) => {
    if (scorePopTimerRef.current) {
      clearTimeout(scorePopTimerRef.current);
    }
    const key = nextFlashKey();
    setScorePop({ texto, penalty, key });
    scorePopTimerRef.current = setTimeout(() => {
      setScorePop(null);
      scorePopTimerRef.current = null;
    }, 800);
  }, []);

  // Animación de bump en el marcador
  const triggerScoreBump = useCallback((type = 'score-bump') => {
    if (scoreBumpTimerRef.current) {
      clearTimeout(scoreBumpTimerRef.current);
    }
    setScoreBump(type);
    scoreBumpTimerRef.current = setTimeout(() => {
      setScoreBump('');
      scoreBumpTimerRef.current = null;
    }, 300);
  }, []);

  const guardarRanking = (nombre, puntajeActual, tiempoTotal) => {
    if (!nombre || !nombre.trim()) return;

    const rankingPrevio = leerRanking();
    const nombreLimpio = nombre.trim();
    
    // Verificar si el jugador ya existe en el ranking
    const indexExistente = rankingPrevio.findIndex(
      (e) => e.name.toLowerCase() === nombreLimpio.toLowerCase()
    );

    let siguienteRanking = [...rankingPrevio];

    if (indexExistente !== -1) {
      // Si ya existe y obtuvo mejor puntaje, actualizar su registro
      if (puntajeActual > siguienteRanking[indexExistente].points) {
        siguienteRanking[indexExistente] = {
          name: nombreLimpio,
          points: puntajeActual,
          time: tiempoTotal
        };
      }
    } else {
      // Si es un jugador nuevo, agregar su entrada
      siguienteRanking.push({
        name: nombreLimpio,
        points: puntajeActual,
        time: tiempoTotal
      });
    }

    // Ordenar por puntaje descendente y menor tiempo
    siguienteRanking = siguienteRanking
      .sort((a, b) => b.points - a.points || a.time - b.time)
      .slice(0, 10);

    localStorage.setItem(RANKING_KEY, JSON.stringify(siguienteRanking));
    setRanking(siguienteRanking);
  };

  const borrarRankingCompleto = () => {
    localStorage.removeItem(RANKING_KEY);
    setRanking([]);
  };

  const finalizarPartida = useCallback((motivo = '¡Partida terminada!') => {
    if (gameEndedRef.current) {
      return;
    }

    const nombreFinal = playerNameRef.current || 'Jugador';
    guardarRanking(nombreFinal, puntosRef.current, sessionTimeRef.current);

    gameEndedRef.current = true;
    setGameEnded(true);
    setGameStarted(false);
    setStatusMessage(motivo); // En game-over el mensaje es permanente, no en cola
    setLegendaryMode(false);
    legendaryModeRef.current = false;
    setLegendaryObject(null);
    legendaryObjectRef.current = null;

    // Liberar cámara y stream de forma segura
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!loading) return;
    const loadModel = async () => {
      try {
        const loadedModel = await loadYoloModel('models/best.onnx');
        setModel(loadedModel);
        setLoading(false);
      } catch (error) {
        console.error('Error al cargar el modelo YOLOv8 ONNX:', error);
        setLoadError(error?.message || 'Error desconocido al cargar el modelo.');
        setLoading(false);
      }
    };

    loadModel();
  }, [loading]);

  useEffect(() => {
    if (!gameStarted || gameEnded) {
      return undefined;
    }

    // Si ya hay un stream vivo, no reiniciar (evita fugas y doble cámara)
    if (streamRef.current && streamRef.current.getTracks().some((t) => t.readyState === 'live')) {
      return undefined;
    }

    let cancelled = false;

    const iniciarCamara = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setStatusMessage('Tu navegador no admite acceso a la cámara.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' }
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        if (!videoRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      } catch (err) {
        console.error('Error al acceder a la cámara:', err);
        setStatusMessage('No se pudo acceder a la cámara. Revisá el permiso del navegador.');
      }
    };

    iniciarCamara();

    return () => {
      cancelled = true;
    };
  }, [gameStarted, gameEnded]);

  useEffect(() => {
    if (!gameStarted || gameEnded) {
      return undefined;
    }

    const interval = setInterval(() => {
      // Si el juego ya terminó (por finalizarPartida), no hacer nada
      if (gameEndedRef.current) {
        return;
      }

      // 1) Tiempo total de sesión (acumulativo)
      setSessionTime((current) => current + 1);

      // 2) Tiempo global restante de la partida
      const currentTimeLeft = timeLeftRef.current;
      if (currentTimeLeft <= 1) {
        playSuccessTone();
        finalizarPartida(`¡Tiempo completado! Lograste escanear ${objectsFoundRef.current} objetos 🎉`);
        return;
      }
      setTimeLeft(currentTimeLeft - 1);

      // 3) Timer del objeto legendario
      if (legendaryModeRef.current) {
        const currentLeg = legendaryTimeLeftRef.current;
        if (currentLeg <= 1) {
          legendaryModeRef.current = false;
          setLegendaryMode(false);
          setLegendaryObject(null);
          legendaryObjectRef.current = null;
          flashStatus('¡El objeto legendario ha desaparecido!', 1800);

          // Volver a un objeto normal sin restar puntos ni terminar partida
          let nuevoObjeto;
          do {
            nuevoObjeto = OBJETOS_BUSCADOS[Math.floor(Math.random() * OBJETOS_BUSCADOS.length)];
          } while (nuevoObjeto === objetoActualRef.current);
          setObjetoActual(nuevoObjeto);
        } else {
          setLegendaryTimeLeft(currentLeg - 1);
        }
      }
    }, 1000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameStarted, gameEnded, timePerObject]);

  const registrarRacha = () => {
    const now = Date.now();
    const windowMs = 5000;
    const dentroDeVentana = now - lastSuccessAtRef.current < windowMs;
    const nextCombo = dentroDeVentana ? comboCountRef.current + 1 : 1;

    comboCountRef.current = nextCombo;
    setComboCount(nextCombo);

    const isComboActive = nextCombo >= 2; // Racha activa desde 2 aciertos
    comboActiveRef.current = isComboActive;
    setComboActive(isComboActive);

    lastSuccessAtRef.current = now;

    if (comboTimerRef.current) {
      clearTimeout(comboTimerRef.current);
    }

    comboTimerRef.current = setTimeout(() => {
      comboCountRef.current = 0;
      setComboCount(0);
      comboActiveRef.current = false;
      setComboActive(false);
    }, windowMs);

    return isComboActive;
  };

  // Penalización por tarjeta incorrecta
  const manejarPenalizacion = (claseIncorrecta) => {
    const now = Date.now();
    if (now - lastPenaltyTimeRef.current < PENALTY_COOLDOWN_MS) return;
    lastPenaltyTimeRef.current = now;

    // Restar puntos (mínimo 0)
    setPuntos((prev) => Math.max(0, prev - PENALTY_POINTS));

    // Romper combo
    comboCountRef.current = 0;
    setComboCount(0);
    comboActiveRef.current = false;
    setComboActive(false);
    if (comboTimerRef.current) {
      clearTimeout(comboTimerRef.current);
    }

    const nombreIncorrecto = DICCIONARIO[claseIncorrecta] || claseIncorrecta;
    playErrorBuzzer();
    triggerPenaltyFlash(`-${PENALTY_POINTS}`);
    triggerScoreBump('score-drop');
    flashStatus(`¡INCORRECTO! ${nombreIncorrecto} ≠ objetivo (-${PENALTY_POINTS} pts) ❌`, 2000);

    // Reset wrong frame counter
    wrongFrameCountRef.current = 0;
    lastWrongClassRef.current = null;
  };

  const avanzarObjeto = (puntosBase = 1000, mensaje = '') => {
    frameCountRef.current = 0;
    wrongFrameCountRef.current = 0;
    lastWrongClassRef.current = null;
    setProgresoEscaneo(0);

    // Aplicar decay exponencial al puntaje base
    const puntosDecay = calcPotentialScore(puntosBase);
    const multiplicador = comboActiveRef.current ? 2 : 1;
    const puntajeReal = puntosDecay * multiplicador;

    setPuntos((prev) => prev + puntajeReal);
    triggerScorePop(`+${puntajeReal}`);
    triggerScoreBump('score-bump');

    if (mensaje) {
      // Reemplazar el valor de puntos en el mensaje con el real calculado
      const mensajeReal = mensaje.replace(/\d\.000|\d+\.\d+/g, (m) => {
        const base = parseInt(m.replace('.', ''), 10);
        const decayed = calcPotentialScore(base);
        return decayed.toLocaleString('es-AR');
      });
      flashStatus(mensajeReal);
    }

    // Resetear timer para el próximo objeto
    objectStartTimeRef.current = Date.now();
    setPotentialScore(puntosBase === 5000 ? 5000 : 1000);

    let nuevoObjeto;
    do {
      nuevoObjeto = OBJETOS_BUSCADOS[Math.floor(Math.random() * OBJETOS_BUSCADOS.length)];
    } while (nuevoObjeto === objetoActualRef.current);

    setObjetoActual(nuevoObjeto);
  };

  const manejarAcierto = () => {
    const now = Date.now();
    // Cooldown de 1200ms (1.2 segundos) para garantizar CERO doble aciertos seguidos
    if (now - lastHitTimeRef.current < 1200) {
      return;
    }
    lastHitTimeRef.current = now;

    frameCountRef.current = 0;
    setProgresoEscaneo(0);

    // Si estábamos en modo legendario, completar y salir de modo legendario
    if (legendaryModeRef.current) {
      legendaryModeRef.current = false;
      setLegendaryMode(false);
      setLegendaryObject(null);
      legendaryObjectRef.current = null;
      setLegendaryTimeLeft(0);

      const encontradosLeg = objectsFoundRef.current + 1;
      objectsFoundRef.current = encontradosLeg;
      setObjectsFound(encontradosLeg);

      playSuccessTone();
      const fueCombo = registrarRacha();
      const mensaje = fueCombo
        ? `¡LEGENDARIO! +10.000 pts (x2 🔥)`
        : '¡OBJETO LEGENDARIO ENCONTRADO! ✨ (+5.000 pts)';
      triggerAciertoFlash('¡LEGENDARIO!', true);
      avanzarObjeto(5000, mensaje);
      return;
    }

    const siguienteObjetosEncontrados = objectsFoundRef.current + 1;
    objectsFoundRef.current = siguienteObjetosEncontrados;
    setObjectsFound(siguienteObjetosEncontrados);

    const isLegendary = siguienteObjetosEncontrados > 0 && siguienteObjetosEncontrados % LEGENDARY_EVERY === 0;
    if (isLegendary) {
      const opcionesDisponibles = OBJETOS_BUSCADOS.filter((item) => item !== objetoActualRef.current);
      const siguienteLegendario = opcionesDisponibles[Math.floor(Math.random() * opcionesDisponibles.length)] || OBJETOS_BUSCADOS[0];

      legendaryObjectRef.current = siguienteLegendario;
      setLegendaryObject(siguienteLegendario);
      legendaryModeRef.current = true;
      setLegendaryMode(true);
      setLegendaryTimeLeft(LEGENDARY_SECONDS);
      flashStatus(`¡MODO LEGENDARIO (10s)! Busca ${DICCIONARIO[siguienteLegendario]} ✨`, 2500);
      setObjetoActual(siguienteLegendario);
      playSuccessTone();
      return;
    }

    playSuccessTone();
    const fueCombo = registrarRacha();
    const mensaje = fueCombo
      ? `¡Racha x2! 🔥 +2.000 pts`
      : '¡Objetivo encontrado! +1.000 pts';
    triggerAciertoFlash(fueCombo ? '¡COMBO!' : '¡BIEN!', false);
    avanzarObjeto(1000, mensaje);
  };

  const setJuegoConfigurado = () => {
    // Limpiar cola de mensajes pendientes
    if (statusTimerRef.current) {
      clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }
    statusQueueRef.current = [];
    setStatusMessage('');

    setGameStarted(true);
    setGameEnded(false);
    setSessionTime(0);
    sessionTimeRef.current = 0;
    setTimeLeft(timePerObject);
    setProgresoEscaneo(0);
    frameCountRef.current = 0;
    setPuntos(0);
    puntosRef.current = 0;
    comboCountRef.current = 0;
    setComboCount(0);
    setComboActive(false);
    comboActiveRef.current = false;
    lastSuccessAtRef.current = 0;
    objectsFoundRef.current = 0;
    setObjectsFound(0);
    legendaryModeRef.current = false;
    setLegendaryMode(false);
    setLegendaryObject(null);
    legendaryObjectRef.current = null;
    setLegendaryTimeLeft(0);
    // Resetear timer de decay al arrancar
    objectStartTimeRef.current = Date.now();
    setPotentialScore(1000);
    if (comboTimerRef.current) {
      clearTimeout(comboTimerRef.current);
    }
  };

  const handleStartGame = () => {
    const nombreFinal = setupName.trim();
    if (!nombreFinal) {
      setStatusMessage('Ingresá tu nombre para comenzar.');
      return;
    }

    if (nombreFinal.toLowerCase() === 'capture' || nombreFinal.toLowerCase() === 'captura') {
      setShowCaptureTool(true);
      return;
    }

    setPlayerName(nombreFinal);
    setSetupName(nombreFinal);
    setJuegoConfigurado();
  };

  const reiniciarPartida = () => {
    // Limpiar cola de mensajes pendientes
    if (statusTimerRef.current) {
      clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }
    statusQueueRef.current = [];

    setPlayerName('');
    setSetupName('');
    gameEndedRef.current = false;
    setGameEnded(false);
    setGameStarted(false);
    setStatusMessage('');
    setPuntos(0);
    puntosRef.current = 0;
    setTimeLeft(timePerObject);
    setSessionTime(0);
    sessionTimeRef.current = 0;
    setObjetoActual(OBJETOS_BUSCADOS[0]);
    setProgresoEscaneo(0);
    frameCountRef.current = 0;
    wrongFrameCountRef.current = 0;
    lastWrongClassRef.current = null;
    lastPenaltyTimeRef.current = 0;
    comboCountRef.current = 0;
    setComboCount(0);
    setComboActive(false);
    comboActiveRef.current = false;
    lastSuccessAtRef.current = 0;
    objectsFoundRef.current = 0;
    setObjectsFound(0);
    legendaryModeRef.current = false;
    setLegendaryMode(false);
    setLegendaryObject(null);
    legendaryObjectRef.current = null;
    setLegendaryTimeLeft(0);
    if (comboTimerRef.current) {
      clearTimeout(comboTimerRef.current);
    }

    // Liberar cámara al volver al setup
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const detectFrame = async () => {
    if (!gameStarted || gameEndedRef.current || !model || !videoRef.current || !canvasRef.current || videoRef.current.readyState !== 4) {
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;

    // Detectar tarjetas con YOLOv8 ONNX
    const predictions = await detectYoloObjects(video, 0.50);

    // Si el juego terminó mientras esperábamos la inferencia, descartar
    if (gameEndedRef.current || !gameStarted) {
      return;
    }

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let encontroObjetivo = false;
    let detectoTarjetaIncorrecta = null; // clase incorrecta detectada con alta certeza

    predictions.forEach((prediction) => {
      const [x, y, width, height] = prediction.bbox;
      const claseDetectada = prediction.class;
      const certeza = Math.round(prediction.score * 100);

      if (certeza > 50) {
        const esObjetivoLegendario = legendaryModeRef.current && claseDetectada === legendaryObjectRef.current;
        const esObjetivoNormal = !legendaryModeRef.current && claseDetectada === objetoActualRef.current;
        const esObjetivo = esObjetivoLegendario || esObjetivoNormal;

        const nombreEspanol = DICCIONARIO[claseDetectada] || claseDetectada;

        if (esObjetivo) {
          encontroObjetivo = true;
          playScanTone();

          ctx.strokeStyle = '#10B981';
          ctx.lineWidth = 6;
          ctx.strokeRect(x, y, width, height);

          ctx.fillStyle = 'rgba(16, 185, 129, 0.8)';
          ctx.fillRect(x, y - 30, ctx.measureText(`${nombreEspanol}`).width + 60, 30);

          ctx.fillStyle = '#FFFFFF';
          ctx.font = 'bold 18px Arial';
          ctx.fillText(`${nombreEspanol.toUpperCase()} (${certeza}%)`, x + 5, y - 10);
        } else {
          // Tarjeta detectada pero NO es el objetivo
          if (certeza > 60) {
            detectoTarjetaIncorrecta = claseDetectada;
          }

          ctx.strokeStyle = 'rgba(255, 45, 117, 0.5)';
          ctx.lineWidth = 3;
          ctx.strokeRect(x, y, width, height);

          ctx.fillStyle = 'rgba(255, 45, 117, 0.7)';
          ctx.font = 'bold 14px Arial';
          ctx.fillText(`✗ ${nombreEspanol}`, x, y > 15 ? y - 5 : 15);
        }
      }
    });

    if (encontroObjetivo) {
      frameCountRef.current += 1;
      wrongFrameCountRef.current = 0;
      lastWrongClassRef.current = null;
      setProgresoEscaneo((frameCountRef.current / FRAMES_PARA_VALIDAR) * 100);

      if (frameCountRef.current >= FRAMES_PARA_VALIDAR) {
        manejarAcierto();
      }
    } else {
      if (frameCountRef.current > 0) {
        frameCountRef.current = 0;
        setProgresoEscaneo(0);
      }

      // Detectar tarjeta incorrecta sostenida
      if (detectoTarjetaIncorrecta) {
        if (lastWrongClassRef.current === detectoTarjetaIncorrecta) {
          wrongFrameCountRef.current += 1;
          if (wrongFrameCountRef.current >= FRAMES_PARA_PENALIZAR) {
            manejarPenalizacion(detectoTarjetaIncorrecta);
          }
        } else {
          lastWrongClassRef.current = detectoTarjetaIncorrecta;
          wrongFrameCountRef.current = 1;
        }
      } else {
        wrongFrameCountRef.current = 0;
        lastWrongClassRef.current = null;
      }
    }
  };

  // Loop de detección a ~6 FPS para no saturar PCs de baja capacidad.
  // El render del bounding box se hace dentro de detectFrame.
  useEffect(() => {
    if (!gameStarted || gameEnded) {
      return undefined;
    }

    detectLoopRunningRef.current = true;
    const INTERVAL_MS = 120; // ~8 FPS, escaneo más rápido y reactivo

    const tick = async () => {
      if (!detectLoopRunningRef.current) return;
      await detectFrame();
      if (detectLoopRunningRef.current) {
        setTimeout(tick, INTERVAL_MS);
      }
    };

    tick();

    return () => {
      detectLoopRunningRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameStarted, gameEnded, model]);

  if (showCaptureTool) {
    return <TrainingCaptureView onBack={() => setShowCaptureTool(false)} />;
  }

  if (loading) {
    return (
      <div className="app-shell setup-shell">
        <div className="screen-wipe" aria-hidden="true" />
        <ParticleField />
        <div className="arcade-grid-bg" aria-hidden="true" />
        <div className="screen-watermark">ESTEBAN CEJAS • UCSE VISION</div>
        <div className="setup-card arcade-frame">
          <div className="arcade-border-glow" aria-hidden="true" />
          <p className="eyebrow">⟨ SISTEMA IA ⟩</p>
          <h1 className="setup-title glitch-text" data-text="UCSE VISION">UCSE VISION</h1>
          <div className="loading-bar-container">
            <div className="loading-bar">
              <div className="loading-bar-fill" />
            </div>
          </div>
          <p className="loading-text">INICIANDO RED NEURONAL...</p>
          <p className="insert-coin">CARGANDO MODELO DE IA</p>
          <div className="producer-tag">PRODUCIDO POR ESTEBAN CEJAS</div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="app-shell setup-shell">
        <div className="screen-wipe" aria-hidden="true" />
        <ParticleField />
        <div className="arcade-grid-bg" aria-hidden="true" />
        <div className="screen-watermark">ESTEBAN CEJAS • UCSE VISION</div>
        <div className="setup-card arcade-frame" style={{ borderColor: 'var(--neon-magenta)' }}>
          <p className="eyebrow" style={{ color: 'var(--neon-magenta)' }}>⟨ ERROR ⟩</p>
          <h1 className="setup-title glitch-text" data-text="ERROR IA" style={{ color: 'var(--neon-magenta)', fontSize: '1.5rem' }}>
            ERROR AL CARGAR IA
          </h1>
          <p style={{ fontFamily: 'var(--font-arcade)', fontSize: '0.65rem', color: 'var(--text-muted)', margin: '1rem 0', lineHeight: '1.8' }}>
            {loadError}
          </p>
          <p style={{ fontFamily: 'var(--font-arcade)', fontSize: '0.6rem', color: 'var(--neon-yellow)', margin: '0.5rem 0 1.5rem' }}>
            Verificá que el archivo<br />
            <strong style={{ color: 'var(--neon-cyan)' }}>public/models/best.onnx</strong><br />
            exista y sea accesible.
          </p>
          <button
            type="button"
            className="start-button"
            onClick={() => { setLoadError(null); setLoading(true); }}
          >
            ↺ REINTENTAR
          </button>
          <div className="producer-tag">PRODUCIDO POR ESTEBAN CEJAS</div>
        </div>
      </div>
    );
  }

  if (gameEnded) {
    // Efecto 15: fuegos artificiales si el jugador entró al top 3 del ranking
    const posicionJugador = ranking.findIndex((e) => e.name === playerName && e.points === puntos);
    const esTop3 = posicionJugador !== -1 && posicionJugador < 3;

    return (
      <div className="app-shell setup-shell">
        <div className="screen-wipe" aria-hidden="true" />
        <ParticleField />
        <div className="arcade-grid-bg" aria-hidden="true" />
        <div className="screen-watermark">ESTEBAN CEJAS • UCSE VISION</div>
        <div className="end-results-grid">
          {/* LEFT PANEL: Game Over info + QR */}
          <div className="end-left-panel arcade-frame">
            <div className="arcade-border-glow" aria-hidden="true" />
            <h1 className="game-over-title glitch-text" data-text="GAME OVER">GAME OVER</h1>
            <p className="eyebrow">{playerName}</p>

            {esTop3 && (
              <div className="fireworks-burst" aria-hidden="true">
                {Array.from({ length: 12 }).map((_, i) => (
                  <span key={i} className={`firework-piece firework-piece-${i % 4}`} style={{ '--i': i }} />
                ))}
              </div>
            )}

            <div className="final-score-box">
              <span>PUNTAJE FINAL</span>
              <strong className="score-display">{formatScore(puntajeAnimado)}</strong>
            </div>

            <div className="final-summary">
              <span>OBJETOS ESCANEADOS</span>
              <strong>{objectsFound} 🎯</strong>
            </div>

            <div className="stat-row">
              <span>TIEMPO TOTAL</span>
              <strong>{sessionTime}s</strong>
            </div>

            <div className="producer-badge">
              <span>PRODUCIDO POR</span>
              <strong>ESTEBAN CEJAS</strong>
            </div>

            {statusMessage && <p className="setup-message">{statusMessage}</p>}

            <button type="button" className="start-button" onClick={reiniciarPartida}>
              ▶ JUGAR DE NUEVO
            </button>
          </div>

          {/* RIGHT PANEL: Ranking */}
          <div className="end-right-panel arcade-frame">
            <div className="arcade-border-glow" aria-hidden="true" />
            <div className="ranking-header">
              <span className="ranking-title">★ HIGH SCORES ★</span>
              {ranking.length > 0 && (
                <button
                  type="button"
                  className="reset-ranking-btn"
                  onClick={borrarRankingCompleto}
                  title="Reiniciar tabla de puntajes"
                >
                  🗑️ BORRAR RANKING
                </button>
              )}
            </div>

            <ol className="ranking-list">
              {ranking.length === 0 ? (
                <li className="ranking-empty">NO HAY PUNTAJES AÚN</li>
              ) : (
                ranking.map((entry, index) => (
                  <li
                    key={`${entry.name}-${entry.points}-${index}`}
                    className={`ranking-item ${index === 0 ? 'ranking-gold' : ''} ${index === 1 ? 'ranking-silver' : ''} ${index === 2 ? 'ranking-bronze' : ''}`}
                    style={{ animationDelay: `${index * 60}ms` }}
                  >
                    <span
                      className={`ranking-position ${index < 3 ? 'medal-drop' : ''}`}
                      style={index < 3 ? { animationDelay: `${300 + index * 120}ms` } : undefined}
                    >
                      {index === 0 ? '👑' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`}
                    </span>
                    <span className="ranking-name">{entry.name}</span>
                    <strong>{formatScore(entry.points)}</strong>
                    <small>{entry.time}s</small>
                  </li>
                ))
              )}
            </ol>
          </div>
        </div>
      </div>
    );
  }

  if (!gameStarted) {
    return (
      <div className="app-shell setup-shell">
        <div className="screen-wipe" aria-hidden="true" />
        <ParticleField />
        <div className="arcade-grid-bg" aria-hidden="true" />
        <div className="screen-watermark">ESTEBAN CEJAS • UCSE VISION</div>
        <div className="setup-card arcade-frame">
          <div className="arcade-border-glow" aria-hidden="true" />
          <p className="eyebrow">⟨ NUEVA PARTIDA ⟩</p>
          <h1 className="player-select-title glitch-text" data-text="PLAYER SELECT">PLAYER SELECT</h1>
  
          <label className="input-group">
            <span>TU NOMBRE</span>
            <input
              type="text"
              value={setupName}
              onChange={(event) => setSetupName(event.target.value)}
              placeholder="Ej: Esteban"
              maxLength={20}
            />
          </label>
  
          <label className="input-group">
            <span>TIEMPO POR OBJETO</span>
            <select
              value={timePerObject}
              onChange={(event) => setTimePerObject(Number(event.target.value))}
            >
              {OPCIONES_TIEMPO.map((value) => (
                <option key={value} value={value}>
                  {value} SEGUNDOS
                </option>
              ))}
            </select>
          </label>
  
          {statusMessage && <p className="setup-message">{statusMessage}</p>}
  
          <button type="button" className="start-button" onClick={handleStartGame}>
            ▶ INSERTAR MONEDA
          </button>
          <p className="insert-coin">PRESS START</p>
          <div className="producer-tag">PRODUCIDO POR ESTEBAN CEJAS</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="screen-wipe" aria-hidden="true" />
      {powerOnActive && <div className="crt-power-on" aria-hidden="true" />}
      <ParticleField />
      <CRTOverlay />
      <div className="screen-watermark">ESTEBAN CEJAS • UCSE VISION</div>
  
      <div className="player-badge">
        <span>PLAYER</span>
        <strong>{playerName}</strong>
      </div>
  
      <header className="app-header">
        <div className="brand-lockup" aria-label="UCSE Vision">
          <img src="/favicon.png" alt="Logo UCSE Vision" className="app-logo-img" />
          <div>
            <p className="eyebrow">⟨ LABORATORIO IA ⟩</p>
            <h1 className="app-title glitch-text" data-text="UCSE VISION">UCSE VISION</h1>
          </div>
        </div>
        <div className="header-credits">
          <span className="credits-label">PRODUCIDO POR</span>
          <strong className="credits-author">ESTEBAN CEJAS</strong>
        </div>
      </header>
  
      <main className="app-layout">
        <section className="camera-panel">
          <div className={`camera-frame ${comboActive ? 'combo-active' : ''} ${legendaryMode ? 'legendary-active' : ''}`}>
            <div className="camera-watermark">DEV: ESTEBAN CEJAS</div>
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              width="640"
              height="480"
              className="camera-video"
            />
            <canvas ref={canvasRef} width="640" height="480" className="camera-overlay" />
  
            <CornerBrackets />

            {/* Efecto 5: vignette roja de urgencia cuando quedan pocos segundos */}
            {timeLeft <= 5 && timeLeft > 0 && <div className="urgency-vignette" aria-hidden="true" />}
  
            {comboActive && (
              <div className="combo-banner">⚡ RACHA x2 ⚡</div>
            )}
  
            {legendaryMode && (
              <div className="legendary-banner">✨ LEGENDARIO ✨</div>
            )}

            {aciertoFlash && (
              <div key={aciertoFlash.key} className={`acierto-flash ${aciertoFlash.legendary ? 'legendary' : ''}`}>
                {aciertoFlash.texto}
              </div>
            )}

            {/* Efecto 4: confetti pixelado al acertar */}
            {aciertoFlash && (
              <div className="confetti-burst" key={`confetti-${aciertoFlash.key}`} aria-hidden="true">
                {Array.from({ length: 8 }).map((_, i) => (
                  <span key={i} className={`confetti-piece confetti-piece-${i % 4}`} style={{ '--i': i }} />
                ))}
              </div>
            )}

            {penaltyFlash && (
              <div key={penaltyFlash.key} className="penalty-flash" />
            )}

            {scorePop && (
              <div key={scorePop.key} className={`score-pop ${scorePop.penalty ? 'penalty' : ''}`}>
                {scorePop.texto}
              </div>
            )}
  
            {progresoEscaneo > 0 && (
              <div className="scan-indicator">
                <p className="scan-indicator-label">▶ ESCANEANDO OBJETIVO...</p>
                <div className="scan-bar">
                  <div className="scan-fill" style={{ width: `${progresoEscaneo}%` }} />
                </div>
              </div>
            )}
          </div>
        </section>
  
        <aside className="side-panel">
          <div className="panel-header">
            <p className="panel-label">⟨ ESCÁNER ⟩</p>
            <h2 className="side-title">DETECCIÓN IA</h2>
          </div>
  
          <div className="meta-stack">
            <div className="mini-card">
              <span className="mini-label">JUGADOR</span>
              <strong>{playerName}</strong>
            </div>
            <div className={`mini-card timer-card ${timeLeft <= 5 ? 'timer-urgent' : ''}`}>
              <span className="mini-label">TIEMPO</span>
              <strong>{timeLeft}s</strong>
            </div>
          </div>
  
          <div className="meta-stack">
            <div className="mini-card">
              <span className="mini-label">OBJETOS LOGRADOS</span>
              <strong>{objectsFound} 🎯</strong>
            </div>
            {legendaryMode && (
              <div className="mini-card timer-card timer-urgent">
                <span className="mini-label">LEGENDARIO</span>
                <strong>{legendaryTimeLeft}s ⏳</strong>
              </div>
            )}
          </div>
  
          <div className="objective-box">
            <p className="objective-label">ENCUENTRA Y MANTÉN FRENTE A LA CÁMARA:</p>
            <div
              className={`reference-icon emoji-enter ${legendaryMode ? 'legendary-emoji-wrap' : ''}`}
              style={{ margin: '0.6rem 0' }}
              key={`emoji-${objetoActual}-${legendaryMode}`}
            >
              {legendaryMode && <div className="legendary-rays" aria-hidden="true" />}
              <PixelEmoji emoji={ICONOS_OBJETO[objetoActual]} size={72} />
            </div>
            <div
              className={`objective-pill objective-pill-enter ${legendaryMode ? 'legendary-pill' : ''}`}
              key={`pill-${objetoActual}-${legendaryMode}`}
            >
              <span>{legendaryMode ? `★ ${DICCIONARIO[objetoActual]} ★` : DICCIONARIO[objetoActual]}</span>
            </div>
            {/* Indicador de puntaje potencial con decay */}
            <div className="potential-score-indicator" style={{
              marginTop: '0.5rem',
              fontFamily: 'var(--font-arcade)',
              fontSize: '0.7rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '0.3rem 0.5rem',
              background: 'rgba(0,0,0,0.3)',
              borderRadius: '4px',
              color: potentialScore >= 900
                ? 'var(--neon-green)'
                : potentialScore >= 600
                  ? 'var(--neon-yellow)'
                  : potentialScore >= 300
                    ? '#ff9500'
                    : 'var(--neon-magenta)',
            }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.6rem' }}>VALE:</span>
              <span>+{potentialScore.toLocaleString('es-AR')}</span>
            </div>
          </div>
  
          {statusMessage && <p className="status-message">{statusMessage}</p>}
  
          {comboActive && (
            <div className="combo-pill combo-pill-pop" key={`combo-${comboCount}`}>
              ⚡ RACHA {comboCount} ⚡
              <div className="combo-timer-bar" key={`combo-bar-${comboCount}`}>
                <div className="combo-timer-fill" />
              </div>
            </div>
          )}
  
          <div className="score-card">
            <span className="score-label">PUNTUACIÓN</span>
            <span className={`score-value score-display ${scoreBump}`}>{formatScore(puntosAnimados)}</span>
          </div>
  
          <button
            type="button"
            className="end-game-button"
            onClick={() => finalizarPartida('Partida finalizada')}
          >
            ■ FINALIZAR PARTIDA
          </button>
        </aside>
      </main>
    </div>
  );
}

export default App;