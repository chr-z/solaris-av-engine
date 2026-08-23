import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { manualChunkForId } from './src/utils/chunking'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Vendor split driven by the shared, tested strategy in src/utils/chunking.ts.
        manualChunks: manualChunkForId,
      },
    },
  },
})
