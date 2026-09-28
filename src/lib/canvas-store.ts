import { sanitizeCanvasNode } from '@/lib/canvas-serialize';
import type { CanvasTaskNode } from '@/lib/canvas-types';

/** What a canvas' node list holds — the same node the board renders (see canvas-types.ts). */
export type StoredCanvasNode = CanvasTaskNode;

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
const LEGACY_CANVAS_KEY = 'gptImageCanvas';
/** Canvases the user deleted, kept whole so they can be restored — see TrashedCanvas below. */
const TRASH_KEY = 'gptImageCanvasTrash';

const nodesKey = (id: string) => `gptImageCanvas:${id}`;

export type CanvasViewport = {
    x: number;
    y: number;
    zoom: number;
    /** Size of the board when this viewport was saved — see loadCanvasViewport. */
    width?: number;
    height?: number;
};

const viewportKey = (canvasId: string) => `gptImageCanvasViewport:${canvasId}`;

/**
 * Remembers where the user was looking.
 *
 * Without this every mount (first load, canvas switch, any remount) re-framed the board with fitView,
 * which on a wide graph means zooming out to the floor and rendering the nodes unreadable.
 */
export function loadCanvasViewport(
    canvasId: string,
    /** Current board size: a viewport saved for a different size is not reused. */
    current?: { width: number; height: number }
): CanvasViewport | null {
    const stored = readJson<CanvasViewport>(viewportKey(canvasId));
    if (!stored || typeof stored.x !== 'number' || typeof stored.y !== 'number' || typeof stored.zoom !== 'number') {
        return null;
    }
    if (!Number.isFinite(stored.x) || !Number.isFinite(stored.y) || !Number.isFinite(stored.zoom)) return null;

    // A viewport is only meaningful for the board it was captured on. When the rail is collapsed, the
    // top bar is removed or the window is resized, reusing it leaves part of the graph off-screen — so
    // the caller re-frames instead.
    if (current && stored.width && stored.height) {
        const changed = Math.abs(stored.width - current.width) > 32 || Math.abs(stored.height - current.height) > 32;
        if (changed) return null;
    }

    return {
        x: stored.x,
        y: stored.y,
        zoom: Math.min(Math.max(stored.zoom, 0.05), 4),
        width: stored.width,
        height: stored.height
    };
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

/**
 * Told when a write fails because the browser is out of room. Registered by the page, which owns
 * the toast.
 *
 * A full quota used to fail in silence: the write was logged, the save looked like it worked, and
 * the next visit showed a canvas that had quietly stopped being saved — with nothing on screen to
 * explain why. There is no automatic fix (the app never throws away the user's work), so the least
 * it can do is say so while the user still remembers what they just did.
 */
let storageErrorSink: ((kind: StorageFailureKind) => void) | null = null;

export type StorageFailureKind = 'quota' | 'unavailable';

export function setStorageErrorSink(sink: ((kind: StorageFailureKind) => void) | null): void {
    storageErrorSink = sink;
}

function isQuotaError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const candidate = error as { code?: unknown; name?: unknown };
    // 22 and 1014 are the WebKit and Firefox code numbers for the same thing as QuotaExceededError.
    return (
        candidate.code === 22 ||
        candidate.code === 1014 ||
        candidate.name === 'QuotaExceededError' ||
        candidate.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    );
}

/**
 * The last payload written per key.
 *
 * React Flow hands the board a fresh node array on every drag frame, selection change and
 * measurement pass, and every one of those used to serialise the whole canvas again. Comparing the
 * payload first makes those no-ops. Only small payloads are remembered: keeping a multi-megabyte
 * copy of a huge canvas around just to skip a write would cost more than it saves.
 */
const lastWritten = new Map<string, string>();
const REMEMBERED_PAYLOAD_BYTES = 256 * 1024;

/** Classifies a failed write and reports it — shared so the page's own keys speak up too. */
export function reportStorageWriteFailure(error: unknown, key: string): void {
    if (isQuotaError(error)) {
        console.error(`Local storage is full — ${key} was not saved.`, error);
        storageErrorSink?.('quota');
    } else {
        console.error(`Could not write ${key} to local storage:`, error);
        storageErrorSink?.('unavailable');
    }
}

function writeJson(key: string, value: unknown): boolean {
    let payload: string;
    try {
        payload = JSON.stringify(value);
    } catch (error) {
        console.error(`Could not serialise ${key}:`, error);
        return false;
    }

    if (lastWritten.get(key) === payload) return true;

    try {
        window.localStorage.setItem(key, payload);
        if (payload.length <= REMEMBERED_PAYLOAD_BYTES) lastWritten.set(key, payload);
        return true;
    } catch (error) {
        reportStorageWriteFailure(error, key);
        return false;
    }
}

