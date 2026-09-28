import type { CanvasTaskNode } from '@/lib/canvas-types';
import { MarkerType, type Edge } from '@xyflow/react';

/** Re-exported so the modules that already talk about "canvas task nodes" keep one import. */
export type { CanvasTaskNode };

/** Shared look for every lineage edge: smooth left-to-right curve with an arrow head. */
export const LINEAGE_EDGE_STYLE = { stroke: '#a5b4fc', strokeWidth: 2 } as const;
export const LINEAGE_EDGE_MARKER = {
    type: MarkerType.ArrowClosed,
    color: '#a5b4fc',
    width: 18,
    height: 18
} as const;

/** Payload every derived edge carries, so a deletion maps back to a source picture. */
export type LineageEdgeData = {
    filename: string;
    targetId: string;
};

/**
 * The ids of the two connection dots, one per end of a lineage line: `out` is the node's right dot
 * (this node's picture leaves here), `in` is its left dot (a picture enters here).
 *
 * The names are load-bearing, not decoration. React Flow looks a handle up by id
 * (`getHandle(nodeId, handleType, handleId, …)`) and, when the id is empty, silently falls back to the
 * node's *first* handle of `[...source, ...target]` — which under `ConnectionMode.Loose` (this board)
 * is always the **right** dot. Handles without ids therefore made the drag rubber band snap to the
 * right dot no matter which dot the pointer was over: dropping a link on a node's left dot drew the
 * curve onto its right dot and bent it the wrong way. An explicit id on both handles — and on the
 * derived edge below — keeps every lookup exact instead of order-dependent.
 */
export const HANDLE_IN = 'in';
export const HANDLE_OUT = 'out';

/**
 * Which node produced each picture, indexed by filename (first producer wins).
 *
 * Three copies of this loop used to live inside `canvas-board.tsx` — in the edge builder, in the
 * cycle check and in the layout pass — and any change to one of them silently drifted from the
 * others. This is the only one now.
 */
export function buildProducerIndex(nodes: readonly CanvasTaskNode[]): Map<string, string> {
    const producedBy = new Map<string, string>();
    for (const node of nodes) {
        for (const image of node.data.images) {
            if (!producedBy.has(image.filename)) producedBy.set(image.filename, node.id);
        }
    }
    return producedBy;
}

/**
 * The ids of the nodes whose pictures this node uses as sources.
 *
 * Split out of `parentsOf` because the layout pass needs it for every node at once: it keeps one
 * producer index for the whole graph instead of rebuilding one per node.
 */
export function parentIdsOf(node: CanvasTaskNode, producerIndex: Map<string, string>): string[] {
    const parents = node.data.sourceFilenames
        .map((filename) => producerIndex.get(filename))
        .filter((id): id is string => Boolean(id) && id !== node.id);
    // A node that lists the same picture twice is still one parent.
    return [...new Set(parents)];
}

/** Ids of the nodes that produced the given node's source pictures. */
export function parentsOf(
    nodes: readonly CanvasTaskNode[],
    nodeId: string,
    producerIndex: Map<string, string> = buildProducerIndex(nodes)
): string[] {
    const node = nodes.find((item) => item.id === nodeId);
    return node ? parentIdsOf(node, producerIndex) : [];
}

/**
 * The lineage lines implied by the source lists.
 *
 * Edges are NOT state: `sourceFilenames` is the single source of truth, and deriving the lines from
 * it is what stops "the line is gone but the node still uploads that picture" from happening.
 */
export function buildLineageEdges(nodes: readonly CanvasTaskNode[]): Edge[] {
    const producedBy = buildProducerIndex(nodes);

    const edges: Edge[] = [];
    for (const node of nodes) {
        for (const filename of node.data.sourceFilenames) {
            const parentId = producedBy.get(filename);
            if (!parentId || parentId === node.id) continue;
            edges.push({
                id: `e:${parentId}->${node.id}#${filename}`,
                source: parentId,
                target: node.id,
                // Both ends are named so the line attaches to the two dots by identity rather than by
                // "whichever handle happens to be first" (see HANDLE_IN / HANDLE_OUT).
                sourceHandle: HANDLE_OUT,
                targetHandle: HANDLE_IN,
                type: 'default',
                animated: true,
                style: LINEAGE_EDGE_STYLE,
                markerEnd: LINEAGE_EDGE_MARKER,
                data: { filename, targetId: node.id } satisfies LineageEdgeData
            });
        }
    }
    return edges;
}

/**
 * True when wiring `source` into `target` would close a loop, i.e. `target` is already upstream of
 * `source`. Walks the parent chain with a visited set so a cycle cannot hang the loop.
 */
export function createsCycle(
    nodes: readonly CanvasTaskNode[],
    source?: string | null,
    target?: string | null
): boolean {
    if (!source || !target || source === target) return false;
    const producerIndex = buildProducerIndex(nodes);

    const seen = new Set<string>();
    const stack: string[] = [source];
    while (stack.length > 0) {
        const current = stack.pop() as string;
        if (current === target) return true;
        if (seen.has(current)) continue;
        seen.add(current);
        stack.push(...parentsOf(nodes, current, producerIndex));
    }
    return false;
}
