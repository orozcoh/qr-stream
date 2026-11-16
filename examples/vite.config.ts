import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/**
 * One Vite app with one page per example.
 *
 * The library entries alias to `src/` so the examples build without a prior
 * `pnpm build`, exactly like the demo.
 */
export default defineConfig({
  root: here('./'),
  plugins: [react()],
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
    rollupOptions: {
      input: {
        index: here('./index.html'),
        sender: here('./sender.html'),
        receiver: here('./receiver.html'),
        hooks: here('./hooks.html'),
      },
    },
  },
});
