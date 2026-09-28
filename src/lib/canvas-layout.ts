import { buildProducerIndex, parentIdsOf, type CanvasTaskNode } from '@/lib/canvas-lineage';

/**
 * Rendered node width; used to keep new nodes inside the visible area.
 *
 * Keep in sync with the card itself (`w-[380px]` in `task-node.tsx`).
 */
export const NODE_WIDTH = 380;
/** Rough node height, for the same reason. */
export const NODE_HEIGHT_FALLBACK = 340;
/** Spacing the auto-arrange pass leaves between columns and between stacked cards. */
const LAYOUT_GAP_X = 110;
const LAYOUT_GAP_Y = 56;

/**
 * Lays the graph out left-to-right by lineage and removes every overlap.
 *
 * Nodes are grouped into layers by walking their sources (a node always sits one column right of the
 * deepest node it depends on), then stacked inside the column using their *measured* height —
 * collapsed and expanded cards differ by hundreds of pixels, so guessing a constant height would
 * leave gaps or overlaps. Columns are ordered by the average y of their parents to keep the lineage
 * lines short.
 *
 * Pure: it returns positions instead of writing them, so the layout can be reasoned about (and
 * tested) without mounting React Flow.
 */
export function arrangeByLineage(nodes: readonly CanvasTaskNode[]): Map<string, { x: number; y: number }> {
    if (nodes.length === 0) return new Map();

    const producerIndex = buildProducerIndex(nodes);
    const heightOf = (node: CanvasTaskNode) => node.measured?.height ?? NODE_HEIGHT_FALLBACK;

    // Who each node depends on, from the one shared derivation (see canvas-lineage.ts).
    const parents = new Map<string, string[]>();
    for (const node of nodes) parents.set(node.id, parentIdsOf(node, producerIndex));

    // Longest-path layering, with a visited set so an accidental cycle cannot hang the layout.
    const layers = new Map<string, number>();
    const layerOf = (id: string, seen: Set<string>): number => {
        const known = layers.get(id);
        if (known !== undefined) return known;
        if (seen.has(id)) return 0;
        seen.add(id);
        const upstream = parents.get(id) ?? [];
        const value = upstream.length === 0 ? 0 : Math.max(...upstream.map((parent) => layerOf(parent, seen))) + 1;
        layers.set(id, value);
        return value;
    };
    for (const node of nodes) layerOf(node.id, new Set());

    const columns = new Map<number, CanvasTaskNode[]>();
    for (const node of nodes) {
        const index = layers.get(node.id) ?? 0;
        const column = columns.get(index) ?? [];
        column.push(node);
        columns.set(index, column);
    }

    const placed = new Map<string, { x: number; y: number }>();
    const averageParentY = (node: CanvasTaskNode) => {
        const ys = (parents.get(node.id) ?? [])
            .map((parent) => placed.get(parent)?.y)
            .filter((y): y is number => y !== undefined);
        return ys.length > 0 ? ys.reduce((sum, y) => sum + y, 0) / ys.length : node.position.y;
    };

    let cursorX = 0;
    for (const index of [...columns.keys()].sort((a, b) => a - b)) {
        const column = columns.get(index) as CanvasTaskNode[];
        column.sort((a, b) => averageParentY(a) - averageParentY(b));

        const totalHeight =
            column.reduce((sum, node) => sum + heightOf(node), 0) + LAYOUT_GAP_Y * Math.max(0, column.length - 1);
        // Centre every column on the same axis so the tree reads as one band.
        let cursorY = -totalHeight / 2;
        for (const node of column) {
            placed.set(node.id, { x: cursorX, y: cursorY });
            cursorY += heightOf(node) + LAYOUT_GAP_Y;
        }
        cursorX += NODE_WIDTH + LAYOUT_GAP_X;
    }

    return placed;
}
