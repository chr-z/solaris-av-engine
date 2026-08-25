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
  },
})
