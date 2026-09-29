// ============================================================================
// Week 10 Assignment 3: Production Hardening
// Vitest Test & Coverage Configuration
// ============================================================================
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    fileParallelism: false,
    include: [
      // Assignment 3 production hardening e2e spec
      'test/assignment3-hardening.e2e-spec.ts',
      // Assignment 2 end-to-end flow test
      'test/assignment2-e2e-flow.e2e-spec.ts',
      // Tasks service unit spec
      'src/tasks/tasks.service.spec.ts',
      // Auth service unit spec
      'src/auth/auth.service.spec.ts',
      // Database guard safety spec
      'test/setup/**/*.spec.ts',
    ],
    // Global setup: loads .env.test, verifies test DB safety guard, and runs migrations
    globalSetup: ['./test/setup/global-setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    sequence: {
      shuffle: false,
    },
    // Coverage configuration enforcing quality bar
    coverage: {
      provider: 'v8',
      enabled: true,
      include: [
        'src/health/health.service.ts',
        'src/config/app-config.service.ts',
        'src/shutdown/shutdown.service.ts',
        'src/auth/auth.service.ts',
        'src/tasks/tasks.service.ts',
        'src/projects/projects.service.ts',
        'src/comments/comments.service.ts',
        'src/users/users.service.ts',
        'src/projects/role-cache.service.ts',
        'src/app.service.ts',
      ],
      thresholds: {
        statements: 70,
        branches: 50,
        functions: 50,
        lines: 70,
      },
      reporter: ['text', 'text-summary', 'html', 'json-summary'],
      reportsDirectory: './coverage',
    },
  },
});
