import React, { useRef, useState, useEffect } from 'react';
import { ObjectDetector, FilesetResolver } from '@mediapipe/tasks-vision';

const DICCIONARIO = {
  'cell phone': 'Celular',
  'cup': 'Taza',
  'bottle': 'Botella',
  'book': 'Libro',
  'keyboard': 'Teclado',
  'banana': 'Banana',
  'scissors': 'Tijeras',
  'spoon': 'Cuchara',
  'fork': 'Tenedor'
};

const ICONOS_OBJETO = {
  'cell phone': '📱',
  'cup': '☕',
  'bottle': '🧴',
  'book': '📖',
  'keyboard': '⌨️',
  'banana': '🍌',
  'scissors': '✂️',
  'spoon': '🥄',
  'fork': '🍴'
};

const OBJETOS_BUSCADOS = Object.keys(DICCIONARIO);
const TOTAL_OBJETOS_PARTIDA = 10;
const FRAMES_PARA_VALIDAR = 30;
const OPCIONES_TIEMPO = [15, 30, 60];
const RANKING_KEY = 'ucse-vision-ranking';
const LEGENDARY_EVERY = 5;
const LEGENDARY_SECONDS = 10;
const GITHUB_LINK = 'https://github.com/tu-usuario/expoucse-vision';

const formatScore = (score) => String(score).padStart(6, '0');

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

