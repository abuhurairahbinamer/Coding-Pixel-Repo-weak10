// ============================================================================
// Week 10 Assignment 2: End-to-end flow and a coverage threshold
// [C3] CORE REQUIREMENT: Enforce a coverage threshold — at least 70% statements
//      on services — so the build fails when coverage drops below it.
// [X3] CHALLENGE: Shuffled execution proves the flow is repeatable.
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
      // Assignment 2 end-to-end flow test
      'test/assignment2-e2e-flow.e2e-spec.ts',
      // Tasks service unit spec for comprehensive service coverage
      'src/tasks/tasks.service.spec.ts',
      // Database guard safety spec
      'test/setup/**/*.spec.ts',
    ],
    // [W1] & [X3] Global setup: loads .env.test, verifies test DB safety guard, and runs migrations
    globalSetup: ['./test/setup/global-setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // [X3] Shuffled order support to prove the flow is repeatable
    sequence: {
      shuffle: false, // Can be overridden via --sequence.shuffle
    },
    // [C3] Coverage configuration with threshold enforcement
    coverage: {
      provider: 'v8',
      enabled: true,
      // [C3] Scope coverage to service files
      include: [
        'src/auth/auth.service.ts',
        'src/tasks/tasks.service.ts',
        'src/projects/projects.service.ts',
        'src/comments/comments.service.ts',
        'src/users/users.service.ts',
        'src/projects/role-cache.service.ts',
        'src/app.service.ts',
      ],
      // [C3] Coverage threshold: at least 70% statements on services
      // WHY: A threshold turns coverage from a number nobody reads into a gate
      //      that stops a regression.
      // CHECK: Deleting one test drops coverage and fails the command;
      //        restoring the test makes it pass again.
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
