import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  root: here('./'),
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'qr-stream',
        short_name: 'qr-stream',
        description: 'Move a JSON file between two devices with animated QR codes',
        theme_color: '#101014',
        background_color: '#101014',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        // The QR decoder is a .wasm asset. Without this pattern the receiver
        // works online and fails in the airgap, which is the whole point.
        globPatterns: ['**/*.{js,css,html,svg,png,wasm}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: {
      '@orozcoh/qr-stream/browser/zxing': here('../src/browser/decoders/zxing.ts'),
      '@orozcoh/qr-stream/react': here('../src/react/index.ts'),
      '@orozcoh/qr-stream/browser': here('../src/browser.ts'),
      '@orozcoh/qr-stream/qr': here('../src/qr.ts'),
      '@orozcoh/qr-stream': here('../src/index.ts'),
    },
  },
  build: {
    outDir: here('./dist'),
    emptyOutDir: true,
  },
});
