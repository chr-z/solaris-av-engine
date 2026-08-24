import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { manualChunkForId } from './src/utils/chunking'
import { fileURLToPath } from 'node:url'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Sabor STANDALONE (desktop Tauri / on-premise): zero SDK de nuvem no
  // bundle — firebase/compat/* aponta pro stub offline local.
  const standalone = mode === 'standalone';

  return {
    plugins: [react()],
    define: {
      __SOLARIS_STANDALONE__: JSON.stringify(standalone),
    },
    resolve: standalone
      ? {
          alias: [
            {
              find: /^firebase\/compat\/app$/,
              replacement: fileURLToPath(
                new URL('./src/config/firebaseStandalone.ts', import.meta.url),
              ),
            },
            {
              find: /^firebase\/compat\/(auth|database)$/,
              // Módulos side-effect do compat: sob stub, não há nada a registrar.
              replacement: fileURLToPath(
                new URL('./src/config/standaloneSideEffect.ts', import.meta.url),
              ),
            },
          ],
        }
      : undefined,
    build: {
      rollupOptions: {
        output: {
          // Vendor split driven by the shared, tested strategy in src/utils/chunking.ts.
          manualChunks: manualChunkForId,
        },
      },
    },
  };
})
