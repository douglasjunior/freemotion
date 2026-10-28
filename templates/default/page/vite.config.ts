import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';


// A regular Vite app that imports the compositions from ../src and plays them in the page.
export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom'] },
  publicDir: '../public',
});
