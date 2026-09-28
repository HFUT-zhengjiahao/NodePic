import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Runs with `npm test`, and as part of `npm run check`.
 *
 * Only the canvas' pure modules are covered for now — the lineage graph, the layout pass, the import
 * scrubber, the file-reference counting and the run manager. They were chosen because they are the
 * parts where a wrong answer costs money (a run started twice) or data (a file cleaned up while a
 * canvas still points at it), and because none of them needs a browser to be asked about it.
 *
 * Node environment, not jsdom: these modules touch `localStorage` only through lib/canvas-store,
 * which is written to survive a missing `window`, so the tests that need storage install a stub
 * rather than pulling in a DOM implementation.
 */
export default defineConfig({
    resolve: {
        alias: { '@': path.join(root, 'src') }
    },
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts']
    }
});
