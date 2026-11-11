import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: {
        index: here('./src/index.ts'),
        browser: here('./src/browser.ts'),
        react: here('./src/react/index.ts'),
        qr: here('./src/qr.ts'),
        zxing: here('./src/browser/decoders/zxing.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', 'qrcode-generator', 'zxing-wasm/reader'],
    },
  },
});
