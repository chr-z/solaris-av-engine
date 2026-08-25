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
    plugins: [
      react(),
      {
        // P3 (zero-nuvem no desktop): o index.html fonte carrega os loaders
        // Google (gapi + GIS) para o sabor web; no standalone eles são
        // removidos do SHELL — senão o WebView tenta buscar apis.google.com e
        // accounts.google.com mesmo com o app em modo local.
        name: 'strip-cloud-loaders-when-standalone',
        transformIndexHtml(html) {
          if (!standalone) return html;
          return html
            .replace(/<script[^>]*src="https:\/\/apis\.google\.com\/[^"]*"[^>]*>\s*<\/script>\s*/i, '')
            .replace(/<script[^>]*src="https:\/\/accounts\.google\.com\/[^"]*"[^>]*>\s*<\/script>\s*/i, '');
        },
      },
    ],
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
      // Sabor desktop escreve em dist-desktop/: o tauri.conf.json consome este
      // diretório, então builds cloud concorrentes (`npm run build`) NUNCA mais
      // contaminam o input embutido no executável.
      outDir: standalone ? 'dist-desktop' : 'dist',
      emptyOutDir: true,
      rollupOptions: {
        output: {
          // Vendor split driven by the shared, tested strategy in src/utils/chunking.ts.
          manualChunks: manualChunkForId,
        },
      },
    },
  };
})
