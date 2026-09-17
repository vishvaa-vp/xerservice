import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@packages/types': path.resolve(__dirname, '../../packages/types/src/index.ts'),
      '@packages/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@packages/printing': path.resolve(__dirname, '../../packages/printing/src/index.ts'),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: './dist',
    emptyOutDir: true,
  },
});
