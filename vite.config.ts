import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
const icons = { '/icons': { target: 'https://wiki.rustclash.com', changeOrigin: true, rewrite: (p: string) => p.replace(/^\/icons/, '/img/items180') } };

export default defineConfig({
  plugins: [react()],
  server: { proxy: icons },
  preview: { proxy: icons },
})
