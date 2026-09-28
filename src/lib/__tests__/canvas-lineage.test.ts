import { buildProducerIndex, buildLineageEdges, createsCycle, parentIdsOf } from '@/lib/canvas-lineage';
import { createTaskData, type CanvasTaskData } from '@/lib/canvas-types';
import type { CanvasTaskNode } from '@/lib/canvas-types';
import { describe, expect, it } from 'vitest';

function node(id: string, data: Partial<CanvasTaskData> = {}): CanvasTaskNode {
    return {
        id,
        type: 'task',
        position: { x: 0, y: 0 },
        data: createTaskData(data.kind ?? 'generate', data)
    } as CanvasTaskNode;
}

const A = node('a', { images: [{ filename: 'a.png', path: '/api/image/a.png' }] });
const B = node('b', {
    kind: 'edit',
    sourceFilenames: ['a.png'],
    images: [{ filename: 'b.png', path: '/api/image/b.png' }]
});
const C = node('c', { kind: 'edit', sourceFilenames: ['b.png'] });

describe('buildProducerIndex', () => {
    it('maps a picture to the node that produced it', () => {
        expect(buildProducerIndex([A, B]).get('b.png')).toBe('b');
    });

    it('keeps the first producer when two nodes claim the same file', () => {
        const twin = node('twin', { images: [{ filename: 'a.png', path: '/api/image/a.png' }] });
        expect(buildProducerIndex([A, twin]).get('a.png')).toBe('a');
    });
});

describe('parentIdsOf', () => {
    it('counts a node that both produced and consumes a picture only once', () => {
        const loop = node('loop', {
            images: [{ filename: 'x.png', path: '/api/image/x.png' }],
            sourceFilenames: ['x.png', 'x.png']
        });
        expect(parentIdsOf(loop, buildProducerIndex([loop]))).toEqual([]);
    });

    it('never calls a node its own parent', () => {
        expect(parentIdsOf(A, buildProducerIndex([A, B, C]))).toEqual([]);
    });
});

describe('buildLineageEdges', () => {
    it('draws one edge per source picture, from the producer to the consumer', () => {
        const edges = buildLineageEdges([A, B, C]);
        expect(edges).toHaveLength(2);
        expect(edges.map((edge) => [edge.source, edge.target])).toEqual([
            ['a', 'b'],
            ['b', 'c']
        ]);
    });

    /**
     * The two ends have to be named, not just implied: React Flow resolves a handle without an id by
     * taking the node's first one, which under ConnectionMode.Loose is the *right* dot — so dropping a
     * link on a node's left dot used to snap the rubber band onto its right one.
     */
    it('names both ends so the line cannot attach to the wrong dot', () => {
        const [edge] = buildLineageEdges([A, B]);
        expect(edge.sourceHandle).toBe('out');
        expect(edge.targetHandle).toBe('in');
    });

    it('carries the picture it stands for, so deleting the line removes that source', () => {
        const [edge] = buildLineageEdges([A, B]);
        expect(edge.data).toMatchObject({ filename: 'a.png', targetId: 'b' });
    });

    it('draws nothing for a node that feeds itself', () => {
        const selfFeeding = node('self', {
            images: [{ filename: 's.png', path: '/api/image/s.png' }],
            sourceFilenames: ['s.png']
        });
        expect(buildLineageEdges([selfFeeding])).toEqual([]);
    });
});

describe('createsCycle', () => {
    it('refuses to wire a node into its own upstream', () => {
        expect(createsCycle([A, B, C], 'c', 'a')).toBe(true);
    });

    it('refuses a link that closes a loop two steps away', () => {
        expect(createsCycle([A, B, C], 'b', 'a')).toBe(true);
    });

    it('allows a fresh branch off the same parent', () => {
        expect(createsCycle([A, B, C], 'a', 'c')).toBe(false);
    });

    it('allows wiring a node to itself to be rejected by the caller instead', () => {
        expect(createsCycle([A], 'a', 'a')).toBe(false);
    });

    /**
     * The walk has a visited set precisely so an already-broken graph cannot hang it. The answer here
     * is still "yes, that would be a loop" — z produces the picture y eats, and y feeds x.
     */
    it('answers instead of hanging when the graph already contains a loop', () => {
        const looped = [
            node('x', { kind: 'edit', sourceFilenames: ['y.png'] }),
            node('y', { kind: 'edit', sourceFilenames: ['x.png'], images: [{ filename: 'y.png', path: '/p' }] }),
            node('z', { images: [{ filename: 'x.png', path: '/p' }] })
        ];
        expect(createsCycle(looped, 'x', 'z')).toBe(true);
    });
});
