import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, 'migrations')),
          MEDIA_SIGNING_KEY: 'test-only-signing-key-not-a-secret',
        },
      },
    })),
  ],
  // Some scenario tests make 100+ requests; 5 s is too tight on a busy machine.
  test: { setupFiles: ['./test/apply-migrations.ts'], testTimeout: 20_000 },
});