/**
 * Stored records are read through the same scrub an imported file gets.
 *
 * They used to be trusted as written, and one bad record — a hand-edited export, a write interrupted
 * by a reload — was enough to throw while rendering and take the whole board down. Sanitising here
 * rather than in the board means every reader (the board, the recycle bin, the run manager) sees the
 * same well-formed nodes, instead of each carrying its own version of the filter.
 */
export function loadCanvasNodes(canvasId: string): StoredCanvasNode[] {
    const stored = readJson<{ nodes?: StoredCanvasNode[] }>(nodesKey(canvasId));
    if (!Array.isArray(stored?.nodes)) return [];
    return stored.nodes
        .map((node) => sanitizeCanvasNode(node))
        .filter((node): node is StoredCanvasNode => Boolean(node));
}

export function saveCanvasNodes(canvasId: string, nodes: StoredCanvasNode[]): void {
    writeJson(nodesKey(canvasId), { nodes });
}

/** Every canvas' nodes, regardless of which one is open — the file lifecycle needs all of them. */
export function loadAllCanvasNodes(): StoredCanvasNode[] {
    const registry = readRegistryRaw();
    const ids = registry ? registry.canvases.map((canvas) => canvas.id) : [];
    const nodes = ids.flatMap((id) => loadCanvasNodes(id));
    // Trashed canvases count too. Their pictures are still on disk and a restore has to bring them
    // back, so treating them as garbage would let the cleanup pass delete files the user can still
    // recover — the one destructive mistake this app cannot undo.
    const trashed = loadCanvasTrash().flatMap((entry) => entry.nodes);
    // Until the migration ran there is no registry, so fall back to the legacy key.
    const live =
        nodes.length > 0 ? nodes : (readJson<{ nodes?: StoredCanvasNode[] }>(LEGACY_CANVAS_KEY)?.nodes ?? []);
    return [...live, ...trashed];
}

// --- recycle bin -------------------------------------------------------------------------------

/**
 * A canvas the user deleted.
 *
 * Deleting used to drop the nodes outright, which left the pictures behind with nothing pointing at
 * them: the canvas was gone, the disk space was not, and nothing in the UI could bring either back.
 * A deleted canvas now moves here whole — nodes, masks and file references — so it can be restored
 * as it was, or removed for good (pictures included) when the user really means it.
 */
export type TrashedCanvas = {
    meta: CanvasMeta;
    nodes: StoredCanvasNode[];
    deletedAt: number;
};

/** Newest deletion first. Unreadable records are dropped rather than throwing while rendering. */
export function loadCanvasTrash(): TrashedCanvas[] {
    const stored = readJson<TrashedCanvas[]>(TRASH_KEY);
    if (!Array.isArray(stored)) return [];
    return stored.filter(
        (entry) =>
            Boolean(entry) &&
            typeof entry?.meta?.id === 'string' &&
            typeof entry?.meta?.name === 'string' &&
            Array.isArray(entry?.nodes)
    );
}

export function saveCanvasTrash(entries: TrashedCanvas[]): void {
    writeJson(TRASH_KEY, entries);
}

/**
 * True while the workspace still knows about this canvas: it is open, or waiting in the bin.
 *
 * A run that lands after its canvas was removed for good must not write the node list back — that
 * would recreate the very storage key the deletion cleaned up, with no board left to ever read it.
 */
export function canvasExists(id: string): boolean {
    const registry = readRegistryRaw();
    // Before the registry exists (the legacy single-canvas key) there is nothing to judge against.
    if (!registry) return true;
    if (registry.canvases.some((canvas) => canvas.id === id)) return true;
    return loadCanvasTrash().some((entry) => entry.meta.id === id);
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
/**
 * `defaultCanvasName` is passed in because this module runs before the i18n provider exists —
 * hard-coding the label here showed a Chinese name on an English UI.
 */
export function loadRegistry(defaultCanvasName = 'Canvas 1'): CanvasRegistry {
    if (typeof window === 'undefined') {
        const meta = createCanvasMeta(defaultCanvasName);
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
    const meta = createCanvasMeta(defaultCanvasName);
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
export function canvasStats(canvasId: string): { nodeCount: number; thumbnail: string | null; imageCount: number } {
    return nodesStats(loadCanvasNodes(canvasId));
}

/**
 * The same summary for a node list that is not (or no longer) stored under a canvas id — the recycle
 * bin holds its nodes inside the trash record itself.
 */
export function nodesStats(nodes: StoredCanvasNode[]): {
    nodeCount: number;
    thumbnail: string | null;
    imageCount: number;
} {
    let thumbnail: string | null = null;
    let newest = -Infinity;
    let imageCount = 0;

    for (const node of nodes) {
        const images = Array.isArray(node.data.images) ? node.data.images : [];
        imageCount += images.length;
        const image = images[node.data.viewIndex ?? 0] ?? images[0];
        if (image && node.data.createdAt >= newest) {
            newest = node.data.createdAt;
            thumbnail = image.filename;
        }
    }

    return { nodeCount: nodes.length, thumbnail, imageCount };
}
