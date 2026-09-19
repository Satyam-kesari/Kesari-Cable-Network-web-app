import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      port: Number(env.VITE_PORT || 5190), strictPort: true,
      proxy: { '/api': `http://127.0.0.1:${env.VITE_API_PORT || env.PORT || 5191}` },
    },
    preview: { port: 5192, strictPort: true },
  };
});
