import type { CanvasTaskData } from '@/lib/canvas-types';
import type { Node } from '@xyflow/react';

export type StoredCanvasNode = Node<CanvasTaskData, 'task'>;

export type CanvasMeta = {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
};

export type CanvasRegistry = {
    version: 1;
    activeId: string;
    canvases: CanvasMeta[];
};

const REGISTRY_KEY = 'gptImageCanvases';
/** Single-canvas key from before multiple canvases existed; kept untouched as a frozen backup. */
export const LEGACY_CANVAS_KEY = 'gptImageCanvas';

const nodesKey = (id: string) => `gptImageCanvas:${id}`;

export type CanvasViewport = { x: number; y: number; zoom: number };

const viewportKey = (canvasId: string) => `gptImageCanvasViewport:${canvasId}`;

/**
 * Remembers where the user was looking.
 *
 * Without this every mount (first load, canvas switch, any remount) re-framed the board with fitView,
 * which on a wide graph means zooming out to the floor and rendering the nodes unreadable.
 */
export function loadCanvasViewport(canvasId: string): CanvasViewport | null {
    const stored = readJson<CanvasViewport>(viewportKey(canvasId));
    if (!stored || typeof stored.x !== 'number' || typeof stored.y !== 'number' || typeof stored.zoom !== 'number') {
        return null;
    }
    if (!Number.isFinite(stored.x) || !Number.isFinite(stored.y) || !Number.isFinite(stored.zoom)) return null;
    return { x: stored.x, y: stored.y, zoom: Math.min(Math.max(stored.zoom, 0.05), 4) };
}

export function saveCanvasViewport(canvasId: string, viewport: CanvasViewport): void {
    writeJson(viewportKey(canvasId), viewport);
}

export function newCanvasId(): string {
    return `canvas-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function readJson<T>(key: string): T | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : null;
    } catch (error) {
        console.warn(`Could not read ${key} from local storage:`, error);
        return null;
    }
}

function writeJson(key: string, value: unknown): void {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        console.error(`Could not write ${key} to local storage:`, error);
    }
}

export function loadCanvasNodes(canvasId: string): StoredCanvasNode[] {
    const stored = readJson<{ nodes?: StoredCanvasNode[] }>(nodesKey(canvasId));
    return Array.isArray(stored?.nodes) ? stored!.nodes : [];
}

export function saveCanvasNodes(canvasId: string, nodes: StoredCanvasNode[]): void {
    writeJson(nodesKey(canvasId), { nodes });
}

/** Every canvas' nodes, regardless of which one is open — the file lifecycle needs all of them. */
export function loadAllCanvasNodes(): StoredCanvasNode[] {
    const registry = readRegistryRaw();
    const ids = registry ? registry.canvases.map((canvas) => canvas.id) : [];
    const nodes = ids.flatMap((id) => loadCanvasNodes(id));
    // Until the migration ran there is no registry, so fall back to the legacy key.
    return nodes.length > 0 ? nodes : (readJson<{ nodes?: StoredCanvasNode[] }>(LEGACY_CANVAS_KEY)?.nodes ?? []);
}

function readRegistryRaw(): CanvasRegistry | null {
    const registry = readJson<CanvasRegistry>(REGISTRY_KEY);
    if (registry && Array.isArray(registry.canvases) && registry.canvases.length > 0) {
        return registry;
    }
    return null;
}

export function saveRegistry(registry: CanvasRegistry): void {
    writeJson(REGISTRY_KEY, registry);
}

export function createCanvasMeta(name: string): CanvasMeta {
    const now = Date.now();
    return { id: newCanvasId(), name, createdAt: now, updatedAt: now };
}

/**
 * Reads the canvas list, creating it on first use.
 *
 * The first run adopts whatever sat in the old single-canvas key, so existing work becomes
 * "画布 1" instead of disappearing. The legacy key is intentionally left in place afterwards: it
 * costs a few kilobytes and is the last line of defence if anything goes wrong with the registry.
 */
export function loadRegistry(): CanvasRegistry {
    if (typeof window === 'undefined') {
        const meta = createCanvasMeta('画布 1');
        return { version: 1, activeId: meta.id, canvases: [meta] };
    }

    const existing = readRegistryRaw();
    if (existing) {
        const activeId = existing.canvases.some((canvas) => canvas.id === existing.activeId)
            ? existing.activeId
            : existing.canvases[0].id;
        return { ...existing, activeId };
    }

    const legacy = readJson<{ nodes?: StoredCanvasNode[] }>(LEGACY_CANVAS_KEY);
    const meta = createCanvasMeta('画布 1');
    const registry: CanvasRegistry = { version: 1, activeId: meta.id, canvases: [meta] };

    if (Array.isArray(legacy?.nodes) && legacy!.nodes.length > 0) {
        saveCanvasNodes(meta.id, legacy!.nodes);
        console.log(`Migrated ${legacy!.nodes.length} node(s) from the single-canvas key into "${meta.name}".`);
    }

    saveRegistry(registry);
    return registry;
}

/**
 * Node count plus a preview picture for the sidebar.
 *
 * The thumbnail is the newest picture the canvas holds — the node created last that actually has an
 * image — so the list reads like a set of recent boards instead of a set of names.
 */
export function canvasStats(canvasId: string): {
    nodeCount: number;
    thumbnail: string | null;
    kindCounts: Record<string, number>;
} {
    const nodes = loadCanvasNodes(canvasId);
    const kindCounts: Record<string, number> = {};
    let thumbnail: string | null = null;
    let newest = -Infinity;

    for (const node of nodes) {
        kindCounts[node.data.kind] = (kindCounts[node.data.kind] ?? 0) + 1;
        const image = node.data.images[node.data.viewIndex ?? 0] ?? node.data.images[0];
        if (image && node.data.createdAt >= newest) {
            newest = node.data.createdAt;
            thumbnail = image.filename;
        }
    }

    return { nodeCount: nodes.length, thumbnail, kindCounts };
}
