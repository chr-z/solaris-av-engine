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
  },
})
