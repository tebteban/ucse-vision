import { StrictMode, Component } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App.jsx';

// Si la interfaz falla por un error no previsto, se muestra un aviso con un botón para recuperarla
// en lugar de dejar la pantalla en blanco en medio de una demo.
class Recuperable extends Component {
  state = { error: null, intento: 0 };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('La interfaz falló:', error, info.componentStack);
  }
  render() {
    if (!this.state.error) return <App key={this.state.intento} />;
    return (
      <div className="caida" role="alert">
        <h1>Algo falló en la interfaz</h1>
        <p>La cámara y los modelos siguen cargados. Tocá el botón para volver a empezar.</p>
        <button className="pill primario" onClick={() => this.setState((s) => ({ error: null, intento: s.intento + 1 }))}>Volver a empezar</button>
      </div>
    );
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Recuperable />
  </StrictMode>,
);
