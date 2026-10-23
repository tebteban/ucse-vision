import { useEffect } from 'react';
import { motion, AnimatePresence, animate, useMotionValue, useTransform } from 'motion/react';
import { Aperture, Check, Loader2 } from 'lucide-react';

// Número que se anima desde el valor anterior hasta el nuevo.
export function Numero({ valor, sufijo = '', decimales = 0 }) {
  const mv = useMotionValue(valor);
  const texto = useTransform(mv, (v) => v.toFixed(decimales) + sufijo);
  useEffect(() => {
    const a = animate(mv, valor, { duration: 0.8, ease: [0.22, 1, 0.36, 1] });
    return () => a.stop();
  }, [mv, valor]);
  return <motion.span>{texto}</motion.span>;
}

// Medidor circular (0-1); por defecto muestra el porcentaje animado en el centro.
export function Anillo({ valor, color = 'var(--ink)', tam = 88, etiqueta = 'similitud', contenido }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const lleno = Math.max(0, Math.min(1, valor));
  return (
    <div className="anillo" style={{ width: tam, height: tam }}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r={r} className="anillo-fondo" />
        <motion.circle
          cx="50"
          cy="50"
          r={r}
          className="anillo-valor"
          style={{ stroke: color }}
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - lleno) }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="anillo-texto">
        {contenido ?? <Numero valor={Math.round(valor * 100)} sufijo="%" />}
        <small>{etiqueta}</small>
      </div>
    </div>
  );
}

// Pantalla de inicio (banda negra) mientras cargan los modelos y la cámara.
export function Splash({ visible, pasos }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="splash"
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          role="status"
          aria-live="polite"
        >
          <motion.div
            className="splash-logo"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 180, damping: 16 }}
          >
            <motion.span animate={{ rotate: 360 }} transition={{ duration: 8, repeat: Infinity, ease: 'linear' }} style={{ display: 'inline-flex' }}>
              <Aperture size={40} strokeWidth={1.6} aria-hidden="true" />
            </motion.span>
          </motion.div>
          <motion.h1 initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.12, duration: 0.5 }}>
            UCSE Vision
          </motion.h1>
          <motion.p className="splash-sub" initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.22, duration: 0.5 }}>
            Reconocimiento de objetos con inteligencia artificial
          </motion.p>
          <ul className="splash-pasos">
            {pasos.map(([texto, listo], i) => (
              <motion.li key={texto} initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.35 + i * 0.08 }} className={listo ? 'listo' : ''}>
                <span className="splash-ico">{listo ? <Check size={14} aria-hidden="true" /> : <Loader2 size={14} className="giro" aria-hidden="true" />}</span>
                {texto}
              </motion.li>
            ))}
          </ul>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
