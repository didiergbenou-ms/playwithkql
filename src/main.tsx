import { createRoot } from 'react-dom/client';
import { lazy, Suspense } from 'react';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { GameplayLoadError } from './game/GameplayLoadError';
import './styles.css';
import './ui/difficulty.css';

let resetRoot = () => window.location.reload();
const loadRoot = async () => {
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('author') === '1') {
    resetRoot = () => window.location.assign(`${window.location.pathname}?author=1`);
    await import('./dev/contentPreview.css');
    return import('./dev/ContentPreview');
  }

  // Do not even initialize persisted state (including migrations) in preview.
  const [app, { useStore }] = await Promise.all([import('./App'), import('./state/store')]);
  resetRoot = () => useStore.getState().setScreen('menu');
  return app;
};
const Root = lazy(() => loadRoot().catch((error: unknown) => {
  throw new GameplayLoadError(error);
}));

// No StrictMode: its double-invoked effects would tear down and rebuild the
// WebGL context on every mount, which Phaser does not enjoy.
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary onReset={() => resetRoot()}>
    <Suspense fallback={<div className="screen" role="status">Loading content...</div>}>
      <Root />
    </Suspense>
  </ErrorBoundary>,
);
