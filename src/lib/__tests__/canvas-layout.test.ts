import { NODE_HEIGHT_FALLBACK, NODE_WIDTH, arrangeByLineage } from '@/lib/canvas-layout';
import { createTaskData, type CanvasTaskData } from '@/lib/canvas-types';
import type { CanvasTaskNode } from '@/lib/canvas-types';
import { describe, expect, it } from 'vitest';

function node(id: string, data: Partial<CanvasTaskData> = {}, measured?: { width: number; height: number }) {
    return {
        id,
        type: 'task',
        position: { x: 0, y: 0 },
        measured,
        data: createTaskData(data.kind ?? 'generate', data)
    } as CanvasTaskNode;
}

/** The x gap arrangeByLineage leaves between columns. */
const GAP_X = 110;
/** The y gap it leaves between stacked cards. */
const GAP_Y = 56;

describe('arrangeByLineage', () => {
    it('has nothing to say about an empty board', () => {
        expect(arrangeByLineage([]).size).toBe(0);
    });

    it('puts a consumer one column right of everything it depends on', () => {
        const chain = [
            node('a', { images: [{ filename: 'a.png', path: '/p' }] }),
            node('b', { kind: 'edit', sourceFilenames: ['a.png'], images: [{ filename: 'b.png', path: '/p' }] }),
            node('c', { kind: 'edit', sourceFilenames: ['b.png'] })
        ];
        const placed = arrangeByLineage(chain);

        expect(placed.get('a')?.x).toBe(0);
        expect(placed.get('b')?.x).toBe(NODE_WIDTH + GAP_X);
        expect(placed.get('c')?.x).toBe((NODE_WIDTH + GAP_X) * 2);
    });

    it('stacks a column without overlapping cards', () => {
        const siblings = [
            node('root', { images: [{ filename: 'r.png', path: '/p' }] }, { width: NODE_WIDTH, height: 300 }),
            node('s1', { kind: 'edit', sourceFilenames: ['r.png'] }, { width: NODE_WIDTH, height: 200 }),
            node('s2', { kind: 'edit', sourceFilenames: ['r.png'] }, { width: NODE_WIDTH, height: 400 })
        ];
        const placed = arrangeByLineage(siblings);

        // Grouped by column: cards stacked beside each other are allowed to sit at the same height.
        const columns = new Map<number, Array<{ y: number; height: number }>>();
        for (const item of siblings) {
            const x = placed.get(item.id)?.x ?? 0;
            const column = columns.get(x) ?? [];
            column.push({ y: placed.get(item.id)?.y ?? 0, height: item.measured?.height ?? 0 });
            columns.set(x, column);
        }

        for (const column of columns.values()) {
            column.sort((left, right) => left.y - right.y);
            for (let index = 1; index < column.length; index += 1) {
                expect(column[index].y).toBeGreaterThanOrEqual(column[index - 1].y + column[index - 1].height);
            }
        }
    });

    it('centres every column on the same axis', () => {
        // A chain is one node per column, so both cards land on the centre line rather than being
        // stacked — the tree reads as a band rather than a staircase.
        const chain = [
            node('a', { images: [{ filename: 'a.png', path: '/p' }] }, { width: NODE_WIDTH, height: 300 }),
            node('b', { kind: 'edit', sourceFilenames: ['a.png'] }, { width: NODE_WIDTH, height: 300 })
        ];
        const placed = arrangeByLineage(chain);
        expect(placed.get('a')?.y).toBe(placed.get('b')?.y);
    });

    it('falls back to a guessed height for a card it has not measured yet', () => {
        const twoSiblingsOfOneParent = [
            node('root', { images: [{ filename: 'r.png', path: '/p' }] }),
            node('s1', { kind: 'edit', sourceFilenames: ['r.png'] }),
            node('s2', { kind: 'edit', sourceFilenames: ['r.png'] })
        ];
        const placed = arrangeByLineage(twoSiblingsOfOneParent);
        const siblings = [placed.get('s1')?.y ?? 0, placed.get('s2')?.y ?? 0].sort((a, b) => a - b);
        expect(siblings[1] - siblings[0]).toBe(NODE_HEIGHT_FALLBACK + GAP_Y);
    });

    it('lays out a graph that closes a loop instead of hanging', () => {
        const looped = [
            node('x', { kind: 'edit', sourceFilenames: ['y.png'], images: [{ filename: 'x.png', path: '/p' }] }),
            node('y', { kind: 'edit', sourceFilenames: ['x.png'], images: [{ filename: 'y.png', path: '/p' }] })
        ];
        const placed = arrangeByLineage(looped);
        expect(placed.size).toBe(2);
        expect(Number.isFinite(placed.get('x')?.y ?? NaN)).toBe(true);
    });

    it('leaves an unconnected node in the first column', () => {
        const placed = arrangeByLineage([node('lonely')]);
        expect(placed.get('lonely')).toEqual({ x: 0, y: -NODE_HEIGHT_FALLBACK / 2 });
    });
});
