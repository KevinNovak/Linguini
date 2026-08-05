import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            include: ['src/**'],
            // Pure re-export barrels and the CLI bin entry — no logic to cover.
            exclude: ['src/index.ts', 'src/compiler/index.ts', 'src/cli/index.ts'],
        },
    },
});
