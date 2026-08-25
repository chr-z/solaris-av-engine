import { defineConfig } from 'vitest/config'

// NOTA: sem @vitejs/plugin-react aqui. A versão 3.x do plugin injeta
// `@react-refresh` de forma incompatível com o pipeline do Vitest 4 para
// arquivos .tsx ("The argument 'filename' must be a file URL object...").
// O transform JSX nativo (esbuild, guiado pelo tsconfig jsx=react-jsx)
// cobre os testes de componentes sem o plugin.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: true,
  },
})
