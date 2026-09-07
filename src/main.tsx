import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { useStore } from './state/store';
import './styles.css';

// No StrictMode: its double-invoked effects would tear down and rebuild the
// WebGL context on every mount, which Phaser does not enjoy.
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary onReset={() => useStore.getState().setScreen('menu')}>
    <App />
  </ErrorBoundary>,
);
