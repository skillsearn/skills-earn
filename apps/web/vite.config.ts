import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // no-store: some embedded preview browsers cache dev modules and then mix stale and fresh code.
  server: { port: 5173, strictPort: true, headers: { 'Cache-Control': 'no-store' } },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
});