function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const [model, setModel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [gameStarted, setGameStarted] = useState(false);
  const [gameEnded, setGameEnded] = useState(false);
  const [playerName, setPlayerName] = useState('');
  const [setupName, setSetupName] = useState('');
  const [timePerObject, setTimePerObject] = useState(30);
  const [timeLeft, setTimeLeft] = useState(30);
  const [sessionTime, setSessionTime] = useState(0);
  const [puntos, setPuntos] = useState(0);
  const [objetoActual, setObjetoActual] = useState(OBJETOS_BUSCADOS[0]);
  const [progresoEscaneo, setProgresoEscaneo] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [ranking, setRanking] = useState(() => leerRanking());
  const [comboCount, setComboCount] = useState(0);
  const [comboActive, setComboActive] = useState(false);
  const [iaConfidence, setIaConfidence] = useState(0);
  const [legendaryMode, setLegendaryMode] = useState(false);
  const [legendaryObject, setLegendaryObject] = useState(null);
  const [objectsFound, setObjectsFound] = useState(0);
  const [objectsAttempted, setObjectsAttempted] = useState(0);

  const frameCountRef = useRef(0);
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
  const objectsAttemptedRef = useRef(0);
  const puntosRef = useRef(0);
  const sessionTimeRef = useRef(0);
  const playerNameRef = useRef('');
  const gameEndedRef = useRef(false);

  useEffect(() => {
    objetoActualRef.current = objetoActual;
  }, [objetoActual]);

  useEffect(() => {
    legendaryObjectRef.current = legendaryObject;
  }, [legendaryObject]);

  useEffect(() => {
    puntosRef.current = puntos;
  }, [puntos]);

  useEffect(() => {
    sessionTimeRef.current = sessionTime;
  }, [sessionTime]);

  useEffect(() => {
    playerNameRef.current = playerName;
  }, [playerName]);

  useEffect(() => {
    gameEndedRef.current = gameEnded;
  }, [gameEnded]);

  useEffect(() => {
    const loadModel = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );
        const objectDetector = await ObjectDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite`,
            delegate: "GPU"
          },
          scoreThreshold: 0.3,
          runningMode: "VIDEO"
        });
        setModel(objectDetector);
        setLoading(false);
      } catch (error) {
        console.error('Error al cargar el modelo MediaPipe:', error);
      }
    };

    loadModel();
  }, []);

  useEffect(() => {
    if (!gameStarted || gameEnded) {
      return undefined;
    }

    const iniciarCamara = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setStatusMessage('Tu navegador no admite acceso a la cámara.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' }
        });

        if (!videoRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      } catch (err) {
        console.error('Error al acceder a la cámara:', err);
        setStatusMessage('No se pudo acceder a la cámara. Revisá el permiso del navegador.');
      }
    };

    iniciarCamara();
  }, [gameStarted, gameEnded]);

  useEffect(() => {
    if (!gameStarted || gameEnded) {
      return undefined;
    }

    const interval = setInterval(() => {
      setSessionTime((current) => current + 1);

      setTimeLeft((current) => {
        if (current <= 1) {
          clearInterval(interval);

          if (legendaryModeRef.current) {
            legendaryModeRef.current = false;
            setLegendaryMode(false);
            setLegendaryObject(null);
            legendaryObjectRef.current = null;

            const atendidosLegendario = objectsAttemptedRef.current + 1;
            objectsAttemptedRef.current = atendidosLegendario;
            setObjectsAttempted(atendidosLegendario);

            if (atendidosLegendario >= TOTAL_OBJETOS_PARTIDA) {
              finalizarPartida(`¡Partida completa! Acertaste ${objectsFoundRef.current}/${TOTAL_OBJETOS_PARTIDA} 🎯`);
              return timePerObject;
            }

            setStatusMessage('¡Se acabó el tiempo legendario!');
            setObjetoActual(OBJETOS_BUSCADOS[Math.floor(Math.random() * OBJETOS_BUSCADOS.length)]);
            return timePerObject;
          }

          guardarRanking(playerNameRef.current || 'Jugador', puntosRef.current, sessionTimeRef.current + 1);

          const atendidos = objectsAttemptedRef.current + 1;
          objectsAttemptedRef.current = atendidos;
          setObjectsAttempted(atendidos);

          if (atendidos >= TOTAL_OBJETOS_PARTIDA) {
            finalizarPartida(`¡Partida completa! Acertaste ${objectsFoundRef.current}/${TOTAL_OBJETOS_PARTIDA} 🎯`);
            return timePerObject;
          }

          avanzarObjeto(-25, '¡Se acabó el tiempo!');
          return timePerObject;
        }

        return current - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [gameStarted, gameEnded, timePerObject]);

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

  const playTone = (frequency, duration = 0.08, type = 'sine', volume = 0.04) => {
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
  };

  const playScanTone = () => {
    const now = Date.now();
    if (now - scanToneCooldownRef.current < 120) {
      return;
    }

    scanToneCooldownRef.current = now;
    playTone(620, 0.05, 'square', 0.03);
  };

  const playSuccessTone = () => {
    playTone(880, 0.08, 'triangle', 0.05);
    setTimeout(() => playTone(1180, 0.1, 'triangle', 0.05), 90);
  };

  const guardarRanking = (nombre, puntajeActual, tiempoTotal) => {
    const entrada = {
      name: nombre,
      points: puntajeActual,
      time: tiempoTotal,
    };

    const siguienteRanking = [...leerRanking(), entrada]
      .sort((a, b) => b.points - a.points || a.time - b.time)
      .slice(0, 10);

    localStorage.setItem(RANKING_KEY, JSON.stringify(siguienteRanking));
    setRanking(siguienteRanking);
  };

  const registrarRacha = () => {
    const now = Date.now();
    const windowMs = 5000;
    const dentroDeVentana = now - lastSuccessAtRef.current < windowMs;
    const nextCombo = dentroDeVentana ? comboCountRef.current + 1 : 1;

    comboCountRef.current = nextCombo;
    setComboCount(nextCombo);

    const isComboActive = nextCombo >= 3;
    comboActiveRef.current = isComboActive;
    setComboActive(isComboActive);

    if (isComboActive) {
      setStatusMessage('¡Racha x2! 🔥');
    }

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
  };

  const avanzarObjeto = (puntosExtra = 100, mensaje = '') => {
    frameCountRef.current = 0;
    setProgresoEscaneo(0);

    const multiplicador = comboActiveRef.current ? 2 : 1;
    const puntajeReal = puntosExtra * multiplicador;

    setPuntos((prev) => {
      const nuevoPuntaje = prev + puntajeReal;
      guardarRanking(playerName || 'Jugador', nuevoPuntaje, sessionTime);
      return nuevoPuntaje;
    });

    setStatusMessage(mensaje || (comboActiveRef.current ? '¡Racha x2! 🔥' : ''));
    setTimeLeft(timePerObject);

    let nuevoObjeto;
    do {
      nuevoObjeto = OBJETOS_BUSCADOS[Math.floor(Math.random() * OBJETOS_BUSCADOS.length)];
    } while (nuevoObjeto === objetoActualRef.current);

    setObjetoActual(nuevoObjeto);
  };

  const manejarAcierto = () => {
    const siguienteAtendidos = objectsAttemptedRef.current + 1;
    objectsAttemptedRef.current = siguienteAtendidos;
    setObjectsAttempted(siguienteAtendidos);

    const siguienteObjetosEncontrados = objectsFoundRef.current + 1;
    objectsFoundRef.current = siguienteObjetosEncontrados;
    setObjectsFound(siguienteObjetosEncontrados);

    if (siguienteAtendidos >= TOTAL_OBJETOS_PARTIDA) {
      setPuntos((prev) => {
        const nuevoPuntaje = prev + 250;
        guardarRanking(playerName || 'Jugador', nuevoPuntaje, sessionTime);
        return nuevoPuntaje;
      });
      playSuccessTone();
      finalizarPartida(`¡Partida completa! Acertaste ${siguienteObjetosEncontrados}/${TOTAL_OBJETOS_PARTIDA} 🎉`);
      return;
    }

    const isLegendary = siguienteObjetosEncontrados > 0 && siguienteObjetosEncontrados % LEGENDARY_EVERY === 0;
    if (isLegendary) {
      const opcionesDisponibles = OBJETOS_BUSCADOS.filter((item) => item !== objetoActualRef.current);
      const siguienteLegendario = opcionesDisponibles[Math.floor(Math.random() * opcionesDisponibles.length)] || OBJETOS_BUSCADOS[0];

      legendaryObjectRef.current = siguienteLegendario;
      setLegendaryObject(siguienteLegendario);
      legendaryModeRef.current = true;
      setLegendaryMode(true);
      setStatusMessage(`¡Busca ${DICCIONARIO[siguienteLegendario]} legendario! ✨`);
      setTimeLeft(LEGENDARY_SECONDS);
      setObjetoActual(siguienteLegendario);
      setPuntos((prev) => {
        const nuevoPuntaje = prev + 500;
        guardarRanking(playerName || 'Jugador', nuevoPuntaje, sessionTime);
        return nuevoPuntaje;
      });
      playSuccessTone();
      return;
    }

    registrarRacha();
    playSuccessTone();
    avanzarObjeto(100, comboActiveRef.current ? '¡Racha x2! 🔥' : '¡Objetivo encontrado!');
  };

  const handleStartGame = () => {
    const nombreFinal = setupName.trim();
    if (!nombreFinal) {
      setStatusMessage('Ingresá tu nombre para comenzar.');
      return;
    }

    setPlayerName(nombreFinal);
    setSetupName(nombreFinal);
    setJuegoConfigurado();
  };

  const reiniciarPartida = () => {
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
    setIaConfidence(0);
    frameCountRef.current = 0;
    comboCountRef.current = 0;
    setComboCount(0);
    setComboActive(false);
    comboActiveRef.current = false;
    lastSuccessAtRef.current = 0;
    objectsFoundRef.current = 0;
    setObjectsFound(0);
    objectsAttemptedRef.current = 0;
    setObjectsAttempted(0);
    legendaryModeRef.current = false;
    setLegendaryMode(false);
    setLegendaryObject(null);
    legendaryObjectRef.current = null;
    if (comboTimerRef.current) {
      clearTimeout(comboTimerRef.current);
    }
  };

  const setJuegoConfigurado = () => {
    setGameStarted(true);
    setGameEnded(false);
    setSessionTime(0);
    setTimeLeft(timePerObject);
    setStatusMessage('');
    setProgresoEscaneo(0);
    setIaConfidence(0);
    frameCountRef.current = 0;
    comboCountRef.current = 0;
    setComboCount(0);
    setComboActive(false);
    comboActiveRef.current = false;
    lastSuccessAtRef.current = 0;
    objectsFoundRef.current = 0;
    setObjectsFound(0);
    objectsAttemptedRef.current = 0;
    setObjectsAttempted(0);
    legendaryModeRef.current = false;
    setLegendaryMode(false);
    setLegendaryObject(null);
    legendaryObjectRef.current = null;
    if (comboTimerRef.current) {
      clearTimeout(comboTimerRef.current);
    }
  };

  const finalizarPartida = (motivo = '¡Partida terminada!') => {
    if (gameEndedRef.current) {
      return;
    }

    const nombreFinal = playerNameRef.current || 'Jugador';
    guardarRanking(nombreFinal, puntosRef.current, sessionTimeRef.current);

    gameEndedRef.current = true;
    setGameEnded(true);
    setGameStarted(false);
    setStatusMessage(motivo);
    setLegendaryMode(false);
    legendaryModeRef.current = false;
    setLegendaryObject(null);
    legendaryObjectRef.current = null;

    if (videoRef.current && videoRef.current.srcObject) {
      const mediaStream = videoRef.current.srcObject;
      mediaStream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
  };

  const detectFrame = async () => {
    if (!gameStarted || gameEndedRef.current || !model || !videoRef.current || !canvasRef.current || videoRef.current.readyState !== 4) {
      if (!gameEndedRef.current) {
        requestAnimationFrame(detectFrame);
      }
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const startTimeMs = performance.now();
    const detectionResult = model.detectForVideo(video, startTimeMs);

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let mejorConfianza = 0;
    let encontroObjetivo = false;

    if (detectionResult && detectionResult.detections) {
      detectionResult.detections.forEach((detection) => {
        const category = detection.categories[0];
        if (!category) return;

        const claseDetectada = category.categoryName;
        const certeza = Math.round(category.score * 100);
        
        const boundingBox = detection.boundingBox;
        const x = boundingBox.originX;
        const y = boundingBox.originY;
        const width = boundingBox.width;
        const height = boundingBox.height;

        if (certeza > mejorConfianza) {
          mejorConfianza = certeza;
        }

        if (certeza > 45) {
          const esObjetivoLegendario = legendaryModeRef.current && claseDetectada === legendaryObjectRef.current;
          const esObjetivoNormal = !legendaryModeRef.current && claseDetectada === objetoActualRef.current;
          const esObjetivo = esObjetivoLegendario || esObjetivoNormal;

          if (esObjetivo) {
            encontroObjetivo = true;
            playScanTone();

            ctx.strokeStyle = '#10B981';
            ctx.lineWidth = 6;
            ctx.strokeRect(x, y, width, height);

            ctx.fillStyle = 'rgba(16, 185, 129, 0.8)';
            ctx.fillRect(x, y - 30, ctx.measureText(`${claseDetectada}`).width + 50, 30);

            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 18px Arial';
            ctx.fillText(`OBJETIVO (${certeza}%)`, x + 5, y - 10);
          } else {
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
            ctx.lineWidth = 2;
            ctx.strokeRect(x, y, width, height);

            ctx.fillStyle = 'rgba(148, 163, 184, 0.5)';
            ctx.font = '12px Arial';
            ctx.fillText(claseDetectada, x, y > 15 ? y - 5 : 15);
          }
        }
      });
    }

    setIaConfidence(mejorConfianza);

    if (encontroObjetivo) {
      frameCountRef.current += 1;
      setProgresoEscaneo((frameCountRef.current / FRAMES_PARA_VALIDAR) * 100);

      if (frameCountRef.current >= FRAMES_PARA_VALIDAR) {
        manejarAcierto();
      }
    } else {
      if (frameCountRef.current > 0) {
        frameCountRef.current = 0;
        setProgresoEscaneo(0);
      }
    }

    requestAnimationFrame(detectFrame);
  };

  if (loading) {
    return (
      <div className="app-shell setup-shell">
        <ParticleField />
        <div className="arcade-grid-bg" aria-hidden="true" />
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
        </div>
      </div>
    );
  }

  if (gameEnded) {
    return (
      <div className="app-shell setup-shell">
        <ParticleField />
        <div className="arcade-grid-bg" aria-hidden="true" />
        <div className="end-results-grid">
          {/* LEFT PANEL: Game Over info + QR */}
          <div className="end-left-panel arcade-frame">
            <div className="arcade-border-glow" aria-hidden="true" />
            <h1 className="game-over-title glitch-text" data-text="GAME OVER">GAME OVER</h1>
            <p className="eyebrow">{playerName}</p>

            <div className="final-score-box">
              <span>PUNTAJE FINAL</span>
              <strong className="score-display">{formatScore(puntos)}</strong>
            </div>

            <div className="final-summary">
              <span>OBJETOS ENCONTRADOS</span>
              <strong>{objectsFound}/{TOTAL_OBJETOS_PARTIDA}</strong>
            </div>

            <div className="stat-row">
              <span>TIEMPO TOTAL</span>
              <strong>{sessionTime}s</strong>
            </div>

            <div className="qr-card qr-card-final">
              <div className="qr-box" aria-label="QR del proyecto">
                <svg viewBox="0 0 120 120" role="img" aria-label="Código QR del proyecto">
                  <rect width="120" height="120" fill="#ffffff" />
                  {[
                    [0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[6,0],[7,0],[8,0],[9,0],[10,0],[11,0],[12,0],[13,0],[14,0],[15,0],[0,1],[2,1],[4,1],[6,1],[8,1],[10,1],[12,1],[14,1],[15,1],[0,2],[1,2],[2,2],[3,2],[4,2],[6,2],[7,2],[8,2],[10,2],[12,2],[14,2],[15,2],[0,3],[2,3],[4,3],[5,3],[6,3],[7,3],[8,3],[10,3],[12,3],[14,3],[15,3],[0,4],[1,4],[2,4],[3,4],[4,4],[6,4],[8,4],[10,4],[12,4],[13,4],[14,4],[15,4],[0,5],[2,5],[3,5],[4,5],[6,5],[8,5],[9,5],[10,5],[12,5],[14,5],[15,5],[0,6],[2,6],[4,6],[6,6],[8,6],[9,6],[10,6],[12,6],[14,6],[15,6],[1,7],[3,7],[4,7],[6,7],[7,7],[8,7],[9,7],[10,7],[12,7],[14,7],[15,7],[0,8],[2,8],[4,8],[5,8],[6,8],[7,8],[8,8],[9,8],[10,8],[12,8],[14,8],[15,8],[0,9],[2,9],[4,9],[6,9],[7,9],[8,9],[9,9],[10,9],[12,9],[14,9],[15,9],[0,10],[1,10],[2,10],[3,10],[4,10],[6,10],[8,10],[10,10],[12,10],[13,10],[14,10],[15,10],[0,11],[2,11],[4,11],[5,11],[6,11],[8,11],[9,11],[10,11],[12,11],[14,11],[15,11],[0,12],[1,12],[2,12],[3,12],[4,12],[6,12],[7,12],[8,12],[9,12],[10,12],[12,12],[14,12],[15,12],[0,13],[2,13],[4,13],[5,13],[7,13],[8,13],[9,13],[10,13],[12,13],[14,13],[15,13],[0,14],[2,14],[3,14],[4,14],[5,14],[6,14],[7,14],[8,14],[9,14],[10,14],[12,14],[14,14],[15,14],[0,15],[1,15],[2,15],[3,15],[4,15],[5,15],[6,15],[8,15],[10,15],[12,15],[13,15],[14,15],[15,15]
                  ].map(([x, y]) => (
                    <rect key={`${x}-${y}`} x={x * 7 + 2} y={y * 7 + 2} width="5" height="5" fill="#111827" />
                  ))}
                </svg>
              </div>
              <p className="qr-text">¿Te interesa cómo está hecho? Escaneá para ver el código en GitHub.</p>
              <a className="qr-link" href={GITHUB_LINK} target="_blank" rel="noreferrer">{GITHUB_LINK}</a>
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
            </div>

            <ol className="ranking-list">
              {ranking.length === 0 ? (
                <li className="ranking-empty">NO HAY PUNTAJES AÚN</li>
              ) : (
                ranking.map((entry, index) => (
                  <li key={`${entry.name}-${entry.points}-${index}`} className={`ranking-item ${index === 0 ? 'ranking-gold' : ''} ${index === 1 ? 'ranking-silver' : ''} ${index === 2 ? 'ranking-bronze' : ''}`}>
                    <span className="ranking-position">{index === 0 ? '👑' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`}</span>
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
        <ParticleField />
        <div className="arcade-grid-bg" aria-hidden="true" />
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
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <ParticleField />
      <CRTOverlay />
  
      <div className="player-badge">
        <span>PLAYER</span>
        <strong>{playerName}</strong>
      </div>
  
      <header className="app-header">
        <div className="brand-lockup" aria-label="UCSE Vision">
          <p className="eyebrow">⟨ LABORATORIO IA ⟩</p>
          <h1 className="app-title glitch-text" data-text="UCSE VISION">UCSE VISION</h1>
        </div>
      </header>
  
      <main className="app-layout">
        <section className="camera-panel">
          <div className={`camera-frame ${comboActive ? 'combo-active' : ''} ${legendaryMode ? 'legendary-active' : ''}`}>
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              width="640"
              height="480"
              onLoadedData={detectFrame}
              className="camera-video"
            />
            <canvas ref={canvasRef} width="640" height="480" className="camera-overlay" />
  
            <CornerBrackets />
  
            {comboActive && (
              <div className="combo-banner">⚡ RACHA x2 ⚡</div>
            )}
  
            {legendaryMode && (
              <div className="legendary-banner">✨ LEGENDARIO ✨</div>
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
  
          <div className="progress-pips">
            {Array.from({ length: TOTAL_OBJETOS_PARTIDA }, (_, i) => (
              <div
                key={i}
                className={`progress-pip ${i < objectsFound ? 'found' : ''} ${i === objectsFound ? 'current' : ''}`}
              />
            ))}
          </div>
  
          <div className="reference-card">
            <span className="reference-label">REFERENCIA</span>
            <div className="reference-icon">
              {legendaryMode
                ? <PixelEmoji emoji="✨" size={56} />
                : <PixelEmoji emoji={ICONOS_OBJETO[objetoActual]} size={56} />
              }
            </div>
            <strong>{legendaryMode ? 'OBJETO LEGENDARIO' : DICCIONARIO[objetoActual]}</strong>
          </div>
  
          <div className="objective-box">
            <p className="objective-label">ENCUENTRA Y MANTÉN FRENTE A LA CÁMARA:</p>
            <div className={`objective-pill ${legendaryMode ? 'legendary-pill' : ''}`}>
              <span>{legendaryMode ? '★ LEGENDARIO ★' : DICCIONARIO[objetoActual]}</span>
            </div>
          </div>
  
          {statusMessage && <p className="status-message">{statusMessage}</p>}
  
          {comboActive && (
            <div className="combo-pill">⚡ RACHA {comboCount} ⚡</div>
          )}
  
          <div className="score-card">
            <span className="score-label">PUNTUACIÓN</span>
            <span className="score-value score-display">{formatScore(puntos)}</span>
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