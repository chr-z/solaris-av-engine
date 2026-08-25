import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    // React transform only for JSX-bearing files: under vitest 4 the refresh
    // runtime injection breaks pure .ts test files ("file:///@react-refresh").
    react({ include: /\.(jsx|tsx)$/ }),
  ],
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
