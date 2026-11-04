import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  envDir: fileURLToPath(new URL('.', import.meta.url)),
  envPrefix: 'VITE_',
  define: {
    'import.meta.env.VITE_VAIMOTO_APP_ID': JSON.stringify('driver')
  },
  server: {
    host: true,
    port: 5174,
    allowedHosts: ['.monkeycode-ai.live']
  },
  preview: {
    host: true,
    port: 5174,
    allowedHosts: ['.monkeycode-ai.live']
  }
});
