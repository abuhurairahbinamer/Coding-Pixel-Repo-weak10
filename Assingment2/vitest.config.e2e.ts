// ============================================================================
// [W1] WARM-UP REQUIREMENT: Global setup runs migrations against test database
// [C4] CORE REQUIREMENT: Shuffled execution sequence proves test independence
// ============================================================================
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: [
      'test/assignment1-integration.e2e-spec.ts',
      'test/setup/**/*.spec.ts',
    ],
    // [W1] & [X3] Global setup: loads .env.test, verifies test DB safety guard, and runs migrations
    globalSetup: ['./test/setup/global-setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // [C4] Shuffled order support to ensure no test relies on execution order
    sequence: {
      shuffle: false, // Can be overridden via --sequence.shuffle
    },
  },
});
