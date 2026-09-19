import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, path.resolve(__dirname, '../..'), 'NEXT_PUBLIC_');
  const desktopEnv = loadEnv(mode, __dirname, 'VITE_');
  // Only these public values enter the desktop bundle. Server secrets stay in Next.js.
  return {
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(desktopEnv.VITE_SUPABASE_URL || rootEnv.NEXT_PUBLIC_SUPABASE_URL || ''),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(desktopEnv.VITE_SUPABASE_PUBLISHABLE_KEY || rootEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || ''),
  },
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
  };
});
