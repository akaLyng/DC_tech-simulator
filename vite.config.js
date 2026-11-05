import { defineConfig } from 'vite';

export default defineConfig({
  // relative asset paths, so the build runs from any sub-path (GitHub Pages, itch.io)
  base: './',
  build: {
    // three.js alone is ~600 kB minified
    chunkSizeWarningLimit: 1000,
  },
});
