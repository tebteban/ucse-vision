// Cuál de los recortes que propone SAM se usa para un clic. Funciones puras (se prueban sin navegador).
// Cada candidato: {x, y, w, h} en px de la imagen, area (fracción de la imagen), iou.
export const MAX_AREA = 0.6; // una máscara que cubre más que esto es el fondo, no el objeto
// En el primer clic, un recorte cuya CAJA ocupa más que esto de la imagen, o que toca el borde, suele ser la mesa o
// una alfombrilla bajo el objeto (a veces SAM da solo un pedazo irregular de ella: poca máscara en una caja enorme).
// Medido sobre 125 clics de SAM en objetos chicos: 123 bien con estas reglas, 109 con la anterior.
export const MAX_CAJA_PRIMERO = 0.3;
export const MIN_IOU = 0.5; // confianza mínima que SAM se da a sí mismo para aceptar una máscara

const MARGEN = 0.005; // fracción del ancho y del alto que cuenta como "pegado al borde"
export const tocaBorde = (c, ancho, alto) =>
  c.x <= ancho * MARGEN || c.y <= alto * MARGEN || c.x + c.w >= ancho * (1 - MARGEN) || c.y + c.h >= alto * (1 - MARGEN);

const masGrande = (cs) => cs.reduce((m, c) => (!m || c.area > m.area ? c : m), null);
const confiables = (cs) => cs.filter((c) => c.iou >= MIN_IOU);
const lleno = (c, ancho, alto) => (c.area * ancho * alto) / (c.w * c.h); // qué parte de su caja ocupa la máscara
const contiene = (a, b) => a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h;
// Un recorte casi vacío que encierra a otro confiable al menos el doble de lleno es lo que rodea al objeto
// (un pedazo de alfombrilla alrededor), no el objeto.
const esAlrededor = (c, cs, ancho, alto) =>
  cs.some((o) => o !== c && o.iou >= MIN_IOU && contiene(c, o) && lleno(o, ancho, alto) >= 2 * lleno(c, ancho, alto));

// Primer clic: la más grande de las confiables que no sea enorme, ni toque el borde, ni solo rodee al objeto (un
// punto da máscaras de parte, de objeto y de lo que lo rodea). Si ninguna cumple, se relaja de a una condición.
export function elegirRecorte(candidatos, ancho, alto) {
  const validos = candidatos.filter((c) => c.area < MAX_AREA && !esAlrededor(c, candidatos, ancho, alto));
  const sinBorde = validos.filter((c) => !tocaBorde(c, ancho, alto));
  const chicos = sinBorde.filter((c) => (c.w * c.h) / (ancho * alto) < MAX_CAJA_PRIMERO);
  return masGrande(confiables(chicos)) ?? masGrande(confiables(sinBorde)) ?? masGrande(confiables(validos)) ?? [...validos].sort((a, b) => b.iou - a.iou)[0] ?? null;
}

// Clic de nuevo sobre el objeto fijado (cajaActual: px² de su recuadro): el siguiente recuadro visiblemente más
// chico; después del más chico, el más grande. Se comparan recuadros, no máscaras: es lo que se ve.
export function siguienteRecorte(candidatos, cajaActual) {
  const caja = (c) => c.w * c.h;
  const opciones = candidatos.filter((c) => c.area < 0.95).sort((a, b) => caja(b) - caja(a));
  return opciones.find((c) => caja(c) < cajaActual * 0.85) ?? opciones[0] ?? null;
}
