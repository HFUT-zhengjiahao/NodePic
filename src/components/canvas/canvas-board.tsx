'use client';

import type { HistoryMetadata } from '@/app/page';
import { MaskEditor } from '@/components/mask-editor';
import { TaskNode, TaskNodeActionsProvider, type TaskNodeActions, type TaskNodeType } from '@/components/canvas/task-node';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
    createTaskData,
    MAX_EDIT_SOURCES,
    type CanvasTaskData,
    type CanvasTaskParams
} from '@/lib/canvas-types';
import { db, type MaskRecord } from '@/lib/db';
import { MAX_EDIT_IMAGES } from '@/lib/models';
import { runCanvasTask } from '@/lib/canvas-run';
import { calculateApiCost } from '@/lib/cost-utils';
import { useI18n } from '@/lib/i18n';
import { useLiveQuery } from 'dexie-react-hooks';
import {
    Background,
    BackgroundVariant,
    ConnectionMode,
    Controls,
    MiniMap,
    ReactFlow,
    ReactFlowProvider,
    useNodesState,
    useReactFlow,
    MarkerType,
    type Connection,
    type Edge,
    type EdgeChange,
    type Node
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Brush, Download, ImagePlus, LayoutGrid, Plus, Sparkles, Trash2, Undo2, Upload } from 'lucide-react';
import Image from 'next/image';
import * as React from 'react';

import { CANVAS_HINT_KEY as HINT_KEY } from '@/lib/canvas-refs';
import { loadCanvasNodes, saveCanvasNodes, type StoredCanvasNode } from '@/lib/canvas-store';

/** Shared look for every lineage edge: smooth left-to-right curve with an arrow head. */
const EDGE_STYLE = { stroke: '#a5b4fc', strokeWidth: 2 } as const;
const EDGE_MARKER = { type: MarkerType.ArrowClosed, color: '#a5b4fc', width: 18, height: 18 } as const;
const NODE_GAP_X = 470;
const NODE_GAP_Y = 120;

type CanvasSnapshot = {
    nodes: TaskNodeType[];
};

/** Payload every derived edge carries, so a deletion maps back to a source picture. */
type LineageEdgeData = {
    filename: string;
    targetId: string;
};

/**
 * Edges are NOT state: they are derived from `sourceFilenames`, the single source of truth.
 *
 * Keeping both in sync by hand is what produced "the line is gone but the node still uploads that
 * picture" and "the line is there but it points at an old file" — deriving makes the drawn lineage
 * equal the pictures a run will actually use, by construction.
 */
function buildEdges(nodes: TaskNodeType[]): Edge[] {
    const producedBy = new Map<string, string>();
    for (const node of nodes) {
        for (const image of node.data.images) {
            if (!producedBy.has(image.filename)) producedBy.set(image.filename, node.id);
        }
    }

    const edges: Edge[] = [];
    for (const node of nodes) {
        for (const filename of node.data.sourceFilenames) {
            const parentId = producedBy.get(filename);
            if (!parentId || parentId === node.id) continue;
            edges.push({
                id: `e:${parentId}->${node.id}#${filename}`,
                source: parentId,
                target: node.id,
                type: 'default',
                animated: true,
                style: EDGE_STYLE,
                markerEnd: EDGE_MARKER,
                data: { filename, targetId: node.id } satisfies LineageEdgeData
            });
        }
    }
    return edges;
}

type CanvasBoardProps = {
    /** Which saved canvas this board shows. Changing it remounts the board (see page.tsx). */
    canvasId: string;
    /** Called after every persisted change so the sidebar can refresh its counters. */
    onSaved?: () => void;
    onTaskComplete?: (entry: HistoryMetadata) => void;
    /** Surfaces short messages in the app-level toast (connection changes, queueing, undo…). */
    onNotify?: (text: string, tone?: 'info' | 'success' | 'error') => void;
    passwordHash?: string | null;
};

/** How many nodes may talk to the provider at once; the rest wait in the node's own queue. */
const MAX_CONCURRENT_RUNS = 2;
const MAX_UNDO_STEPS = 25;

function loadSnapshot(canvasId: string): CanvasSnapshot {
    if (typeof window === 'undefined') return { nodes: [] };
    try {
        const nodes = loadCanvasNodes(canvasId).map((node) => ({
                  ...node,
                  // A node interrupted by a reload must not stay stuck in the "running" state.
                  // (Masks are reconciled against IndexedDB once it has loaded.)
                  data: {
                      ...node.data,
                      status:
                          node.data.status === 'running' || node.data.status === 'queued' ? 'idle' : node.data.status
                  }
              }));
        // Edges from older snapshots are deliberately dropped: buildEdges() recomputes them from the
        // source lists, which is what keeps the picture and the line in agreement.
        return { nodes };
    } catch (error) {
        console.error('Failed to read the saved canvas:', error);
        return { nodes: [] };
    }
}

