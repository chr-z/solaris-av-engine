import { defineConfig } from 'vitest/config'

// t15: sem o plugin @vitejs/plugin-react aqui — ele injeta o preamble de
// react-refresh (@react-refresh) que explode no vitest 4 em jsdom
// ("The argument 'filename' must be a file URL..."). O esbuild do vite
// transforma .tsx/.jsx nativamente pro run de testes; o BUILD continua
// usando o vite.config.ts com o plugin intacto.

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
