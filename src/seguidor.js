// Cliente del seguimiento: manda cuadros reducidos (los achica la GPU) a seguidor.worker.js.
import { crearTrabajador } from './trabajador.js';

const ANCHO = 320; // resolución de trabajo del seguimiento

const trabajador = crearTrabajador(() => new Worker(new URL('./seguidor.worker.js', import.meta.url), { type: 'module' }), { limiteMs: 5000 });
trabajador.iniciar('hola');

const cuadro = (video) => createImageBitmap(video, { resizeWidth: ANCHO, resizeHeight: Math.round((video.videoHeight / video.videoWidth) * ANCHO), resizeQuality: 'low' });

// Fija el seguimiento en una caja (px del video). Devuelve un objeto con paso() -> caja en px del video + ok.
export async function crearSeguidor(video, caja) {
  const k = ANCHO / video.videoWidth;
  const aVideo = (b) => ({ x: b.x / k, y: b.y / k, w: b.w / k, h: b.h / k, ok: b.ok });
  const bitmap = await cuadro(video);
  const inicial = await trabajador.llamar('iniciar', { bitmap, caja: { x: caja.x * k, y: caja.y * k, w: caja.w * k, h: caja.h * k } }, [bitmap]);
  return {
    inicial: aVideo(inicial),
    async paso() {
      const b = await cuadro(video);
      return aVideo(await trabajador.llamar('paso', { bitmap: b }, [b]));
    },
  };
}

export const soltarSeguidor = () => trabajador.llamar('soltar').catch(() => {});
