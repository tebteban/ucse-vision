import { describe, it, expect } from 'vitest';
import clics from '../fixtures/recortes-sam.json';
import { elegirRecorte, siguienteRecorte, tocaBorde } from '../../src/recorte.js';

const W = 1280;
const H = 720;
const iou = (a, b) => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (ix * iy) / (a.w * a.h + b.w * b.h - ix * iy);
};
const cand = (x, y, w, h, iouSam) => ({ x, y, w, h, area: (w * h * 0.8) / (W * H), iou: iouSam });

describe('elegirRecorte', () => {
  it('en 125 clics reales de SAM sobre objetos chicos elige el objeto en al menos 123', () => {
    // tests/fixtures/recortes-sam.json: candidatos que dio el SAM de la app para clics sobre 10 objetos a 80-380 px,
    // sobre la mesa y sobre una alfombrilla que toca el borde. La regla anterior acertaba 109; esta, 123.
    const bien = clics.filter((c) => {
      const r = elegirRecorte(c.candidatos, W, H);
      return r && iou(r, c.gt) >= 0.6;
    });
    expect(bien.length).toBeGreaterThanOrEqual(123);
  });
  it('descarta el pedazo de alfombrilla que rodea al objeto (caja mediana, casi vacía)', () => {
    // un cuadro real de la escena "chico" de las pruebas E2E: antes se elegía el primero
    const alrededor = { x: 575, y: 271, w: 270, h: 288, area: 0.0276, iou: 0.81 }; // llena el 33 % de su caja
    const objeto = { x: 585, y: 435, w: 111, h: 110, area: 0.0123, iou: 0.9 }; // llena el 92 %
    const parte = { x: 591, y: 448, w: 99, h: 81, area: 0.0047, iou: 0.78 };
    expect(elegirRecorte([alrededor, objeto, parte], W, H)).toBe(objeto);
  });
  it('un objeto ralo (un cable) no se descarta por tener una parte maciza adentro', () => {
    const cable = { x: 400, y: 300, w: 300, h: 200, area: (300 * 200 * 0.3) / (W * H), iou: 0.85 }; // llena el 30 %
    const ficha = { x: 650, y: 450, w: 40, h: 40, area: (40 * 40 * 0.5) / (W * H), iou: 0.8 }; // 50 %: menos del doble
    expect(elegirRecorte([cable, ficha], W, H)).toBe(cable);
  });
  it('descarta la alfombrilla que toca el borde y elige el objeto chico que está encima', () => {
    const alfombrilla = cand(120, 260, 1040, 460, 0.81);
    const objeto = cand(600, 450, 80, 80, 0.94);
    const parte = cand(620, 470, 30, 30, 0.9);
    expect(elegirRecorte([alfombrilla, objeto, parte], W, H)).toBe(objeto);
  });
  it('descarta un pedazo irregular de la alfombrilla: poca máscara pero una caja enorme', () => {
    const pedazo = { x: 277, y: 268, w: 879, h: 432, area: 0.127, iou: 0.82 }; // caja: 41 % de la imagen
    const objeto = { x: 586, y: 435, w: 109, h: 110, area: 0.011, iou: 0.93 };
    expect(elegirRecorte([pedazo, objeto], W, H)).toBe(objeto);
  });
  it('si solo hay recortes grandes (objeto pegado a la cámara), igual devuelve uno', () => {
    const grande = cand(200, 100, 800, 500, 0.9); // ~35 % de la imagen, no toca el borde
    expect(elegirRecorte([grande], W, H)).toBe(grande);
  });
  it('sin candidatos válidos devuelve null', () => {
    expect(elegirRecorte([], W, H)).toBeNull();
    expect(elegirRecorte([cand(0, 0, W, H, 0.99)], W, H)).toBeNull(); // casi toda la imagen: es el fondo
  });
  it('detecta lo que toca el borde', () => {
    expect(tocaBorde({ x: 0, y: 100, w: 50, h: 50 }, W, H)).toBe(true);
    expect(tocaBorde({ x: 100, y: 100, w: 50, h: H - 100 }, W, H)).toBe(true);
    expect(tocaBorde({ x: 100, y: 100, w: 50, h: 50 }, W, H)).toBe(false);
  });
});

describe('siguienteRecorte (clic otra vez sobre el objeto)', () => {
  const grande = { w: 400, h: 300, area: 0.1 };
  const medio = { w: 200, h: 150, area: 0.025 };
  const chico = { w: 60, h: 50, area: 0.002 };
  const lista = [medio, chico, grande];
  it('pasa al siguiente más chico', () => {
    expect(siguienteRecorte(lista, 400 * 300)).toBe(medio);
    expect(siguienteRecorte(lista, 200 * 150)).toBe(chico);
  });
  it('después del más chico vuelve al más grande', () => {
    expect(siguienteRecorte(lista, 60 * 50)).toBe(grande);
  });
  it('compara recuadros, no máscaras: una máscara más chica con casi el mismo recuadro no cuenta', () => {
    // caso real de SAM: misma placa, máscara a la mitad pero recuadro 107×107 contra 106×100
    const casiIgual = { w: 106, h: 100, area: 0.004 };
    const parte = { w: 81, h: 62, area: 0.0013 };
    expect(siguienteRecorte([casiIgual, parte], 107 * 107)).toBe(parte);
  });
  it('ignora el fondo entero', () => {
    expect(siguienteRecorte([{ w: 1280, h: 720, area: 0.97 }, chico], 60 * 50)).toBe(chico);
  });
  it('desde un encuadre a mano también achica', () => {
    expect(siguienteRecorte(lista, 300 * 250)).toBe(medio);
  });
});
