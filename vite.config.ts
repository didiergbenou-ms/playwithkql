import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Asset URLs are absolute from the site root by default, which is how Azure
// Static Web Apps serves the app. If it is ever hosted under a sub-path
// instead (a GitHub Pages project site, or a path-routed environment), set
// BASE_PATH to that prefix or every asset request 404s. Kept as an env switch
// rather than a hardcoded value because dev, preview and prod differ.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [react()],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/phaser')) return 'phaser';
          return undefined;
        },
      },
    },
  },
});
