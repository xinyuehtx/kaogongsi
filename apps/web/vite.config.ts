import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// GitHub Pages 部署在 /<repo>/ 下，用 VITE_BASE 注入；本地/ docker 默认 '/'。
const base = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  preview: { port: 4173 },
});
