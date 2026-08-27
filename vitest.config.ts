import { defineConfig } from 'vitest/config'

// Sem @vitejs/plugin-react aqui: no Vitest 4 o pipeline .tsx do plugin
// (@react-refresh) quebra a resolução de módulos. O oxc/esbuild nativo do
// Vite transforma JSX de teste sem o plugin (mesma correção do desktop).
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: true,
    // Testes de benchmark (perf-benchmark) medem tempo real: arquivos em
    // paralelo disputam CPU e o mesmo código oscila 2.3s→5.1s conforme o
    // escalonador. Serializa os arquivos p/ timing reproduzível.
    fileParallelism: false,
  },
})
