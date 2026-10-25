// Descripciones de objetos nuevos escritas por un LLM local (Ollama), a partir del nombre. Es opcional: sin Ollama
// el formulario de Enseñar se completa a mano. Las rutas ollama/... las reenvía electron.js (o vite en desarrollo).
const PREFERIDOS = ['qwen2.5:3b', 'llama3.2:3b', 'gemma3:4b', 'qwen2.5:1.5b']; // entran en 4 GB de VRAM y escriben bien en español

// Nombre del modelo a usar, o null si Ollama no está o no tiene modelos de texto.
export async function modeloDisponible() {
  try {
    const r = await fetch('ollama/api/tags', { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    const nombres = ((await r.json()).models ?? []).map((m) => m.name);
    return PREFERIDOS.find((p) => nombres.includes(p)) ?? nombres.find((n) => !/embed/i.test(n)) ?? null;
  } catch {
    return null;
  }
}

// Carga el modelo en la VRAM antes de que haga falta (la primera carga puede tardar más de un minuto).
export const precargar = (modelo) => fetch('ollama/api/generate', { method: 'POST', body: JSON.stringify({ model: modelo, keep_alive: '30m' }) }).catch(() => {});

const ESQUEMA = { type: 'object', properties: { resumen: { type: 'string' }, detalle: { type: 'string' } }, required: ['resumen', 'detalle'] };

// {resumen, detalle} para el objeto; ejemplo: una ficha del catálogo de la misma categoría, para copiar el estilo.
export async function describir(modelo, nombre, categoria, ejemplo, signal) {
  const prompt = `Sos docente universitario de ${categoria}. Escribí la ficha de un objeto para una exposición, en español, sin markdown.
- "resumen": una sola oración (máximo 25 palabras) que diga qué es.
- "detalle": exactamente dos párrafos de 2 o 3 oraciones cada uno (máximo 60 palabras por párrafo), separados por un salto de línea: cómo funciona, para qué se usa y datos clave. No repitas ideas. Si no estás seguro de un dato, no lo inventes.
Ejemplo de estilo:
${JSON.stringify({ resumen: ejemplo.resumen, detalle: ejemplo.detalle })}
Objeto: ${nombre}`;
  const r = await fetch('ollama/api/generate', {
    method: 'POST',
    body: JSON.stringify({ model: modelo, prompt, format: ESQUEMA, stream: false, think: false, keep_alive: '30m', options: { temperature: 0.3, repeat_penalty: 1.15 } }),
    signal: signal ?? AbortSignal.timeout(120_000), // si no se precargó, Ollama primero carga el modelo en la VRAM
  });
  if (!r.ok) throw new Error(`Ollama respondió ${r.status}`);
  const { resumen, detalle } = JSON.parse((await r.json()).response);
  if (typeof resumen !== 'string' || typeof detalle !== 'string' || !resumen.trim()) throw new Error('Respuesta incompleta del modelo');
  return { resumen: resumen.trim().slice(0, 300), detalle: detalle.trim().slice(0, 2000) }; // los maxLength del formulario
}
