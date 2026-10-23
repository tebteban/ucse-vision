import { describe, it, expect } from 'vitest';
import { iniciar, paso, aGris, diferencia, diferenciaLocal, MAX_PERDIDOS, MINI_W, MINI_H } from '../../src/seguimiento.js';

const W = 160;
const H = 90;
// Escena en gris: fondo con ruido leve y un rectángulo con textura en (x, y).
function escena(x, y, ruido = 2) {
  const f = new Uint8Array(W * H);
  for (let i = 0; i < f.length; i++) f[i] = 120 + ((Math.random() * (2 * ruido + 1)) | 0) - ruido;
  for (let j = 0; j < 20; j++) for (let i = 0; i < 30; i++) f[(y + j) * W + x + i] = (i * 7 + j * 13) % 2 ? 230 : 20;
  return f;
}

describe('seguimiento por plantilla', () => {
  it('sigue un objeto que se mueve de a pocos píxeles', () => {
    const e = iniciar(escena(40, 30), W, H, { x: 40, y: 30, w: 30, h: 20 });
    let x = 40;
    for (let k = 0; k < 15; k++) {
      x += 3;
      paso(e, escena(x, 30 + (k % 3)));
      expect(e.ok).toBe(true);
      expect(Math.abs(e.b.x - x)).toBeLessThanOrEqual(1);
    }
  });
  it('lo da por perdido si desaparece, y no antes de MAX_PERDIDOS pasos', () => {
    const e = iniciar(escena(40, 30), W, H, { x: 40, y: 30, w: 30, h: 20 });
    const vacia = () => escena(-1000, 0).map(() => 120);
    for (let k = 1; k < MAX_PERDIDOS; k++) expect(paso(e, vacia()).ok).toBe(true);
    expect(paso(e, vacia()).ok).toBe(false);
  });
  it('acota cajas fuera de la imagen', () => {
    const e = iniciar(escena(0, 0), W, H, { x: -50, y: 500, w: 9999, h: 3 });
    expect(e.b.x).toBeGreaterThanOrEqual(0);
    expect(e.b.y + e.b.h).toBeLessThanOrEqual(H);
    expect(e.b.w).toBeLessThanOrEqual(W);
    expect(() => paso(e, escena(0, 0))).not.toThrow();
  });
  it('convierte RGBA a gris', () => {
    expect(Array.from(aGris(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]), 2, 1))).toEqual([255, 0]);
  });
});

describe('cambio de escena', () => {
  const plana = (v) => new Uint8Array(MINI_W * MINI_H).fill(v);
  it('diferencia global', () => {
    expect(diferencia(plana(10), plana(10))).toBe(0);
    expect(diferencia(plana(10), plana(30))).toBe(20);
  });
  it('diferencia local solo mira alrededor del punto', () => {
    const a = plana(0);
    const b = plana(0);
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) b[y * MINI_W + x] = 200; // cambio arriba a la izquierda
    expect(diferenciaLocal(a, b, 0.05, 0.1)).toBeGreaterThan(50);
    expect(diferenciaLocal(a, b, 0.9, 0.9)).toBe(0);
  });
});
