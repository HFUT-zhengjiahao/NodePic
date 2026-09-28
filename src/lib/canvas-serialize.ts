import { DEFAULT_TASK_PARAMS } from '@/lib/canvas-types';
import { imageUrl } from '@/lib/image-url';
import type { CanvasTaskNode } from '@/lib/canvas-lineage';

export const CANVAS_EXPORT_KIND = 'gpt-image-playground-canvas';
export const CANVAS_EXPORT_VERSION = 1;

export type CanvasExport = {
    kind: typeof CANVAS_EXPORT_KIND;
    version: number;
    exportedAt: string;
    nodes: Array<{ id: string; position: { x: number; y: number }; data: CanvasTaskNode['data'] }>;
};

/** `canvas-2026-09-22-20-31-05.json` — colons would be illegal in a filename on Windows. */
export function canvasExportFilename(now: Date = new Date()): string {
    return `canvas-${now.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
}

export function buildCanvasExport(nodes: readonly CanvasTaskNode[], now: Date = new Date()): CanvasExport {
    return {
        kind: CANVAS_EXPORT_KIND,
        version: CANVAS_EXPORT_VERSION,
        exportedAt: now.toISOString(),
        nodes: nodes.map((node) => ({ id: node.id, position: node.position, data: node.data }))
    };
}

/** Node status a stored/imported record is allowed to come back with. */
function settleStatus(status: unknown): CanvasTaskNode['data']['status'] {
    return status === 'running' || status === 'queued' ? 'idle' : (status as CanvasTaskNode['data']['status']);
}

const KINDS: ReadonlyArray<CanvasTaskNode['data']['kind']> = ['generate', 'edit', 'image'];

function settleKind(kind: unknown): CanvasTaskNode['data']['kind'] {
    return KINDS.includes(kind as CanvasTaskNode['data']['kind'])
        ? (kind as CanvasTaskNode['data']['kind'])
        : 'generate';
}

/** Finite numbers only: `NaN` positions place a node somewhere no camera can find. */
function settlePosition(position: unknown): { x: number; y: number } {
    const candidate = position as { x?: unknown; y?: unknown } | null | undefined;
    const x = Number(candidate?.x);
    const y = Number(candidate?.y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : { x: 0, y: 0 };
}

/**
 * Keeps only the image entries the renderer can actually use, and fills in a `path` for the ones
 * that predate it.
 *
 * A saved record with `images: [null]` used to render `image.path` on `undefined` and take the whole
 * board down with it; the offending entries are dropped instead.
 */
function settleImages(images: unknown[]): CanvasTaskNode['data']['images'] {
    const settled: CanvasTaskNode['data']['images'] = [];
    for (const entry of images) {
        if (!entry || typeof entry !== 'object') continue;
        const candidate = entry as { filename?: unknown; path?: unknown };
        if (typeof candidate.filename !== 'string' || !candidate.filename) continue;
        settled.push({
            filename: candidate.filename,
            path: typeof candidate.path === 'string' && candidate.path ? candidate.path : imageUrl(candidate.filename)
        });
    }
    return settled;
}

/**
 * Turns a stored or imported node into something safe to render.
 *
 * Persisted records were trusted blindly before: one bad `images` value made the edge builder throw
 * mid-render and took the whole board down. Every field the renderer depends on is now checked, and
 * anything unusable is dropped rather than rendered.
 */
export function sanitizeCanvasNode(node: unknown): CanvasTaskNode | null {
    if (!node || typeof node !== 'object') return null;
    const candidate = node as Partial<CanvasTaskNode> & { data?: Record<string, unknown> };
    if (typeof candidate.id !== 'string' || !candidate.id) return null;

    const data = (candidate.data ?? {}) as Record<string, unknown>;
    if (!Array.isArray(data.images) || !Array.isArray(data.sourceFilenames)) return null;

    return {
        ...candidate,
        type: 'task',
        selected: false,
        position: settlePosition(candidate.position),
        data: {
            ...(data as unknown as CanvasTaskNode['data']),
            // Merging over the defaults keeps older exports (and hand-edited files) renderable
            // instead of crashing the board on a missing parameter.
            params: { ...DEFAULT_TASK_PARAMS, ...((data.params as object | undefined) ?? {}) },
            kind: settleKind(data.kind),
            images: settleImages(data.images),
            sourceFilenames: data.sourceFilenames.filter(
                (filename): filename is string => typeof filename === 'string' && Boolean(filename)
            ),
            // A canvas saved mid-run must not come back as "running".
            status: settleStatus(data.status)
        }
    } as CanvasTaskNode;
}

/** Beyond this a "canvas" is a data file, not something anyone drew. */
const MAX_IMPORT_NODES = 2000;

/**
 * Reads a canvas file. Returns null for anything that is not a usable export, so the caller can
 * show one clear message instead of rendering half a graph.
 */
export function parseCanvasImport(text: string): CanvasTaskNode[] | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text) as unknown;
    } catch {
        return null;
    }

    const candidate = parsed as { kind?: unknown; nodes?: unknown } | null;
    if (!candidate || typeof candidate !== 'object' || !Array.isArray(candidate.nodes)) return null;
    if (candidate.kind !== undefined && candidate.kind !== CANVAS_EXPORT_KIND) return null;

    const nodes: CanvasTaskNode[] = [];
    // Node ids are React Flow's identity, and two nodes sharing one make the edges, the selection and
    // the delete button all act on the wrong card. A hand-edited or concatenated export can carry
    // duplicates, so the first one wins and the rest are dropped.
    const seen = new Set<string>();
    for (const entry of candidate.nodes) {
        if (nodes.length >= MAX_IMPORT_NODES) break;
        const node = sanitizeCanvasNode(entry);
        if (!node || seen.has(node.id)) continue;
        seen.add(node.id);
        nodes.push(node);
    }
    return nodes;
}
