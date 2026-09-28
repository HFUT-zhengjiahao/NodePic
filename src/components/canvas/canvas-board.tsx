'use client';

import { TaskNode, TaskNodeActionsProvider, type TaskNodeActions, type TaskNodeType } from '@/components/canvas/task-node';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog';
import {
    createTaskData,
    DEFAULT_TASK_PARAMS,
    MAX_EDIT_SOURCES,
    type CanvasTaskData,
    type CanvasTaskParams
} from '@/lib/canvas-types';
import { MaskTargetEditor } from '@/components/canvas/mask-target-editor';
import { ToolbarIconButton } from '@/components/ui/toolbar-icon-button';
import { buildLineageEdges, createsCycle as lineageCreatesCycle, type LineageEdgeData } from '@/lib/canvas-lineage';
import { arrangeByLineage, NODE_HEIGHT_FALLBACK, NODE_WIDTH } from '@/lib/canvas-layout';
import { buildCanvasExport, canvasExportFilename, parseCanvasImport } from '@/lib/canvas-serialize';
import {
    acknowledgeCanvasRun,
    applyOutcomeToNodes,
    cancelCanvasRuns,
    canvasRunStatus,
    isCanvasRunBusy,
    pendingCanvasRunOutcomes,
    reconcileCanvasRunOutcomes,
    startCanvasRun,
    subscribeToCanvasRuns,
    type CanvasRunOutcome
} from '@/lib/canvas-runs';
import { useI18n } from '@/lib/i18n';
import { imageUrl } from '@/lib/image-url';
import { loadMasks, maskKey, saveMask } from '@/lib/mask-store';
import { useLiveQuery } from 'dexie-react-hooks';
import {
    Background,
    BackgroundVariant,
    ConnectionMode,
    Controls,
    MiniMap,
    Position,
    ReactFlow,
    ReactFlowProvider,
    getBezierPath,
    useNodesState,
    useReactFlow,
    type Connection,
    type ConnectionLineComponentProps,
    type Edge,
    type EdgeChange,
    type Node
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
    Brush,
    ChevronsDownUp,
    ChevronsUpDown,
    Download,
    ImagePlus,
    LayoutDashboard,
    LayoutGrid,
    MoreHorizontal,
    Scaling,
    Plus,
    Sparkles,
    Trash2,
    Undo2,
    Upload
} from 'lucide-react';
import Image from 'next/image';
import * as React from 'react';

import { CANVAS_HINT_KEY as HINT_KEY } from '@/lib/canvas-refs';
import {
    loadCanvasNodes,
    loadCanvasViewport,
    saveCanvasNodes,
    saveCanvasViewport,
    type StoredCanvasNode
} from '@/lib/canvas-store';

const NODE_GAP_X = 470;
const NODE_GAP_Y = 120;

type CanvasSnapshot = {
    nodes: TaskNodeType[];
};

type CanvasBoardProps = {
    /** Which saved canvas this board shows. Changing it remounts the board (see page.tsx). */
    canvasId: string;
    /** Called after every persisted change so the sidebar can refresh its counters. */
    onSaved?: () => void;
    /** Model/quality to start new nodes with, chosen in the settings panel. */
    nodeDefaults?: {
        model: CanvasTaskParams['model'];
        quality: CanvasTaskParams['quality'];
        size: CanvasTaskParams['size'];
    };
    /** Pictures the history page wants dropped onto this canvas (token changes per request). */
    incomingImages?: { filenames: string[]; token: number } | null;
    onIncomingImagesHandled?: () => void;
    /** Surfaces short messages in the app-level toast (connection changes, queueing, undo…). */
    onNotify?: (text: string, tone?: 'info' | 'success' | 'error') => void;
    passwordHash?: string | null;
    /**
     * False while another view covers the board.
     *
     * The board is hidden rather than unmounted so a running queue and the undo stack survive a trip
     * to the history page — but its global listeners do not know that. Leaving them live meant Ctrl+V
     * inserted nodes into an invisible canvas (with `screenToFlowPosition` returning garbage for a
     * `display:none` container), Delete raised a confirm dialog over the history page, and Ctrl+Enter
     * started a paid generation.
     */
    active?: boolean;
};

const MAX_UNDO_STEPS = 25;
/** Never open a board smaller than this — below it the node text stops being readable. */
const MIN_INITIAL_ZOOM = 0.6;

/** The id of the node under a screen point, or null when the point is over empty canvas. */
function nodeIdAtPoint(x: number, y: number): string | null {
    for (const element of document.elementsFromPoint(x, y)) {
        const node = element.closest?.('.react-flow__node') as HTMLElement | null;
        if (node?.dataset.id) return node.dataset.id;
    }
    return null;
}

/**
 * The thread that follows the pointer while a connection is being dragged.
 *
 * React Flow's default is a bare 2px stroke, which reads as a scratch rather than a connection being
 * made. This one is drawn: a soft halo under a crisp line, and a ring at the free end so the loose end
 * looks intentional. Its colour answers the question the drag is actually asking — indigo while the
 * drop would be accepted, rose when it would not (a loop, or a node with nothing to give).
 */
function ConnectionLine({
    fromX,
    fromY,
    toX,
    toY,
    fromPosition,
    toPosition,
    connectionStatus
}: ConnectionLineComponentProps) {
    // Dragging towards empty canvas leaves the end side unresolved; mirroring the start handle keeps
    // the curve bending the way the pointer is travelling.
    const [path] = getBezierPath({
        sourceX: fromX,
        sourceY: fromY,
        sourcePosition: fromPosition,
        targetX: toX,
        targetY: toY,
        targetPosition: toPosition ?? (fromPosition === Position.Left ? Position.Right : Position.Left)
    });
    const invalid = connectionStatus === 'invalid';
    const stroke = invalid ? '#f43f5e' : '#6366f1';

    return (
        <g>
            <path d={path} fill='none' stroke={stroke} strokeWidth={7} strokeOpacity={0.15} strokeLinecap='round' />
            <path d={path} fill='none' stroke={stroke} strokeWidth={2.5} strokeLinecap='round' />
            <circle cx={toX} cy={toY} r={5} fill='white' stroke={stroke} strokeWidth={2.5} />
        </g>
    );
}

