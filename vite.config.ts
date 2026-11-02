import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri 开发服务器固定端口；构建产物输出到 dist，由 tauri.conf.json 引用
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: 'chrome105', outDir: 'dist', emptyOutDir: true },
});
