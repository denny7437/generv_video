import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@hermes/domain': r('./packages/domain/src/index.ts'),
      '@hermes/budget-guard': r('./packages/budget-guard/src/index.ts'),
      '@hermes/worker-assembly': r('./services/worker-assembly/src/index.ts'),
      '@hermes/worker-qc': r('./services/worker-qc/src/index.ts'),
      '@hermes/worker-import': r('./services/worker-import/src/index.ts'),
      '@hermes/worker-prepare': r('./services/worker-prepare/src/index.ts'),
      '@hermes/worker-publish': r('./services/worker-publish/src/index.ts'),
    },
  },
  test: {
    include: ['{packages,services,apps}/*/src/**/*.test.ts'],
    environment: 'node',
    reporters: ['default'],
    coverage: {
      reporter: ['text-summary'],
    },
  },
});
