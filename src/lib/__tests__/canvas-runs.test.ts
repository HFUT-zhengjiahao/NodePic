import { DEFAULT_TASK_PARAMS, type CanvasTaskNode } from '@/lib/canvas-types';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

/**
 * The provider call is replaced in every test: these tests are about what the manager *decides*, not
 * about what OpenAI answers.
 */
vi.mock('@/lib/canvas-run', () => ({ runCanvasTask: vi.fn() }));

type Runs = typeof import('@/lib/canvas-runs');

let runTask: Mock;

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

const CANVAS = 'c1';

function request(nodeId: string, previousFilenames: string[] = []) {
    return {
        canvasId: CANVAS,
        nodeId,
        input: {
            kind: 'generate' as const,
            prompt: 'a cat',
            params: { ...DEFAULT_TASK_PARAMS },
            sourceFilenames: [],
            maskFile: null,
            passwordHash: null
        },
        params: { ...DEFAULT_TASK_PARAMS },
        prompt: 'a cat',
        mode: 'generate' as const,
        previousFilenames
    };
}

const ONE_IMAGE = { images: [{ filename: 'new.png', path: '/api/image/new.png' }], usage: null };

async function fresh(): Promise<Runs> {
    vi.resetModules();
    const mocked = await import('@/lib/canvas-run');
    runTask = vi.mocked(mocked.runCanvasTask);
    return import('@/lib/canvas-runs');
}

beforeEach(() => {
    vi.clearAllMocks();
    // The manager writes finished runs straight into storage. A stub keeps that path quiet and
    // exercised instead of logging a missing `window` on every assertion.
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        writable: true,
        value: {
            localStorage: {
                get length() {
                    return store.size;
                },
                getItem: (key: string) => store.get(key) ?? null,
                setItem: (key: string, value: string) => void store.set(key, String(value)),
                removeItem: (key: string) => void store.delete(key),
                clear: () => store.clear(),
                key: () => null
            }
        }
    });
});

describe('startCanvasRun', () => {
    it('runs two nodes at once and queues the rest', async () => {
        const runs = await fresh();
        const pending = [deferred<typeof ONE_IMAGE>(), deferred<typeof ONE_IMAGE>()];
        runTask.mockImplementationOnce(() => pending[0].promise).mockImplementationOnce(() => pending[1].promise);

        expect(runs.startCanvasRun(request('n1'))).toBe('started');
        expect(runs.startCanvasRun(request('n2'))).toBe('started');
        // The third has to wait: two provider slots is the whole budget.
        expect(runs.startCanvasRun(request('n3'))).toBe('queued');

        // A board remounting mid-run must still show what is happening, or it would offer to pay again.
        expect(runs.canvasRunStatus(CANVAS).get('n3')).toBe('queued');
        expect(runs.canvasRunStatus(CANVAS).get('n1')).toBe('running');

        pending[0].resolve(ONE_IMAGE);
        await vi.waitFor(() => expect(runTask).toHaveBeenCalledTimes(3));
    });

    it('refuses to start the same node twice', async () => {
        const runs = await fresh();
        runTask.mockImplementation(() => new Promise(() => {})); // never settles

        expect(runs.startCanvasRun(request('n1'))).toBe('started');
        expect(runs.startCanvasRun(request('n1'))).toBe('ignored');
        expect(runTask).toHaveBeenCalledTimes(1);
    });
});

describe('cancelCanvasRuns', () => {
    it('never sends a queued run to the provider — that is the money it saves', async () => {
        const runs = await fresh();
        const pending = [deferred<typeof ONE_IMAGE>(), deferred<typeof ONE_IMAGE>()];
        runTask.mockImplementationOnce(() => pending[0].promise).mockImplementationOnce(() => pending[1].promise);

        runs.startCanvasRun(request('n1'));
        runs.startCanvasRun(request('n2'));
        runs.startCanvasRun(request('n3'));

        expect(runs.cancelCanvasRuns(CANVAS, ['n3'])).toEqual({ queued: 1, running: 0 });

        pending[0].resolve(ONE_IMAGE);
        pending[1].resolve(ONE_IMAGE);
        await vi.waitFor(() => expect(runs.canvasRunStatus(CANVAS).size).toBe(0));
        expect(runTask).toHaveBeenCalledTimes(2);
    });

    /**
     * A run already in flight has been paid for, so it is allowed to finish: its picture still goes to
     * the history, and only the write-back to the (now missing) node is suppressed.
     */
    it('lets a running request finish but keeps it off the node', async () => {
        const runs = await fresh();
        const pending = deferred<typeof ONE_IMAGE>();
        runTask.mockImplementation(() => pending.promise);

        const outcomes: unknown[] = [];
        runs.subscribeToCanvasRuns(CANVAS, (outcome) => outcomes.push(outcome));
        const history: unknown[] = [];
        runs.setCanvasRunCompletionSink((entry) => history.push(entry));

        runs.startCanvasRun(request('n1'));
        expect(runs.cancelCanvasRuns(CANVAS, ['n1'])).toEqual({ queued: 0, running: 1 });

        pending.resolve(ONE_IMAGE);
        await vi.waitFor(() => expect(history).toHaveLength(1));

        expect(outcomes).toHaveLength(0);
        expect(runs.pendingCanvasRunOutcomes(CANVAS)).toHaveLength(0);
        runs.setCanvasRunCompletionSink(null);
    });

    it('reports what it stopped, so a cancelled task does not look like a lost one', async () => {
        const runs = await fresh();
        runTask.mockImplementation(() => new Promise(() => {}));
        runs.startCanvasRun(request('n1'));
        runs.startCanvasRun(request('n2'));
        runs.startCanvasRun(request('n3'));

        expect(runs.cancelCanvasRuns(CANVAS)).toEqual({ queued: 1, running: 2 });
    });
});

describe('applyOutcomeToNodes', () => {
    it('points downstream nodes at the picture a re-run produced', async () => {
        const runs = await fresh();
        const nodes = [
            {
                id: 'n1',
                data: { images: [{ filename: 'old.png', path: '/p' }], sourceFilenames: [], status: 'running' }
            },
            { id: 'n2', data: { images: [], sourceFilenames: ['old.png'], sourceMissing: true } },
            { id: 'n3', data: { images: [], sourceFilenames: ['untouched.png'] } }
        ] as unknown as CanvasTaskNode[];

        const next = runs.applyOutcomeToNodes(nodes, {
            nodeId: 'n1',
            patch: { status: 'idle', images: [{ filename: 'new.png', path: '/p' }] },
            remap: [{ from: 'old.png', to: 'new.png' }]
        });

        expect(next[0].data.status).toBe('idle');
        expect(next[1].data.sourceFilenames).toEqual(['new.png']);
        expect(next[1].data.sourceMissing).toBe(false);
        // A source this run did not replace stays exactly as it was.
        expect(next[2].data.sourceFilenames).toEqual(['untouched.png']);
    });
});
