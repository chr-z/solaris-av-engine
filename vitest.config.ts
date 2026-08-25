import { defineConfig } from 'vitest/config'

// Sem @vitejs/plugin-react aqui: no Vitest 4 o pipeline .tsx do plugin
// (@react-refresh) quebra a resolução de módulos. O oxc/esbuild nativo do
// Vite transforma JSX de teste sem o plugin (mesma correção do desktop).
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: true,
  },
})
