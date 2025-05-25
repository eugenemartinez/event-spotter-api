import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true, // Optional: to use Vitest's globals like describe, it, expect without importing
    environment: 'node', // Essential for backend/API testing
    setupFiles: [], // You might add setup files later (e.g., for global mocks, test DB setup)
    coverage: {
      provider: 'v8', // or 'istanbul'
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'], // Adjust if your source files are elsewhere
      exclude: [ // Paths to exclude from coverage
        'src/server.ts', // Usually the main server entry point
        'src/config/**',
        'src/plugins/**', // Or specific plugin files you don't want to cover directly
        '**/*.schemas.ts', // Zod schemas are declarative, often don't need direct unit test coverage
        '**/*.d.ts',
        '**/index.ts', // Barrel files
        // Add other paths like database connection files, etc.
      ],
    },
    // Optional: If you want to specify test file patterns
    // include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
  },
});