function loadSnapshot(canvasId: string): CanvasSnapshot {
    if (typeof window === 'undefined') return { nodes: [] };
    try {
        // A run that is still in flight is the run manager's business, not the stored state's: one
        // interrupted by a reload must not stay stuck on "running", but one that really is running
        // has to say so — otherwise the same node would be started (and billed) a second time.
        const live = canvasRunStatus(canvasId);
        // loadCanvasNodes() already drops unreadable records and settles every field the renderer
        // depends on, so a hand-edited export or an interrupted write cannot throw mid-render.
        const nodes = loadCanvasNodes(canvasId)
            .map((node) => ({
                  ...node,
                  // A node interrupted by a reload must not stay stuck in the "running" state.
                  // (Masks are reconciled against IndexedDB once it has loaded.)
                  data: {
                      ...node.data,
                      // Nodes saved before a parameter existed must still carry every field, or the
                      // node form would read `undefined`.
                      params: { ...DEFAULT_TASK_PARAMS, ...(node.data.params ?? {}) },
                      status:
                          live.get(node.id) ??
                          (node.data.status === 'running' || node.data.status === 'queued' ? 'idle' : node.data.status)
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

function CanvasFlow({
    canvasId,
    nodeDefaults,
    onSaved,
    incomingImages,
    onIncomingImagesHandled,
    onNotify,
    passwordHash,
    active = true
}: CanvasBoardProps) {
    const { t } = useI18n();
    const initial = React.useMemo(() => loadSnapshot(canvasId), [canvasId]);
    const [nodes, setNodes, onNodesChange] = useNodesState<TaskNodeType>(initial.nodes);
    // Derived edges are recreated on every change, so their selection has to be tracked here —
    // without it React Flow's own "select an edge and press Backspace" flow cannot work.
    const [selectedEdgeIds, setSelectedEdgeIds] = React.useState<string[]>([]);
    /**
     * The wiring signature — and not the `nodes` array itself — decides when the lineage has really
     * changed. Dragging a node or typing in its prompt hands `nodes` a new identity every frame
     * without touching a single source filename, and rebuilding the array then re-rendered every
     * line on the board once per keystroke.
     */
    const lineageSignature = React.useMemo(
        () =>
            nodes
                .map(
                    (node) =>
                        `${node.id}>${node.data.sourceFilenames.join(',')}|${node.data.images
                            .map((image) => image.filename)
                            .join(',')}`
                )
                .join(';'),
        [nodes]
    );
    /**
     * The previous result is kept and only rebuilt when the wiring itself changes — this is React's
     * "adjust state during render" pattern, which renders the correct value immediately instead of
     * one frame late the way an effect would.
     */
    const [wiring, setWiring] = React.useState<{ signature: string; edges: Edge[] }>({ signature: '', edges: [] });
    if (wiring.signature !== lineageSignature) {
        setWiring({ signature: lineageSignature, edges: buildLineageEdges(nodes) });
    }
    const derivedEdges = wiring.signature === lineageSignature ? wiring.edges : buildLineageEdges(nodes);
    const edges = React.useMemo(() => {
        if (selectedEdgeIds.length === 0) return derivedEdges;
        return derivedEdges.map((edge) => (selectedEdgeIds.includes(edge.id) ? { ...edge, selected: true } : edge));
    }, [derivedEdges, selectedEdgeIds]);
    const [maskTarget, setMaskTarget] = React.useState<{ nodeId: string; filename: string; path: string } | null>(null);
    const [expanded, setExpanded] = React.useState<{ path: string; filename: string } | null>(null);
    const { screenToFlowPosition, fitView, zoomTo, getViewport, setViewport } = useReactFlow();
    const boardRef = React.useRef<HTMLDivElement>(null);

    const nodesRef = React.useRef(nodes);
    const edgesRef = React.useRef(edges);
    React.useEffect(() => {
        nodesRef.current = nodes;
    }, [nodes]);
    React.useEffect(() => {
        edgesRef.current = edges;
    }, [edges]);

    /**
     * Runs are owned by `canvas-runs`, not by this component.
     *
     * The board is remounted on every canvas switch (`key={canvasId}` in page.tsx), so a queue, an
     * in-flight request or a `setNodes` that would receive the answer used to die with the switch —
     * the picture was generated, billed and thrown away. The runner keeps them and hands them over
     * here, whenever a board happens to be mounted.
     */
    const applyRunOutcomes = React.useCallback(
        (outcomes: CanvasRunOutcome[]) => {
            if (outcomes.length === 0) return;
            // Counted before the update so the toast is not fired from inside a state updater.
            const rewired = nodesRef.current.reduce((total, node) => {
                const touched = outcomes.some(
                    (outcome) =>
                        outcome.nodeId !== node.id &&
                        outcome.remap.some((item) => node.data.sourceFilenames.includes(item.from))
                );
                return touched ? total + 1 : total;
            }, 0);

            // Applied through the runner's own implementation, so a result that lands on a mounted
            // board and one that lands while nobody is watching cannot diverge.
            setNodes((prev) => outcomes.reduce((acc, outcome) => applyOutcomeToNodes(acc, outcome), prev));
            outcomes.forEach((outcome) => acknowledgeCanvasRun(canvasId, outcome.nodeId));
            if (rewired > 0) onNotify?.(t('Downstream nodes now use the picture from this run.'), 'info');
        },
        [canvasId, onNotify, setNodes, t]
    );

    React.useEffect(() => {
        // Drained on subscribe as well: a run that finished between the stored read above and this
        // effect would otherwise stay invisible until the next reload.
        applyRunOutcomes(pendingCanvasRunOutcomes(canvasId));
        return subscribeToCanvasRuns(canvasId, (outcome) => applyRunOutcomes([outcome]));
    }, [applyRunOutcomes, canvasId]);

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
        // A snapshot can hold a node that was mid-run when it was taken. Restoring that status would
        // leave a card stuck on "Generating…" with nothing behind it, so anything the manager is not
        // actually working on comes back as idle.
        const live = canvasRunStatus(canvasId);
        setNodes(
            previous.nodes.map((node) =>
                live.has(node.id) || (node.data.status !== 'running' && node.data.status !== 'queued')
                    ? node
                    : { ...node, data: { ...node.data, status: 'idle' } }
            )
        );
        onNotify?.(t('Undone.'), 'info');
    }, [canvasId, onNotify, setNodes, t]);

    /**
     * Reports what a destructive edit did to the runs of the nodes it removed.
     *
     * Deleting a node used to leave its queued generation in place: the provider was called anyway,
     * the picture was billed, and the result was dropped because the node it belonged to no longer
     * existed. Saying what was stopped is also what keeps a cancelled task from looking like a lost one.
     */
    const reportStoppedRuns = React.useCallback(
        (stopped: { queued: number; running: number }) => {
            if (stopped.queued === 0 && stopped.running === 0) return;
            if (stopped.running === 0) {
                onNotify?.(
                    t('Cancelled {count} queued run(s) — they never reached the model.', { count: stopped.queued }),
                    'info'
                );
                return;
            }
            onNotify?.(
                t(
                    'Cancelled {queued} queued run(s). {running} run(s) were already generating: their pictures will still be saved to the history.',
                    { queued: stopped.queued, running: stopped.running }
                ),
                'info'
            );
        },
        [onNotify, t]
    );

    React.useEffect(() => {
        if (!active) return;
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
    }, [active, undo]);

    // --- node-level run queue: owned by canvas-runs, see applyRunOutcomes above ------------------
    const [showHint, setShowHint] = React.useState(false);
    const [isMenuOpen, setIsMenuOpen] = React.useState(false);
    /** Pending destructive action, shown in an in-app dialog instead of window.confirm. */
    const [pendingConfirm, setPendingConfirm] = React.useState<{
        title: string;
        body: string;
        confirmLabel: string;
        run: () => void;
    } | null>(null);

    React.useEffect(() => {
        queueMicrotask(() => setShowHint(window.localStorage.getItem(HINT_KEY) !== '1'));
    }, []);

    const dismissHint = React.useCallback(() => {
        setShowHint(false);
        window.localStorage.setItem(HINT_KEY, '1');
    }, []);

    // Masks live in IndexedDB, addressed by the picture they were painted on rather than by the node
    // that uses them (see lib/mask-store.ts). That is what lets a mask survive a node delete + undo,
    // keeps two canvases that share a source picture from overwriting each other, and stops a mask
    // from following a node onto a different source after a re-run.
    const maskRecords = useLiveQuery(() => loadMasks(), []);
    const masks = React.useMemo(() => {
        const map = new Map<string, { file: File; filename: string }>();
        for (const record of maskRecords ?? []) {
            map.set(record.key, {
                file: new File([record.blob], record.filename, { type: 'image/png' }),
                filename: record.filename
            });
        }
        return map;
    }, [maskRecords]);

    /**
     * The mask a node would send: the one painted on the picture it is about to edit.
     *
     * `sourceFilenames[0]` is the mask target (the model masks the first source, like OpenAI does),
     * so the key is derived from the node's sources and never stored on it. A node whose first source
     * changes simply resolves to a different key — and to "no mask" — instead of running with a mask
     * painted over a different picture.
     */
    const maskKeyForNode = React.useCallback(
        (node: TaskNodeType | undefined): string | null => {
            const target = node?.data.kind === 'edit' ? node.data.sourceFilenames[0] : undefined;
            return target ? maskKey(canvasId, target) : null;
        },
        [canvasId]
    );

    const persistMask = React.useCallback(
        async (key: string, file: File | null) => {
            const stored = await saveMask(key, file);
            if (!stored) {
                // Claiming success here would badge the node "mask applied" and then run without a
                // mask — an output that silently differs from what the user set up.
                onNotify?.(t('Could not save the mask. The node will run without it.'), 'error');
                return;
            }
            setNodes((prev) =>
                prev.map((node) =>
                    maskKeyForNode(node) === key
                        ? { ...node, data: { ...node.data, maskFileName: file ? file.name : null } }
                        : node
                )
            );
        },
        [maskKeyForNode, onNotify, setNodes, t]
    );

    /**
     * Which mask key every node currently resolves to.
     *
     * The badge pass below has to re-run when a node starts pointing at a different picture — that is
     * the whole point of keying masks by picture — but not when a node is dragged or its prompt is
     * typed into. A signature gives it exactly those triggers.
     */
    const maskSignature = React.useMemo(
        () => nodes.map((node) => `${node.id}>${maskKeyForNode(node) ?? ''}`).join(';'),
        [maskKeyForNode, nodes]
    );

    // Once the stored masks are known, make the node badges match them: a mask painted before the
    // reload shows up again, one that was deleted elsewhere stops claiming to be applied, and a node
    // whose first source has changed loses a badge that no longer describes what it would send.
    React.useEffect(() => {
        if (!maskRecords) return;
        setNodes((prev) => {
            let changed = false;
            const next = prev.map((node) => {
                const key = maskKeyForNode(node);
                const expected = key ? (maskRecords.find((record) => record.key === key)?.filename ?? null) : null;
                if ((node.data.maskFileName ?? null) === expected) return node;
                changed = true;
                return { ...node, data: { ...node.data, maskFileName: expected } };
            });
            return changed ? next : prev;
        });
    }, [maskKeyForNode, maskRecords, maskSignature, setNodes]);
    const skipFirstSave = React.useRef(true);
    /** True once the initial viewport has been applied, so the first move events are ignored. */
    const [viewportReady, setViewportReady] = React.useState(false);
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
            // An outcome that landed while this board was not watching is merged in here, so a save
            // can never write the pre-run version back over a finished picture.
            saveCanvasNodes(canvasId, reconcileCanvasRunOutcomes(canvasId, nodes as StoredCanvasNode[]));
            onSaved?.();
            // The guard only has to cover the window between an empty render and the next real save;
            // leaving it set would disable the protection for the rest of the session.
            explicitClear.current = false;
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
                saveCanvasNodes(
                    canvasId,
                    reconcileCanvasRunOutcomes(canvasId, latestNodes.current as StoredCanvasNode[])
                );
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
            const wanted = new Set<string>();
            for (const node of nodesRef.current) {
                for (const filename of node.data.sourceFilenames) wanted.add(filename);
                for (const image of node.data.images) wanted.add(image.filename);
            }
            const filenames = [...wanted].filter(Boolean);

            if (filenames.length > 0) {
                try {
                    // One round trip for the whole board. The sweep is a pure optimisation — a
                    // "missing" badge is a warning, not a feature — so a failed batch call falls back
                    // to asking per file instead of leaving every file marked as gone.
                    const response = await fetch('/api/images-exists', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ filenames, passwordHash }),
                        cache: 'no-store'
                    });
                    const result = await response.json().catch(() => null);
                    if (!response.ok || !Array.isArray(result?.missing)) {
                        throw new Error(result?.error ?? `HTTP ${response.status}`);
                    }
                    const missing = new Set<string>(result.missing);
                    for (const filename of filenames) exists.set(filename, !missing.has(filename));
                } catch (error) {
                    console.warn('Batch existence check failed — falling back to per-file checks:', error);
                    // HEAD: the server answers from the file's metadata, so this never downloads the
                    // pictures it is only asking about.
                    await Promise.all(
                        filenames.map(async (filename) => {
                            try {
                                const response = await fetch(`/api/image/${encodeURIComponent(filename)}`, {
                                    method: 'HEAD',
                                    cache: 'no-store'
                                });
                                exists.set(filename, response.ok);
                            } catch {
                                exists.set(filename, false);
                            }
                        })
                    );
                }
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
    }, [passwordHash, setNodes, sourceSignature]);

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
        if (!active) return;
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
    }, [active, addImageNodes, screenToFlowPosition]);

    /** Pictures sent over from the history page become nodes here (they already live on disk). */
    React.useEffect(() => {
        if (!incomingImages || incomingImages.filenames.length === 0) return;
        snapshot();
        const origin = screenToFlowPosition({ x: window.innerWidth / 2 - 190, y: window.innerHeight / 2 - 180 });
        setNodes((prev) => [
            ...prev,
            ...incomingImages.filenames.map(
                (filename, index) =>
                    ({
                        id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                        type: 'task',
                        position: { x: origin.x, y: origin.y + index * 140 },
                        data: createTaskData('image', {
                            images: [{ filename, path: imageUrl(filename) }]
                        }),
                        selected: false
                    }) as TaskNodeType
            )
        ]);
        onNotify?.(t('Added {count} picture node(s).', { count: incomingImages.filenames.length }), 'success');
        onIncomingImagesHandled?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- driven by the request token only
    }, [incomingImages?.token]);

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

    /**
     * Hands one node to the run manager and shows the state it reports back.
     *
     * Everything after this point — waiting for a free slot, the provider call, the picture landing on
     * the node — belongs to `canvas-runs`, which is what makes a run survive switching canvas.
     */
    const runNode = React.useCallback(
        (id: string) => {
            const node = nodesRef.current.find((item) => item.id === id);
            if (!node) return;
            // A picture node is a source, not a task: only generate/edit nodes talk to the provider.
            if (node.data.kind === 'image') return;
            if (!node.data.prompt.trim()) return;
            // The manager also ignores a node it is already running or queueing — pressing Run twice
            // used to run (and bill) the same node twice. Saying so beats a button that looks dead:
            // the wait also covers a cancelled run that is still waiting for its answer.
            if (isCanvasRunBusy(canvasId, id)) {
                onNotify?.(t('This node already has a run in flight — wait for it to finish.'), 'info');
                return;
            }

            // Masks arrive from IndexedDB asynchronously, and a masked edit sent before that settles
            // would go out without its mask while the node says otherwise.
            if (node.data.kind === 'edit' && !maskRecords) {
                onNotify?.(t('Still loading the stored masks — try again in a moment.'), 'info');
                return;
            }

            if (node.data.kind === 'edit' && node.data.sourceFilenames.length === 0) {
                patchNode(id, {
                    status: 'error',
                    error: t('Connect or pick a source image before running an edit node.')
                });
                return;
            }

            if (node.data.sourceMissing) {
                patchNode(id, {
                    status: 'error',
                    error: t('A source image of this node no longer exists. Re-run its parent node or connect a new source.')
                });
                return;
            }

            const nodeMaskKey = maskKeyForNode(node);
            const state = startCanvasRun({
                canvasId,
                nodeId: id,
                input: {
                    kind: node.data.kind,
                    prompt: node.data.prompt,
                    params: node.data.params,
                    sourceFilenames: node.data.sourceFilenames,
                    maskFile: nodeMaskKey ? (masks.get(nodeMaskKey)?.file ?? null) : null,
                    passwordHash
                },
                params: node.data.params,
                prompt: node.data.prompt,
                mode: node.data.kind,
                previousFilenames: node.data.images.map((image) => image.filename),
                translate: t
            });
            if (state === 'ignored') return;
            patchNode(id, { status: state === 'queued' ? 'queued' : 'running', error: null });
        },
        [canvasId, maskKeyForNode, maskRecords, masks, onNotify, passwordHash, patchNode, t]
    );

    /** Places a new node in free space to the right of its parent. */
    /**
     * Finds a free spot for a new node, preferring one the user can already see.
     *
     * The board is only nudged as a last resort (see `revealNode`), so a spot inside the current view
     * is worth searching for: right of the parent first, since lineage reads left to right, then below
     * it, then further out.
     */
    const findFreePosition = React.useCallback(
        (originX: number, originY: number, parentHeight = NODE_HEIGHT_FALLBACK) => {
            const element = boardRef.current;
            const visible = element
                ? (() => {
                      const topLeft = screenToFlowPosition({ x: 0, y: 0 });
                      const bottomRight = screenToFlowPosition({
                          x: element.clientWidth,
                          y: element.clientHeight
                      });
                      return { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y };
                  })()
                : null;

            const taken = (px: number, py: number) =>
                nodesRef.current.some(
                    (node) => Math.abs(node.position.x - px) < 300 && Math.abs(node.position.y - py) < 120
                );
            // Wholly visible beats partly visible beats off-screen: a new node should appear where the
            // user is already looking, otherwise the board would have to be nudged to show it.
            const fullyVisible = (px: number, py: number) =>
                !visible ||
                (px >= visible.left &&
                    py >= visible.top &&
                    px + NODE_WIDTH <= visible.right &&
                    py + parentHeight <= visible.bottom);
            const partlyVisible = (px: number, py: number) =>
                !visible ||
                (px + NODE_WIDTH > visible.left &&
                    px < visible.right &&
                    py + 80 > visible.top &&
                    py < visible.bottom);

            const candidates: Array<{ x: number; y: number }> = [];
            for (let step = 1; step <= 6; step += 1) {
                candidates.push({ x: originX + NODE_GAP_X * step, y: originY });
                candidates.push({ x: originX, y: originY + NODE_GAP_Y * step });
                candidates.push({ x: originX + NODE_GAP_X, y: originY + NODE_GAP_Y * step });
                candidates.push({ x: originX - NODE_GAP_X, y: originY + NODE_GAP_Y * step });
                candidates.push({ x: originX, y: originY - (parentHeight + NODE_GAP_Y) * step });
            }
            const free = candidates.filter((spot) => !taken(spot.x, spot.y));
            const visibleFree =
                free.find((spot) => fullyVisible(spot.x, spot.y)) ?? free.find((spot) => partlyVisible(spot.x, spot.y));
            if (visibleFree) return visibleFree;

            // Nothing on screen is free: walk down the column of the parent and let the caller reveal it.
            let x = originX + NODE_GAP_X;
            let y = originY;
            while (taken(x, y)) {
                y += NODE_GAP_Y;
            }
            return { x, y };
        },
        [screenToFlowPosition]
    );

    /**
     * Collapsing the sidebar widens the board, and React Flow keeps the top-left corner fixed — so the
     * left half of the graph slides out of view. Shifting by half the width change keeps whatever the
     * user was looking at in the middle.
     */
    React.useEffect(() => {
        const element = boardRef.current;
        if (!element) return;

        let lastWidth = element.clientWidth;
        const observer = new ResizeObserver(() => {
            const width = element.clientWidth;
            const delta = width - lastWidth;
            lastWidth = width;
            if (!viewportReady || delta === 0) return;
            const viewport = getViewport();
            void setViewport({ ...viewport, x: viewport.x + delta / 2 }, { duration: 0 });
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, [getViewport, setViewport, viewportReady]);

    /** Node data honouring the defaults picked in the settings panel. */
    const makeTaskData = React.useCallback(
        (kind: 'generate' | 'edit', overrides: Partial<CanvasTaskData> = {}) =>
            createTaskData(kind, {
                params: {
                    ...DEFAULT_TASK_PARAMS,
                    model: nodeDefaults?.model ?? DEFAULT_TASK_PARAMS.model,
                    quality: nodeDefaults?.quality ?? DEFAULT_TASK_PARAMS.quality,
                    size: nodeDefaults?.size ?? DEFAULT_TASK_PARAMS.size,
                },
                ...overrides
            }),
        [
            nodeDefaults?.model,
            nodeDefaults?.quality,
            nodeDefaults?.size
        ]
    );

    /**
     * Brings a freshly created node into view **without touching the zoom**.
     *
     * Creating content should never re-frame the board: `fitView` after every "derive edit" moved and
     * rescaled the canvas under the user, which is disorienting when the new node is already visible —
     * and it always is, because it is placed right next to its source or at the centre of the view.
     * Only when the node would land off-screen is the board nudged by the minimum amount.
     */
    const revealNode = React.useCallback(
        (nodeId: string) => {
            window.setTimeout(() => {
                const element = boardRef.current;
                const node = nodesRef.current.find((candidate) => candidate.id === nodeId);
                if (!element || !node) return;

                const viewport = getViewport();
                const width = (node.measured?.width ?? NODE_WIDTH) * viewport.zoom;
                const height = (node.measured?.height ?? NODE_HEIGHT_FALLBACK) * viewport.zoom;
                const left = node.position.x * viewport.zoom + viewport.x;
                const top = node.position.y * viewport.zoom + viewport.y;
                const margin = 24;

                // Already (at least partly) on screen? Then leave the camera alone — moving it is what
                // the user objected to, and a partially visible node is enough of a cue.
                const overlapsView =
                    left + width > 0 && left < element.clientWidth && top + height > 0 && top < element.clientHeight;
                if (overlapsView) return;

                let dx = 0;
                let dy = 0;
                if (left < margin) dx = margin - left;
                else if (left + width > element.clientWidth - margin) dx = element.clientWidth - margin - (left + width);
                if (top < margin) dy = margin - top;
                else if (top + height > element.clientHeight - margin) dy = element.clientHeight - margin - (top + height);

                if (dx === 0 && dy === 0) return;
                void setViewport({ x: viewport.x + dx, y: viewport.y + dy, zoom: viewport.zoom }, { duration: 200 });
            }, 140);
        },
        [getViewport, setViewport]
    );

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
                    data: makeTaskData(kind),
                    selected: false
                } as TaskNodeType
            ]);
            revealNode(id);
            return id;
        },
        [makeTaskData, revealNode, screenToFlowPosition, setNodes]
    );

    const deriveEditNode = React.useCallback(
        (id: string) => {
            const parent = nodesRef.current.find((node) => node.id === id);
            // The picture the user is looking at, not blindly the first of the batch.
            const image = parent?.data.images[parent.data.viewIndex ?? 0] ?? parent?.data.images[0];
            if (!parent || !image) return;

            const newId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const position = findFreePosition(
                parent.position.x,
                parent.position.y,
                parent.measured?.height ?? NODE_HEIGHT_FALLBACK
            );
            setNodes((prev) => [
                ...prev,
                {
                    id: newId,
                    type: 'task',
                    position,
                    data: makeTaskData('edit', { sourceFilenames: [image.filename] }),
                    selected: false
                } as TaskNodeType
            ]);
            // The connecting line is derived from the new node's sourceFilenames.
            revealNode(newId);
        },
        [findFreePosition, makeTaskData, revealNode, setNodes]
    );

    /** True when wiring `source` into `target` would close a loop (target is already upstream). */
    const createsCycle = React.useCallback(
        (source?: string | null, target?: string | null) => lineageCreatesCycle(nodesRef.current, source, target),
        []
    );

    /** Wires the upstream picture into the downstream node (shared by both connection paths). */
    const wireConnection = React.useCallback(
        (source?: string | null, target?: string | null) => {
            if (!source || !target || source === target) return;

            // App toasts, not window.alert: a native dialog blocks the whole page and does not match
            // how every other failure in the board is reported.
            if (createsCycle(source, target)) {
                onNotify?.(t('That connection would create a loop.'), 'error');
                return;
            }

            const parent = nodesRef.current.find((node) => node.id === source);
            const image = parent?.data.images[parent.data.viewIndex ?? 0] ?? parent?.data.images[0];
            if (!image) {
                onNotify?.(t('The source node has no image yet — run it first.'), 'error');
                return;
            }

            const targetNode = nodesRef.current.find((node) => node.id === target);
            if (
                targetNode &&
                !targetNode.data.sourceFilenames.includes(image.filename) &&
                targetNode.data.sourceFilenames.length >= MAX_EDIT_SOURCES
            ) {
                onNotify?.(
                    t('An edit node can hold at most {max} source images. Remove one first.', {
                        max: MAX_EDIT_SOURCES
                    }),
                    'error'
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

    /**
     * Which dot the current drag was picked up from.
     *
     * Only the free drop needs this. A drag that ends on a dot hands back a connection oriented by the
     * two dots themselves, so `onConnect` can wire it as it arrives; a drag that ends on a card has no
     * handle to read, which is why `onConnectEnd` below falls back to this: starting from the right dot
     * means "this node feeds the other one", starting from the left dot means the node being dragged is
     * the one that wants a picture. Both paths then mean the same thing however the link was made.
     */
    const connectionStart = React.useRef<{ nodeId: string; handleType: 'source' | 'target' } | null>(null);

    const onConnectStart = React.useCallback(
        (
            _event: MouseEvent | TouchEvent,
            params: { nodeId: string | null; handleId: string | null; handleType: 'source' | 'target' | null }
        ) => {
            connectionStart.current =
                params.nodeId && params.handleType ? { nodeId: params.nodeId, handleType: params.handleType } : null;
        },
        []
    );

    /**
     * A drag that landed on a dot.
     *
     * React Flow reports the connection already oriented by the two *dots* it would join: the dot the
     * drag started from decides whether this node is the one giving its picture or the one taking one
     * — which is exactly the meaning the board gives its two dots. So it is wired as it arrives.
     *
     * Reading the direction off the drag origin here instead (the way the free-drop path below has to,
     * because there it has nothing but node ids) flipped the link whenever a drag that had started on
     * a left dot ended on a dot: "this node wants that picture" came out as "that node wants this one".
     */
    const onConnect = React.useCallback(
        (connection: Connection) => {
            wireConnection(connection.source, connection.target);
        },
        [wireConnection]
    );

    /**
     * React Flow only snaps a connection onto a dot. Users drop on the card — the picture, the prompt,
     * the buttons — so the node under the pointer is resolved here and wired the way the drag began.
     */
    const onConnectEnd = React.useCallback(
        (
            event: MouseEvent | TouchEvent,
            state: { isValid: boolean | null; fromNode: { id: string } | null; toNode: { id: string } | null }
        ) => {
            const start = connectionStart.current;
            connectionStart.current = null;

            // Landing on a dot already ran onConnect.
            if (state.isValid) return;

            let droppedId: string | null = state.toNode?.id ?? null;
            if (!droppedId) {
                const point = 'changedTouches' in event ? event.changedTouches[0] : event;
                droppedId = nodeIdAtPoint(point.clientX, point.clientY);
            }
            if (!droppedId) return;

            const draggedId = start?.nodeId ?? state.fromNode?.id ?? null;
            if (!draggedId || draggedId === droppedId) return;

            // The dot the user picked up decides which end of the new link they were holding.
            if (start?.handleType === 'target') wireConnection(droppedId, draggedId);
            else wireConnection(draggedId, droppedId);
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

    const deleteNodeNow = React.useCallback(
        (id: string) => {
            snapshot();
            // A queued generation for a node that no longer exists would be billed and then thrown
            // away, so it is dropped here (see cancelCanvasRuns).
            reportStoppedRuns(cancelCanvasRuns(canvasId, [id]));
            // The mask is deliberately left alone: it belongs to the source picture, not to this node,
            // so undo brings the node back with its mask still applied — and another node on this
            // board may be editing the same picture.
            setNodes((prev) => prev.filter((node) => node.id !== id));
        },
        [canvasId, reportStoppedRuns, setNodes, snapshot]
    );

    const deleteNode = React.useCallback(
        (id: string) => {
            setPendingConfirm({
                title: t('Delete node'),
                body: t('Delete this node? You can undo this with Ctrl+Z.'),
                confirmLabel: t('Delete'),
                run: () => deleteNodeNow(id)
            });
        },
        [deleteNodeNow, t]
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

    /** Keyboard shortcuts beyond React Flow's own: run and delete whatever is selected. */
    React.useEffect(() => {
        if (!active) return;
        const onKeyDown = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;

            const selectedNode = nodesRef.current.find((node) => node.selected);
            if (!selectedNode) return;

            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                runNode(selectedNode.id);
            }
            if ((event.key === 'Delete' || event.key === 'Backspace') && !event.metaKey && !event.ctrlKey) {
                event.preventDefault();
                deleteNode(selectedNode.id);
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [active, deleteNode, runNode]);

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

    /**
     * Lays the graph out left-to-right by lineage and removes every overlap.
     *
     * Nodes are grouped into layers by walking their sources (a node always sits one column right of
     * the deepest node it depends on), then stacked inside the column using their *measured* height —
     * collapsed and expanded cards differ by hundreds of pixels, so guessing a constant height would
     * leave gaps or overlaps. Columns are ordered by the average y of their parents to keep the
     * lineage lines short.
     */
    const autoArrange = React.useCallback(() => {
        const current = nodesRef.current;
        if (current.length === 0) return;
        snapshot();

        // The layout itself is a pure function in lib/canvas-layout.ts — testable without mounting
        // React Flow, and no longer 70 lines inside an already oversized component.
        const placed = arrangeByLineage(current);

        setNodes((prev) => prev.map((node) => (placed.has(node.id) ? { ...node, position: placed.get(node.id)! } : node)));
        window.setTimeout(() => fitView({ padding: 0.15, duration: 400, minZoom: 0.2 }), 60);
        onNotify?.(t('Arranged {count} node(s) with no overlap.', { count: placed.size }), 'success');
    }, [fitView, onNotify, setNodes, snapshot, t]);

    /** Collapses or expands every node at once — handy on a board full of long prompts. */
    const toggleCollapseAll = React.useCallback(() => {
        const shouldCollapse = nodesRef.current.some((node) => !node.data.collapsed);
        setNodes((prev) => prev.map((node) => ({ ...node, data: { ...node.data, collapsed: shouldCollapse } })));
        onNotify?.(
            shouldCollapse ? t('Collapsed every node.') : t('Expanded every node.'),
            'info'
        );
    }, [onNotify, setNodes, t]);

    const runClearCanvas = React.useCallback(() => {
        snapshot();
        reportStoppedRuns(cancelCanvasRuns(canvasId));
        // Masks are intentionally left in IndexedDB. They belong to the source pictures, which are not
        // going anywhere, and dropping them is what used to make "clear the canvas, then undo" lose
        // every painted mask. They are released when the canvas or the picture is deleted for good.
        setNodes([]);
    }, [canvasId, reportStoppedRuns, setNodes, snapshot]);

    /** Asks first — in an app dialog, matching the history/cleanup flows instead of window.confirm. */
    const clearCanvas = React.useCallback(() => {
        setPendingConfirm({
            title: t('Clear canvas'),
            body: t('Clear the whole canvas? You can undo this with Ctrl+Z.'),
            confirmLabel: t('Clear canvas'),
            run: () => {
                explicitClear.current = true;
                runClearCanvas();
            }
        });
    }, [runClearCanvas, t]);

    /** Writes the canvas to a JSON file so a bad day is recoverable. */
    const exportCanvas = React.useCallback(() => {
        const payload = buildCanvasExport(nodesRef.current);
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = canvasExportFilename();
        // The anchor has to be in the document, and the object URL must outlive the click: revoking it
        // immediately makes Safari cancel the download.
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        onNotify?.(t('Canvas exported.'), 'success');
    }, [onNotify, t]);

    const canvasImportRef = React.useRef<HTMLInputElement>(null);

    const importCanvas = React.useCallback(
        async (file: File | undefined) => {
            if (!file) return;
            try {
                // Sanitised on the way in: a hand-edited or truncated file used to be spread straight
                // into state, and one bad record took the board down on the next render.
                const imported = parseCanvasImport(await file.text()) ?? [];
                if (imported.length === 0) {
                    onNotify?.(t('That file contains no canvas nodes.'), 'error');
                    return;
                }
                setPendingConfirm({
                    title: t('Import'),
                    body: t('Replace the current canvas with {count} node(s) from this file?', {
                        count: imported.length
                    }),
                    confirmLabel: t('Import'),
                    run: () => {
                        snapshot();
                        explicitClear.current = true;
                        // The imported nodes replace every id on the board, so a run still in flight
                        // for one of the old ones is work whose result could never be shown.
                        reportStoppedRuns(cancelCanvasRuns(canvasId));
                        setNodes(imported);
                        window.setTimeout(() => fitView({ padding: 0.2, duration: 300, minZoom: 0.5 }), 80);
                        onNotify?.(t('Imported {count} node(s).', { count: imported.length }), 'success');
                    }
                });
            } catch (error) {
                console.error('Canvas import failed:', error);
                onNotify?.(t('That file is not a valid canvas export.'), 'error');
            }
        },
        [canvasId, fitView, onNotify, reportStoppedRuns, setNodes, snapshot, t]
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
            ref={boardRef}
            // Same height as the rail next to it, so the board's bottom edge lines up with the
            // settings button instead of stopping 24px short.
            className='relative h-[calc(100dvh-1rem)] min-h-[560px] w-full overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-20px_rgba(15,23,42,0.25)]'
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
            {/* Floating toolbar: centred over the board so it costs no vertical space, wrapping
                instead of clipping on narrow windows, grouped by intent. */}
            <div className='pointer-events-none absolute top-3 left-1/2 z-10 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 rounded-xl border border-slate-200/70 bg-white/90 px-2 py-1.5 shadow-[0_1px_2px_rgba(15,23,42,0.06),0_8px_24px_-16px_rgba(15,23,42,0.35)] backdrop-blur-sm'>
                <Button
                    type='button'
                    size='sm'
                    onClick={() => addNode('generate')}
                    className='pointer-events-auto h-8 bg-indigo-600 text-white shadow-sm hover:bg-indigo-500'>
                    <Plus className='mr-1.5 h-4 w-4' /> {t('New generate node')}
                </Button>
                <Button
                    type='button'
                    size='sm'
                    onClick={() => openUploadPicker()}
                    className='pointer-events-auto h-8 bg-indigo-600 text-white shadow-sm hover:bg-indigo-500'>
                    <ImagePlus className='mr-1.5 h-4 w-4' /> {t('Upload image')}
                </Button>

                <span className='mx-0.5 h-5 w-px bg-slate-200' aria-hidden='true' />

                <ToolbarIconButton
                    icon={ImagePlus}
                    label={t('New edit node')}
                    onClick={() => addNode('edit')}
                />
                <ToolbarIconButton
                    icon={LayoutGrid}
                    label={t('Fit view')}
                    onClick={() => fitView({ padding: 0.2, duration: 300, minZoom: 0.35 })}
                />
                <ToolbarIconButton icon={Scaling} label={t('Zoom to 100%')} onClick={() => void zoomTo(1, { duration: 200 })} />
                <ToolbarIconButton
                    icon={LayoutDashboard}
                    label={t('Auto arrange')}
                    disabled={nodes.length === 0}
                    onClick={autoArrange}
                />
                <ToolbarIconButton
                    icon={nodes.some((node) => !node.data.collapsed) ? ChevronsDownUp : ChevronsUpDown}
                    label={nodes.some((node) => !node.data.collapsed) ? t('Collapse all') : t('Expand all')}
                    disabled={nodes.length === 0}
                    onClick={toggleCollapseAll}
                />

                <span className='mx-0.5 h-5 w-px bg-slate-200' aria-hidden='true' />

                <ToolbarIconButton icon={Undo2} label={t('Undo (Ctrl+Z)')} onClick={undo} />

                <div className='pointer-events-auto relative'>
                    <ToolbarIconButton
                        icon={MoreHorizontal}
                        label={t('More')}
                        expanded={isMenuOpen}
                        onClick={() => setIsMenuOpen((prev) => !prev)}
                    />
                    {isMenuOpen && (
                        <>
                            <div className='fixed inset-0 z-10' onClick={() => setIsMenuOpen(false)} />
                            <div className='absolute right-0 z-20 mt-1.5 w-48 rounded-lg border border-slate-200 bg-white p-1 shadow-lg'>
                                <button
                                    type='button'
                                    title={t('Download the canvas as a JSON file')}
                                    disabled={nodes.length === 0}
                                    onClick={() => {
                                        setIsMenuOpen(false);
                                        exportCanvas();
                                    }}
                                    className='flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40'>
                                    <Download className='h-3.5 w-3.5' />
                                    {t('Export')}
                                </button>
                                <button
                                    type='button'
                                    title={t('Restore a canvas from a JSON file')}
                                    onClick={() => {
                                        setIsMenuOpen(false);
                                        canvasImportRef.current?.click();
                                    }}
                                    className='flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-slate-600 hover:bg-slate-100 hover:text-slate-900'>
                                    <Upload className='h-3.5 w-3.5' />
                                    {t('Import')}
                                </button>
                                <div className='my-1 h-px bg-slate-100' />
                                <button
                                    type='button'
                                    disabled={nodes.length === 0}
                                    onClick={() => {
                                        setIsMenuOpen(false);
                                        clearCanvas();
                                    }}
                                    className='flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-red-600 hover:bg-red-50 disabled:opacity-40'>
                                    <Trash2 className='h-3.5 w-3.5' />
                                    {t('Clear canvas')}
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>

            <Dialog open={!!pendingConfirm} onOpenChange={(open) => !open && setPendingConfirm(null)}>
                <DialogContent className='border-slate-200 bg-white text-slate-900 sm:max-w-md'>
                    <DialogHeader>
                        <DialogTitle className='text-base'>{pendingConfirm?.title}</DialogTitle>
                        <DialogDescription className='pt-1 text-slate-600'>{pendingConfirm?.body}</DialogDescription>
                    </DialogHeader>
                    <DialogFooter className='gap-2 sm:justify-end'>
                        <Button
                            type='button'
                            variant='outline'
                            size='sm'
                            onClick={() => setPendingConfirm(null)}
                            className='border-slate-300 text-slate-600 hover:bg-slate-200 hover:text-slate-900'>
                            {t('Cancel')}
                        </Button>
                        <Button
                            type='button'
                            size='sm'
                            onClick={() => {
                                const action = pendingConfirm?.run;
                                setPendingConfirm(null);
                                action?.();
                            }}
                            className='bg-red-600 text-white hover:bg-red-500'>
                            {pendingConfirm?.confirmLabel ?? t('Confirm')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <TaskNodeActionsProvider actions={actions}>
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    onConnectStart={onConnectStart}
                    onConnectEnd={onConnectEnd}
                    isValidConnection={(connection) => !createsCycle(connection.source, connection.target)}
                    connectionMode={ConnectionMode.Loose}
                    connectionRadius={48}
                    connectionLineComponent={ConnectionLine}
                    nodeTypes={nodeTypes}
                    onInit={(instance) => {
                        // Prefer exactly where the user left off; only frame the graph the first time.
                        const boardSize = {
                            width: boardRef.current?.clientWidth ?? 0,
                            height: boardRef.current?.clientHeight ?? 0
                        };
                        const saved = loadCanvasViewport(canvasId, boardSize);
                        if (saved) {
                            void instance.setViewport(saved, { duration: 0 });
                        } else {
                            // fitView's own minZoom option does not clamp the result, so the floor is
                            // applied by hand: a graph that does not fit should be scrolled, not shrunk
                            // into an unreadable thumbnail.
                            void instance.fitView({ padding: 0.2 }).then(() => {
                                const fitted = instance.getViewport();
                                if (fitted.zoom < MIN_INITIAL_ZOOM) {
                                    void instance.setViewport({ ...fitted, zoom: MIN_INITIAL_ZOOM }, { duration: 0 });
                                }
                            });
                        }
                        setViewportReady(true);
                    }}
                    onMoveEnd={(_event, viewport) => {
                        // React Flow emits move events while mounting; ignoring those keeps the first
                        // frame from overwriting the stored viewport with the default one.
                        if (!viewportReady) return;
                        saveCanvasViewport(canvasId, {
                            ...viewport,
                            width: boardRef.current?.clientWidth ?? 0,
                            height: boardRef.current?.clientHeight ?? 0
                        });
                    }}
                    zoomOnDoubleClick={false}
                    // React Flow's default is Backspace, and its key handler is bound on `document`
                    // — it fired before this component's own window-level one. Selecting a node and
                    // pressing Backspace therefore deleted it through onNodesChange, skipping the
                    // confirm dialog, the undo snapshot and the IndexedDB mask cleanup, even though
                    // the dialog promises "you can undo this with Ctrl+Z". Only this component's
                    // path deletes now.
                    deleteKeyCode={null}
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
                            // The mask belongs to the picture being painted on, so that is the key it is
                            // read from and written back to — see lib/mask-store.ts.
                            maskKey={maskKey(canvasId, maskTarget.filename)}
                            hasMask={masks.has(maskKey(canvasId, maskTarget.filename))}
                            multiSource={
                                (nodes.find((node) => node.id === maskTarget.nodeId)?.data.sourceFilenames.length ?? 0) > 1
                            }
                            onMaskChange={(file: File | null) =>
                                void persistMask(maskKey(canvasId, maskTarget.filename), file)
                            }
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


/** React Flow's context has to wrap the board, so the workbench itself lives in `CanvasFlow`. */
export function CanvasBoard(props: CanvasBoardProps) {
    return (
        <ReactFlowProvider>
            <CanvasFlow {...props} />
        </ReactFlowProvider>
    );
}