function CanvasFlow({ canvasId, onSaved, onTaskComplete, onNotify, passwordHash }: CanvasBoardProps) {
    const { t } = useI18n();
    const initial = React.useMemo(() => loadSnapshot(canvasId), [canvasId]);
    const [nodes, setNodes, onNodesChange] = useNodesState<TaskNodeType>(initial.nodes);
    // Derived edges are recreated on every change, so their selection has to be tracked here —
    // without it React Flow's own "select an edge and press Backspace" flow cannot work.
    const [selectedEdgeIds, setSelectedEdgeIds] = React.useState<string[]>([]);
    const edges = React.useMemo(() => {
        const derived = buildEdges(nodes);
        if (selectedEdgeIds.length === 0) return derived;
        return derived.map((edge) => (selectedEdgeIds.includes(edge.id) ? { ...edge, selected: true } : edge));
    }, [nodes, selectedEdgeIds]);
    const [maskTarget, setMaskTarget] = React.useState<{ nodeId: string; filename: string; path: string } | null>(null);
    const [expanded, setExpanded] = React.useState<{ path: string; filename: string } | null>(null);
    const { screenToFlowPosition, fitView } = useReactFlow();

    const nodesRef = React.useRef(nodes);
    const edgesRef = React.useRef(edges);
    React.useEffect(() => {
        nodesRef.current = nodes;
    }, [nodes]);
    React.useEffect(() => {
        edgesRef.current = edges;
    }, [edges]);

    // --- undo: a snapshot of the graph is taken before every destructive edit -------------------
    const undoStack = React.useRef<CanvasSnapshot[]>([]);
    const snapshot = React.useCallback(() => {
        undoStack.current.push({ nodes: nodesRef.current });
        if (undoStack.current.length > MAX_UNDO_STEPS) undoStack.current.shift();
    }, []);
    const undo = React.useCallback(() => {
        const previous = undoStack.current.pop();
        if (!previous) {
            onNotify?.(t('Nothing to undo.'), 'info');
            return;
        }
        setNodes(previous.nodes);
        onNotify?.(t('Undone.'), 'info');
    }, [onNotify, setNodes, t]);

    React.useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
            const target = event.target as HTMLElement | null;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
                return; // let the field handle its own undo
            }
            event.preventDefault();
            undo();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [undo]);

    // --- node-level run queue: the toolbar may fire several nodes at once ----------------------
    const runningRef = React.useRef<Set<string>>(new Set());
    const pendingRef = React.useRef<string[]>([]);
    const runNodeRef = React.useRef<((id: string) => Promise<void>) | null>(null);
    const [showHint, setShowHint] = React.useState(false);

    React.useEffect(() => {
        queueMicrotask(() => setShowHint(window.localStorage.getItem(HINT_KEY) !== '1'));
    }, []);

    const dismissHint = React.useCallback(() => {
        setShowHint(false);
        window.localStorage.setItem(HINT_KEY, '1');
    }, []);

    // Masks live in IndexedDB (see db.ts), so they survive a reload and stay reactive.
    const maskRecords = useLiveQuery(() => db.masks.toArray(), []);
    const masks = React.useMemo(() => {
        const map = new Map<string, { file: File; filename: string }>();
        for (const record of maskRecords ?? []) {
            map.set(record.nodeId, {
                file: new File([record.blob], record.filename, { type: 'image/png' }),
                filename: record.filename
            });
        }
        return map;
    }, [maskRecords]);

    const saveMask = React.useCallback(
        async (nodeId: string, file: File | null) => {
            try {
                if (file) {
                    await db.masks.put({ nodeId, blob: file, filename: file.name, updatedAt: Date.now() });
                } else {
                    await db.masks.delete(nodeId);
                }
            } catch (error) {
                console.error('Failed to persist the mask:', error);
            }
            setNodes((prev) =>
                prev.map((node) =>
                    node.id === nodeId ? { ...node, data: { ...node.data, maskFileName: file ? file.name : null } } : node
                )
            );
        },
        [setNodes]
    );

    // Once the stored masks are known, make the node badges match them: a mask painted before the
    // reload shows up again, and one that was deleted elsewhere stops claiming to be applied.
    React.useEffect(() => {
        if (!maskRecords) return;
        setNodes((prev) => {
            let changed = false;
            const next = prev.map((node) => {
                const expected = maskRecords.find((record) => record.nodeId === node.id)?.filename ?? null;
                if ((node.data.maskFileName ?? null) === expected) return node;
                changed = true;
                return { ...node, data: { ...node.data, maskFileName: expected } };
            });
            return changed ? next : prev;
        });
    }, [maskRecords, setNodes]);
    const skipFirstSave = React.useRef(true);
    const hadNodes = React.useRef(initial.nodes.length > 0);
    const explicitClear = React.useRef(false);

    React.useEffect(() => {
        if (skipFirstSave.current) {
            skipFirstSave.current = false;
            return;
        }
        if (nodes.length > 0) {
            hadNodes.current = true;
        } else if (hadNodes.current && !explicitClear.current) {
            // An empty node list without a user action means a bad load or a render glitch — writing it
            // would silently destroy the canvas, so keep the stored snapshot instead.
            console.warn('Refusing to overwrite a non-empty canvas with an empty one.');
            return;
        }

        const timer = window.setTimeout(() => {
            saveCanvasNodes(canvasId, nodes as StoredCanvasNode[]);
            onSaved?.();
        }, 400);
        return () => window.clearTimeout(timer);
    }, [canvasId, nodes, onSaved]);

    // Switching canvases (or closing the tab) must not lose the last keystrokes: the debounce above
    // is cancelled by unmount, so write the pending state out synchronously here.
    const latestNodes = React.useRef(nodes);
    React.useEffect(() => {
        latestNodes.current = nodes;
    }, [nodes]);
    React.useEffect(
        () => () => {
            if (latestNodes.current.length > 0 || explicitClear.current) {
                saveCanvasNodes(canvasId, latestNodes.current as StoredCanvasNode[]);
            }
        },
        [canvasId]
    );

    /**
     * A history delete can remove a file the canvas still points at. Verify every referenced source
     * once per change set, so a dead reference shows up as an explicit warning instead of a blank
     * thumbnail and a 404 on the next run.
     */
    const sourceSignature = nodes
        .map((node) => [...node.data.sourceFilenames, ...node.data.images.map((image) => image.filename)].join(','))
        .join('|');

    React.useEffect(() => {
        let cancelled = false;
        const exists = new Map<string, boolean>();
        const check = async () => {
            const verify = async (filename: string) => {
                if (exists.has(filename)) return;
                try {
                    const response = await fetch(`/api/image/${encodeURIComponent(filename)}`, {
                        method: 'GET',
                        cache: 'no-store'
                    });
                    exists.set(filename, response.ok);
                    await response.body?.cancel();
                } catch {
                    exists.set(filename, false);
                }
            };

            for (const node of nodesRef.current) {
                for (const filename of node.data.sourceFilenames) await verify(filename);
                for (const image of node.data.images) await verify(image.filename);
            }
            if (cancelled) return;

            let changed = false;
            const next = nodesRef.current.map((node) => {
                const sourceMissing = node.data.sourceFilenames.some((filename) => exists.get(filename) === false);
                // Only claim a result is gone once every image of the batch is confirmed missing.
                const resultMissing =
                    node.data.images.length > 0 && node.data.images.every((image) => exists.get(image.filename) === false);
                if (sourceMissing === !!node.data.sourceMissing && resultMissing === !!node.data.resultMissing) return node;
                changed = true;
                return { ...node, data: { ...node.data, sourceMissing, resultMissing } };
            });
            if (changed) setNodes(next);
        };
        void check();
        return () => {
            cancelled = true;
        };
    }, [sourceSignature, setNodes]);

    const patchNode = React.useCallback(
        (id: string, patch: Partial<CanvasTaskData>) => {
            setNodes((prev) => prev.map((node) => (node.id === id ? { ...node, data: { ...node.data, ...patch } } : node)));
        },
        [setNodes]
    );

    const patchParams = React.useCallback(
        (id: string, patch: Partial<CanvasTaskParams>) => {
            setNodes((prev) =>
                prev.map((node) =>
                    node.id === id ? { ...node, data: { ...node.data, params: { ...node.data.params, ...patch } } } : node
                )
            );
        },
        [setNodes]
    );

    // --- picking local pictures ---------------------------------------------------------------
    const fileInputRef = React.useRef<HTMLInputElement>(null);
    const pendingUpload = React.useRef<{ kind: 'nodes'; position?: { x: number; y: number } } | { kind: 'replace'; nodeId: string } | null>(null);

    /** Sends picked files to /api/image-upload and returns their server-side filenames. */
    const uploadFiles = React.useCallback(
        async (files: File[]): Promise<Array<{ filename: string; path: string }>> => {
            const formData = new FormData();
            files.forEach((file) => formData.append('file', file));
            if (passwordHash) formData.append('passwordHash', passwordHash);

            const response = await fetch('/api/image-upload', { method: 'POST', body: formData });
            const result = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(
                    result?.error || t('Upload failed with status {status}', { status: response.status })
                );
            }
            return (result.files ?? []).map((file: { filename: string; path: string }) => ({
                filename: file.filename,
                path: file.path
            }));
        },
        [passwordHash, t]
    );

    /** Adds one node per uploaded picture, starting at the drop point (or the viewport centre). */
    const addImageNodes = React.useCallback(
        async (files: File[], position?: { x: number; y: number }, source: 'picker' | 'paste' | 'drop' = 'picker') => {
            if (files.length === 0) return;
            try {
                const uploaded = await uploadFiles(files);
                const origin =
                    position ?? screenToFlowPosition({ x: window.innerWidth / 2 - 190, y: window.innerHeight / 2 - 180 });
                setNodes((prev) => [
                    ...prev,
                    ...uploaded.map(
                        (file, index) =>
                            ({
                                id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                                type: 'task',
                                position: { x: origin.x, y: origin.y + index * 140 },
                                data: createTaskData('image', { images: [file] }),
                                selected: false
                            }) as TaskNodeType
                    )
                ]);
                onNotify?.(
                    source === 'paste'
                        ? t('Pasted {count} picture(s) into new node(s).', { count: uploaded.length })
                        : t('Added {count} picture node(s).', { count: uploaded.length }),
                    'success'
                );
            } catch (error) {
                console.error('Image upload failed:', error);
                onNotify?.(error instanceof Error ? error.message : t('An unexpected error occurred.'), 'error');
            }
        },
        [onNotify, screenToFlowPosition, setNodes, t, uploadFiles]
    );

    const replaceNodeImage = React.useCallback((id: string) => {
        pendingUpload.current = { kind: 'replace', nodeId: id };
        fileInputRef.current?.click();
    }, []);

    const openUploadPicker = React.useCallback((position?: { x: number; y: number }) => {
        pendingUpload.current = { kind: 'nodes', position };
        fileInputRef.current?.click();
    }, []);

    const handlePickedFiles = React.useCallback(
        async (fileList: FileList | null) => {
            const files = Array.from(fileList ?? []).filter((file) => file.type.startsWith('image/'));
            const intent = pendingUpload.current;
            pendingUpload.current = null;
            if (files.length === 0) return;

            if (intent?.kind === 'replace') {
                try {
                    const [uploaded] = await uploadFiles([files[0]]);
                    if (uploaded) {
                        patchNode(intent.nodeId, {
                            images: [uploaded],
                            viewIndex: 0,
                            resultMissing: false,
                            status: 'idle',
                            error: null
                        });
                        onNotify?.(t('Picture replaced.'), 'success');
                    }
                } catch (error) {
                    console.error('Image replacement failed:', error);
                    onNotify?.(error instanceof Error ? error.message : t('An unexpected error occurred.'), 'error');
                }
                return;
            }

            await addImageNodes(files, intent?.position);
        },
        [addImageNodes, onNotify, patchNode, t, uploadFiles]
    );

    /** Where the pointer last was, so a pasted picture appears at a sensible spot. */
    const lastPointer = React.useRef<{ x: number; y: number } | null>(null);

    /**
     * Ctrl/Cmd+V anywhere over the canvas turns clipboard pictures into upload nodes.
     *
     * The picture goes through the same /api/image-upload path as the toolbar button, so a pasted
     * screenshot behaves exactly like a picked file: registered, reusable as an edit source, and
     * protected from the orphan cleanup while a node references it.
     */
    React.useEffect(() => {
        const isEditable = (target: EventTarget | null) =>
            target instanceof HTMLElement &&
            (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

        const handlePaste = (event: ClipboardEvent) => {
            if (isEditable(event.target)) return; // let text fields handle their own paste

            const files = Array.from(event.clipboardData?.items ?? [])
                .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
                .map((item) => item.getAsFile())
                .filter((file): file is File => Boolean(file));
            if (files.length === 0) return;

            event.preventDefault();
            const pointer = lastPointer.current;
            const position = pointer
                ? screenToFlowPosition({ x: pointer.x - 190, y: pointer.y - 120 })
                : undefined;
            void addImageNodes(files, position, 'paste');
        };

        window.addEventListener('paste', handlePaste);
        return () => window.removeEventListener('paste', handlePaste);
    }, [addImageNodes, screenToFlowPosition]);

    /** Dropping files anywhere on the canvas adds them as picture nodes. */
    const handleDrop = React.useCallback(
        (event: React.DragEvent) => {
            if (!event.dataTransfer?.files?.length) return;
            event.preventDefault();
            const position = screenToFlowPosition({ x: event.clientX - 190, y: event.clientY - 120 });
            void addImageNodes(
                Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith('image/')),
                position,
                'drop'
            );
        },
        [addImageNodes, screenToFlowPosition]
    );

    const runNode = React.useCallback(
        async (id: string) => {
            const node = nodesRef.current.find((item) => item.id === id);
            if (!node) return;
            // A picture node is a source, not a task: only generate/edit nodes talk to the provider.
            if (node.data.kind === 'image') return;
            if (!node.data.prompt.trim()) return;
            if (runningRef.current.has(id)) return;

            if (runningRef.current.size >= MAX_CONCURRENT_RUNS) {
                pendingRef.current.push(id);
                patchNode(id, { status: 'queued', error: null });
                return;
            }

            if (node.data.sourceMissing) {
                patchNode(id, {
                    status: 'error',
                    error: t('A source image of this node no longer exists. Re-run its parent node or connect a new source.')
                });
                return;
            }

            const startedAt = Date.now();
            runningRef.current.add(id);
            patchNode(id, { status: 'running', error: null });

            try {
                const { images, usage } = await runCanvasTask({
                    kind: node.data.kind,
                    prompt: node.data.prompt,
                    params: node.data.params,
                    sourceFilenames: node.data.sourceFilenames,
                    maskFile: masks.get(id)?.file ?? null,
                    passwordHash
                });
                const durationMs = Date.now() - startedAt;
                const costDetails = calculateApiCost(usage, node.data.params.model);
                const previousFilenames = node.data.images.map((image) => image.filename);

                patchNode(id, { status: 'idle', images, viewIndex: 0, usage, costDetails, durationMs, error: null });

                // Downstream nodes referenced the old files by name; point them at the new ones so the
                // drawn lineage and the pictures a run uploads stay the same thing.
                const remap = new Map<string, string>();
                previousFilenames.forEach((filename, index) => {
                    const replacement = images[index]?.filename ?? images[0]?.filename;
                    if (replacement && replacement !== filename) remap.set(filename, replacement);
                });
                if (remap.size > 0) {
                    let touched = 0;
                    setNodes((prev) =>
                        prev.map((other) => {
                            if (other.id === id) return other;
                            const updated = other.data.sourceFilenames.map((filename) => remap.get(filename) ?? filename);
                            if (updated.every((filename, index) => filename === other.data.sourceFilenames[index])) {
                                return other;
                            }
                            touched += 1;
                            return { ...other, data: { ...other.data, sourceFilenames: updated, sourceMissing: false } };
                        })
                    );
                    if (touched > 0) {
                        onNotify?.(t('Downstream nodes now use the picture from this run.'), 'info');
                    }
                }
                onTaskComplete?.({
                    timestamp: Date.now(),
                    images: images.map((image) => ({ filename: image.filename })),
                    storageModeUsed: 'fs',
                    durationMs,
                    quality: node.data.params.quality,
                    background: node.data.params.background,
                    moderation: node.data.params.moderation,
                    prompt: node.data.prompt,
                    mode: node.data.kind,
                    costDetails,
                    output_format: node.data.params.outputFormat,
                    model: node.data.params.model
                });
            } catch (error) {
                patchNode(id, {
                    status: 'error',
                    error: error instanceof Error ? error.message : t('An unexpected error occurred.')
                });
            } finally {
                runningRef.current.delete(id);
                const next = pendingRef.current.shift();
                if (next) {
                    window.setTimeout(() => void runNodeRef.current?.(next), 0);
                }
            }
        },
        [masks, onNotify, onTaskComplete, passwordHash, patchNode, setNodes, t]
    );

    React.useEffect(() => {
        runNodeRef.current = runNode;
    }, [runNode]);

    /** Places a new node in free space to the right of its parent. */
    const findFreePosition = React.useCallback((originX: number, originY: number) => {
        let x = originX + NODE_GAP_X;
        let y = originY;
        const taken = (px: number, py: number) =>
            nodesRef.current.some((node) => Math.abs(node.position.x - px) < 300 && Math.abs(node.position.y - py) < 120);
        while (taken(x, y)) {
            y += NODE_GAP_Y;
        }
        return { x, y };
    }, []);

    const addNode = React.useCallback(
        (kind: 'generate' | 'edit', position?: { x: number; y: number }) => {
            const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const spot = position ?? screenToFlowPosition({ x: window.innerWidth / 2 - 190, y: window.innerHeight / 2 - 200 });
            setNodes((prev) => [
                ...prev,
                {
                    id,
                    type: 'task',
                    position: spot,
                    data: createTaskData(kind),
                    selected: false
                } as TaskNodeType
            ]);
            // Only re-frame the viewport when the node was created from the toolbar; a double-click
            // placement should stay exactly where the user pointed.
            if (!position) {
                window.setTimeout(() => fitView({ padding: 0.2, duration: 300, minZoom: 0.85 }), 80);
            }
            return id;
        },
        [fitView, screenToFlowPosition, setNodes]
    );

    const deriveEditNode = React.useCallback(
        (id: string) => {
            const parent = nodesRef.current.find((node) => node.id === id);
            // The picture the user is looking at, not blindly the first of the batch.
            const image = parent?.data.images[parent.data.viewIndex ?? 0] ?? parent?.data.images[0];
            if (!parent || !image) return;

            const newId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const position = findFreePosition(parent.position.x, parent.position.y);
            setNodes((prev) => [
                ...prev,
                {
                    id: newId,
                    type: 'task',
                    position,
                    data: createTaskData('edit', { sourceFilenames: [image.filename] }),
                    selected: false
                } as TaskNodeType
            ]);
            // The connecting line is derived from the new node's sourceFilenames.
            window.setTimeout(() => fitView({ padding: 0.2, duration: 300, minZoom: 0.85 }), 80);
        },
        [findFreePosition, fitView, setNodes]
    );

    /** True when wiring `source` into `target` would close a loop (target is already upstream). */
    const createsCycle = React.useCallback((source?: string | null, target?: string | null) => {
        if (!source || !target || source === target) return false;
        const parentsOf = (nodeId: string): string[] => {
            const node = nodesRef.current.find((item) => item.id === nodeId);
            if (!node) return [];
            return node.data.sourceFilenames
                .map(
                    (filename) =>
                        nodesRef.current.find((item) => item.data.images.some((image) => image.filename === filename))?.id
                )
                .filter((id): id is string => Boolean(id));
        };

        const seen = new Set<string>();
        const stack: string[] = [source];
        while (stack.length > 0) {
            const current = stack.pop() as string;
            if (current === target) return true;
            if (seen.has(current)) continue;
            seen.add(current);
            stack.push(...parentsOf(current));
        }
        return false;
    }, []);

    /** Wires the upstream picture into the downstream node (shared by both connection paths). */
    const wireConnection = React.useCallback(
        (source?: string | null, target?: string | null) => {
            if (!source || !target || source === target) return;

            if (createsCycle(source, target)) {
                window.alert(t('That connection would create a loop.'));
                return;
            }

            const parent = nodesRef.current.find((node) => node.id === source);
            const image = parent?.data.images[parent.data.viewIndex ?? 0] ?? parent?.data.images[0];
            if (!image) {
                window.alert(t('The source node has no image yet — run it first.'));
                return;
            }

            const targetNode = nodesRef.current.find((node) => node.id === target);
            if (
                targetNode &&
                !targetNode.data.sourceFilenames.includes(image.filename) &&
                targetNode.data.sourceFilenames.length >= MAX_EDIT_SOURCES
            ) {
                window.alert(
                    t('An edit node can hold at most {max} source images. Remove one first.', {
                        max: MAX_EDIT_SOURCES
                    })
                );
                return;
            }

            const targetWasGenerate = targetNode?.data.kind === 'generate';

            // A connected node always edits its upstream picture, so a generate node becomes an edit node.
            setNodes((prev) =>
                prev.map((node) => {
                    if (node.id !== target) return node;
                    const sourceFilenames = node.data.sourceFilenames.includes(image.filename)
                        ? node.data.sourceFilenames
                        : [...node.data.sourceFilenames, image.filename].slice(0, MAX_EDIT_SOURCES);
                    return { ...node, data: { ...node.data, kind: 'edit', sourceFilenames } };
                })
            );
            // No edge bookkeeping: the line is derived from the source list written above.
            if (targetWasGenerate) {
                onNotify?.(t('The connected node became an edit node and uses this picture as its source.'), 'info');
            }
        },
        [createsCycle, onNotify, setNodes, t]
    );

    const onConnect = React.useCallback(
        (connection: Connection) => wireConnection(connection.source, connection.target),
        [wireConnection]
    );

    /**
     * React Flow only snaps a connection onto a handle. Users naturally drop on the middle of the
     * target card, so fall back to whatever node the pointer was released over.
     */
    const onConnectEnd = React.useCallback(
        (
            event: MouseEvent | TouchEvent,
            state: { isValid: boolean | null; fromNode: { id: string } | null; toNode: { id: string } | null }
        ) => {
            if (state.isValid) return;

            let targetId: string | null = state.toNode?.id ?? null;
            if (!targetId) {
                // React Flow only reports toNode for handle hits, so resolve the card under the pointer
                // ourselves — dropping anywhere on the target node is what users actually do.
                const point = 'changedTouches' in event ? event.changedTouches[0] : event;
                const stack = document.elementsFromPoint(point.clientX, point.clientY);
                for (const element of stack) {
                    const nodeElement = element.closest?.('.react-flow__node') as HTMLElement | null;
                    if (nodeElement?.dataset.id) {
                        targetId = nodeElement.dataset.id;
                        break;
                    }
                }
            }

            wireConnection(state.fromNode?.id, targetId);
        },
        [wireConnection]
    );

    /**
     * Double-clicking empty canvas drops a new node right there (Shift = edit node).
     * Requires `zoomOnDoubleClick={false}`: React Flow's d3-zoom handler stops propagation of the
     * dblclick event, which would otherwise prevent this handler from ever running.
     */
    const handleDoubleClick = React.useCallback(
        (event: React.MouseEvent) => {
            const target = event.target as HTMLElement;
            if (!target.classList.contains('react-flow__pane')) return;
            const position = screenToFlowPosition({ x: event.clientX - 190, y: event.clientY - 110 });
            addNode(event.shiftKey ? 'edit' : 'generate', position);
        },
        [addNode, screenToFlowPosition]
    );

    const deleteNode = React.useCallback(
        (id: string) => {
            if (!window.confirm(t('Delete this node? You can undo this with Ctrl+Z.'))) return;
            explicitClear.current = true;
            snapshot();
            void db.masks.delete(id).catch((error) => console.error('Failed to drop the node mask:', error));
            setNodes((prev) => prev.filter((node) => node.id !== id));
        },
        [setNodes, snapshot, t]
    );

    /** Drops one source picture from an edit node (the "broken source" escape hatch). */
    const removeSource = React.useCallback(
        (id: string, filename: string) => {
            snapshot();
            setNodes((prev) =>
                prev.map((node) =>
                    node.id === id
                        ? {
                              ...node,
                              data: {
                                  ...node.data,
                                  sourceFilenames: node.data.sourceFilenames.filter((item) => item !== filename)
                              }
                          }
                        : node
                )
            );
            // The lineage line disappears with the source, because it is derived from it.
        },
        [setNodes, snapshot]
    );

    const clearSources = React.useCallback(
        (id: string) => {
            snapshot();
            setNodes((prev) =>
                prev.map((node) =>
                    node.id === id ? { ...node, data: { ...node.data, sourceFilenames: [], sourceMissing: false } } : node
                )
            );
        },
        [setNodes, snapshot]
    );

    /** Same prompt and settings in a fresh node — handy for variations without retyping. */
    const cloneNode = React.useCallback(
        (id: string) => {
            const source = nodesRef.current.find((node) => node.id === id);
            if (!source) return;
            snapshot();
            const newId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const position = findFreePosition(source.position.x, source.position.y);
            setNodes((prev) => [
                ...prev,
                {
                    id: newId,
                    type: 'task',
                    position,
                    data: createTaskData(source.data.kind, {
                        prompt: source.data.prompt,
                        params: { ...source.data.params },
                        sourceFilenames: [...source.data.sourceFilenames]
                    }),
                    selected: false
                } as TaskNodeType
            ]);
        },
        [findFreePosition, setNodes, snapshot]
    );

    /** React Flow's own delete (select an edge + Backspace) removes the source it stands for. */
    const onEdgesChange = React.useCallback(
        (changes: EdgeChange[]) => {
            for (const change of changes) {
                if (change.type === 'select') {
                    setSelectedEdgeIds((prev) =>
                        change.selected
                            ? prev.includes(change.id)
                                ? prev
                                : [...prev, change.id]
                            : prev.filter((id) => id !== change.id)
                    );
                    continue;
                }
                if (change.type !== 'remove') continue;

                const edge = edgesRef.current.find((item) => item.id === change.id);
                const data = edge?.data as LineageEdgeData | undefined;
                setSelectedEdgeIds((prev) => prev.filter((id) => id !== change.id));
                if (data?.targetId && data.filename) {
                    removeSource(data.targetId, data.filename);
                }
            }
        },
        [removeSource]
    );

    const clearCanvas = React.useCallback(() => {
        if (!window.confirm(t('Clear the whole canvas? You can undo this with Ctrl+Z.'))) return;
        explicitClear.current = true;
        snapshot();
        void db.masks.clear().catch((error) => console.error('Failed to clear masks:', error));
        setNodes([]);
    }, [setNodes, snapshot, t]);

    /** Writes the canvas to a JSON file so a bad day is recoverable. */
    const exportCanvas = React.useCallback(() => {
        const payload = {
            kind: 'gpt-image-playground-canvas',
            version: 1,
            exportedAt: new Date().toISOString(),
            nodes: nodesRef.current.map((node) => ({
                id: node.id,
                position: node.position,
                data: node.data
            }))
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `canvas-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
        link.click();
        URL.revokeObjectURL(url);
        onNotify?.(t('Canvas exported.'), 'success');
    }, [onNotify, t]);

    const canvasImportRef = React.useRef<HTMLInputElement>(null);

    const importCanvas = React.useCallback(
        async (file: File | undefined) => {
            if (!file) return;
            try {
                const parsed = JSON.parse(await file.text()) as { nodes?: TaskNodeType[] };
                const imported = Array.isArray(parsed.nodes) ? parsed.nodes : [];
                if (imported.length === 0) {
                    onNotify?.(t('That file contains no canvas nodes.'), 'error');
                    return;
                }
                if (!window.confirm(t('Replace the current canvas with {count} node(s) from this file?', { count: imported.length }))) {
                    return;
                }
                snapshot();
                explicitClear.current = true;
                setNodes(
                    imported.map((node) => ({
                        ...node,
                        type: 'task',
                        selected: false,
                        data: {
                            ...node.data,
                            status: node.data.status === 'running' || node.data.status === 'queued' ? 'idle' : node.data.status
                        }
                    })) as TaskNodeType[]
                );
                onNotify?.(t('Imported {count} node(s).', { count: imported.length }), 'success');
            } catch (error) {
                console.error('Canvas import failed:', error);
                onNotify?.(t('That file is not a valid canvas export.'), 'error');
            }
        },
        [onNotify, setNodes, snapshot, t]
    );

    const actions = React.useMemo<TaskNodeActions>(
        () => ({
            onPatch: patchNode,
            onPatchParams: patchParams,
            onRun: runNode,
            onDeriveEdit: deriveEditNode,
            onClone: cloneNode,
            onReplaceImage: replaceNodeImage,
            onRemoveSource: removeSource,
            onClearSources: clearSources,
            onOpenMask: (id, image) => setMaskTarget({ nodeId: id, filename: image.filename, path: image.path }),
            onDelete: deleteNode,
            onExpand: (image) => setExpanded(image)
        }),
        [
            clearSources,
            cloneNode,
            deleteNode,
            deriveEditNode,
            patchNode,
            patchParams,
            removeSource,
            replaceNodeImage,
            runNode
        ]
    );

    const nodeTypes = React.useMemo(() => ({ task: TaskNode }), []);

    return (
        <div
            className='relative h-[calc(100dvh-88px)] min-h-[520px] w-full overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-20px_rgba(15,23,42,0.25)]'
            onDoubleClick={handleDoubleClick}
            onMouseMove={(event) => {
                lastPointer.current = { x: event.clientX, y: event.clientY };
            }}
            onDragOver={(event) => {
                if (event.dataTransfer?.types?.includes('Files')) event.preventDefault();
            }}
            onDrop={handleDrop}>
            <input
                ref={canvasImportRef}
                id='canvas-import'
                type='file'
                accept='application/json,.json'
                className='hidden'
                onChange={(event) => {
                    void importCanvas(event.target.files?.[0]);
                    event.target.value = '';
                }}
            />
            <input
                ref={fileInputRef}
                id='canvas-image-upload'
                type='file'
                accept='image/png,image/jpeg,image/webp'
                multiple
                className='hidden'
                onChange={(event) => {
                    void handlePickedFiles(event.target.files);
                    event.target.value = '';
                }}
            />
            <div className='pointer-events-none absolute top-3 left-3 z-10 flex items-center gap-2'>
                <Button
                    type='button'
                    size='sm'
                    onClick={() => addNode('generate')}
                    className='pointer-events-auto bg-indigo-600 text-white shadow-sm hover:bg-indigo-500'>
                    <Plus className='mr-1.5 h-4 w-4' /> {t('New generate node')}
                </Button>
                <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => openUploadPicker()}
                    className='pointer-events-auto border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-100 hover:text-slate-900'>
                    <ImagePlus className='mr-1.5 h-4 w-4' /> {t('Upload image')}
                </Button>
                <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => addNode('edit')}
                    className='pointer-events-auto border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-100 hover:text-slate-900'>
                    <ImagePlus className='mr-1.5 h-4 w-4' /> {t('New edit node')}
                </Button>
                <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => fitView({ padding: 0.2, duration: 300, minZoom: 0.85 })}
                    className='pointer-events-auto border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-100 hover:text-slate-900'>
                    <LayoutGrid className='mr-1.5 h-4 w-4' /> {t('Fit view')}
                </Button>
                <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    disabled={nodes.length === 0}
                    onClick={exportCanvas}
                    title={t('Download the canvas as a JSON file')}
                    className='pointer-events-auto border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40'>
                    <Download className='mr-1.5 h-4 w-4' /> {t('Export')}
                </Button>
                <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => canvasImportRef.current?.click()}
                    title={t('Restore a canvas from a JSON file')}
                    className='pointer-events-auto border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-100 hover:text-slate-900'>
                    <Upload className='mr-1.5 h-4 w-4' /> {t('Import')}
                </Button>
                <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={undo}
                    title={t('Undo (Ctrl+Z)')}
                    className='pointer-events-auto border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-100 hover:text-slate-900'>
                    <Undo2 className='mr-1.5 h-4 w-4' /> {t('Undo')}
                </Button>
                {nodes.length > 0 && (
                    <Button
                        type='button'
                        variant='outline'
                        size='sm'
                        onClick={clearCanvas}
                        className='pointer-events-auto border-red-200 bg-white text-red-600 shadow-sm hover:bg-red-50'>
                        <Trash2 className='mr-1.5 h-4 w-4' /> {t('Clear canvas')}
                    </Button>
                )}
            </div>

            <TaskNodeActionsProvider actions={actions}>
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    onConnectEnd={onConnectEnd}
                    isValidConnection={(connection) => !createsCycle(connection.source, connection.target)}
                    connectionMode={ConnectionMode.Loose}
                    connectionRadius={48}
                    connectionLineStyle={{ stroke: '#818cf8', strokeWidth: 2 }}
                    nodeTypes={nodeTypes}
                    fitView
                    fitViewOptions={{ padding: 0.2, minZoom: 0.85 }}
                    zoomOnDoubleClick={false}
                    minZoom={0.15}
                    maxZoom={1.6}
                    className='canvas-shell bg-slate-50/60'>
                    <Background variant={BackgroundVariant.Dots} gap={18} size={1.5} color='#cbd5e1' />
                    <Controls className='!rounded-lg !border !border-slate-200 !bg-white !shadow-sm' showInteractive={false} />
                    <MiniMap
                        pannable
                        zoomable
                        style={{ width: 150, height: 96 }}
                        className='!rounded-lg !border !border-slate-200 !bg-white opacity-70 transition-opacity hover:opacity-100'
                        nodeColor='#c7d2fe'
                        maskColor='rgba(241,245,249,0.7)'
                    />
                </ReactFlow>
            </TaskNodeActionsProvider>

            {showHint && (
                <div className='absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-slate-200 bg-white/95 px-3 py-1.5 text-[11px] whitespace-nowrap text-slate-600 shadow-sm'>
                    <span>{t('Double-click empty canvas to add a node')}</span>
                    <span className='text-slate-300'>·</span>
                    <span>{t('Drag from a node’s right dot onto another node to reference its image')}</span>
                    <span className='text-slate-300'>·</span>
                    <span className='text-slate-400'>{t('Ctrl+V pastes a picture into a new node')}</span>
                    <span className='text-slate-300'>·</span>
                    <span className='text-slate-400'>{t('Shift + double-click adds an edit node')}</span>
                    <button
                        type='button'
                        onClick={dismissHint}
                        className='ml-1 rounded px-1.5 py-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700'>
                        {t('Got it')}
                    </button>
                </div>
            )}

            {nodes.length === 0 && (
                <div className='pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-center'>
                    <Sparkles className='h-8 w-8 text-indigo-300' />
                    <p className='text-sm font-medium text-slate-600'>{t('Your canvas is empty')}</p>
                    <p className='max-w-sm text-xs leading-relaxed text-slate-400'>
                        {t(
                            'Create a generate node to make an image, then click “Use as source for edit” on it to branch off an edit node.'
                        )}
                    </p>
                </div>
            )}

            {/* mask painter */}
            <Dialog open={!!maskTarget} onOpenChange={(open) => !open && setMaskTarget(null)}>
                <DialogContent className='max-h-[90vh] overflow-y-auto border-slate-200 bg-white text-slate-900 sm:max-w-[560px]'>
                    <DialogHeader>
                        <DialogTitle className='flex items-center gap-2 text-base'>
                            <Brush className='h-4 w-4 text-indigo-500' />
                            {t('Mask')}
                        </DialogTitle>
                    </DialogHeader>
                    {maskTarget && (
                        <MaskTargetEditor
                            target={maskTarget}
                            hasMask={masks.has(maskTarget.nodeId)}
                            multiSource={
                                (nodes.find((node) => node.id === maskTarget.nodeId)?.data.sourceFilenames.length ?? 0) > 1
                            }
                            onMaskChange={(file) => void saveMask(maskTarget.nodeId, file)}
                        />
                    )}
                </DialogContent>
            </Dialog>

            {/* full-size preview */}
            <Dialog open={!!expanded} onOpenChange={(open) => !open && setExpanded(null)}>
                <DialogContent className='max-h-[92vh] border-slate-200 bg-white sm:max-w-[900px]'>
                    <DialogHeader>
                        <DialogTitle className='text-base'>{t('Generated image output')}</DialogTitle>
                    </DialogHeader>
                    {expanded && (
                        <div className='relative flex max-h-[75vh] justify-center'>
                            <Image
                                src={expanded.path}
                                alt={expanded.filename}
                                width={1200}
                                height={1200}
                                className='h-auto max-h-[75vh] w-auto object-contain'
                                unoptimized
                            />
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}

/** Loads the picture, then hands it to the shared mask painter. */
function MaskTargetEditor({
    target,
    hasMask,
    multiSource,
    onMaskChange
}: {
    target: { nodeId: string; filename: string; path: string };
    hasMask: boolean;
    multiSource: boolean;
    onMaskChange: (file: File | null) => void;
}) {
    const { t } = useI18n();
    const [size, setSize] = React.useState<{ width: number; height: number } | null>(null);

    React.useEffect(() => {
        const img = new window.Image();
        img.onload = () => setSize({ width: img.width, height: img.height });
        img.src = target.path;
    }, [target.path]);

    if (!size) {
        return <p className='py-8 text-center text-xs text-slate-400'>{t('Loading…')}</p>;
    }

    return (
        <div className='space-y-2'>
            {hasMask && (
                <p className='text-[11px] text-amber-600'>{t('A mask is already attached to this node.')}</p>
            )}
            {multiSource && (
                <p className='text-[11px] text-slate-500'>
                    {t('With several sources the mask is applied to the first picture.')}
                </p>
            )}
            <MaskEditor
                imageUrl={target.path}
                imageWidth={size.width}
                imageHeight={size.height}
                onMaskChange={onMaskChange}
            />
        </div>
    );
}

export function CanvasBoard(props: CanvasBoardProps) {
    return (
        <ReactFlowProvider>
            <CanvasFlow {...props} />
        </ReactFlowProvider>
    );
}

export type { Node as FlowNode };
