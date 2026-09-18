import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    cors: true,
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:3001', ws: true, changeOrigin: true },
      '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    rollupOptions: { input: { game:'index.html',acervo:'acervo.html',editor:'editor.html' }, output: { manualChunks: { three: ['three'] } } },
  },
});
