import { collectCanvasFilenames, countCanvasReferencesFor, findCanvasReferences } from '@/lib/canvas-refs';
import { createTaskData, type CanvasTaskData } from '@/lib/canvas-types';
import type { CanvasTaskNode } from '@/lib/canvas-types';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * A stub storage: these modules read `window.localStorage` at call time, and a real DOM is more than
 * counting filenames needs.
 */
const store = new Map<string, string>();

function node(id: string, data: Partial<CanvasTaskData>): CanvasTaskNode {
    return { id, type: 'task', position: { x: 0, y: 0 }, data: createTaskData(data.kind ?? 'generate', data) } as CanvasTaskNode;
}

function seedRegistry(ids: string[]) {
    store.set(
        'gptImageCanvases',
        JSON.stringify({
            version: 1,
            activeId: ids[0],
            canvases: ids.map((id) => ({ id, name: id, createdAt: 1, updatedAt: 1 }))
        })
    );
}

function seedCanvas(id: string, nodes: CanvasTaskNode[]) {
    store.set(`gptImageCanvas:${id}`, JSON.stringify({ nodes }));
}

beforeEach(() => {
    store.clear();
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

describe('collectCanvasFilenames', () => {
    it('takes both the pictures a node produced and the ones it consumes', () => {
        seedRegistry(['c1']);
        seedCanvas('c1', [
            node('n1', { images: [{ filename: 'made.png', path: '/p' }] }),
            node('n2', { kind: 'edit', sourceFilenames: ['kept.png'] })
        ]);

        expect([...collectCanvasFilenames()].sort()).toEqual(['kept.png', 'made.png']);
    });

    /**
     * The property the cleanup pass depends on: a picture that only a *deleted* canvas still points
     * at is not an orphan — the user can restore that canvas and expects its pictures to be there.
     */
    it('counts canvases waiting in the recycle bin', () => {
        seedRegistry(['c1']);
        seedCanvas('c1', []);
        store.set(
            'gptImageCanvasTrash',
            JSON.stringify([
                {
                    meta: { id: 'c9', name: 'c9', createdAt: 1, updatedAt: 1 },
                    nodes: [node('n9', { images: [{ filename: 'recoverable.png', path: '/p' }] })],
                    deletedAt: 1
                }
            ])
        );

        expect(collectCanvasFilenames().has('recoverable.png')).toBe(true);
    });

    it('sees every canvas, not just the one on screen', () => {
        seedRegistry(['c1', 'c2']);
        seedCanvas('c1', [node('n1', { images: [{ filename: 'here.png', path: '/p' }] })]);
        seedCanvas('c2', [node('n2', { images: [{ filename: 'elsewhere.png', path: '/p' }] })]);

        expect(collectCanvasFilenames().has('elsewhere.png')).toBe(true);
    });
});

describe('findCanvasReferences', () => {
    it('reports only the files that would break a node', () => {
        seedRegistry(['c1']);
        seedCanvas('c1', [node('n1', { kind: 'edit', sourceFilenames: ['used.png'] })]);

        expect(findCanvasReferences(['used.png', 'loose.png'])).toEqual(['used.png']);
    });
});

describe('countCanvasReferencesFor', () => {
    it('counts one node once even when it both made and uses the picture', () => {
        seedRegistry(['c1']);
        seedCanvas('c1', [node('n1', { images: [{ filename: 'x.png', path: '/p' }], sourceFilenames: ['x.png'] })]);

        expect(countCanvasReferencesFor(['x.png', 'unknown.png']).get('x.png')).toBe(1);
    });

    it('answers zero for a picture nothing points at', () => {
        seedRegistry(['c1']);
        seedCanvas('c1', []);

        expect(countCanvasReferencesFor(['gone.png']).get('gone.png')).toBe(0);
    });
});
