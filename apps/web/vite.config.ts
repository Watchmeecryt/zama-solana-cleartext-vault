import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production') },
  resolve: {
    dedupe: ['@solana/kit', 'react', 'react-dom'],
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/rpc': 'http://127.0.0.1:8080',
      '/health': 'http://127.0.0.1:8080',
      '/rpc-ws': { target: 'ws://127.0.0.1:8080', ws: true },
    },
  },
});
