'use client';

import type { HistoryMetadata } from '@/app/page';
import { MaskEditor } from '@/components/mask-editor';
import { TaskNode, TaskNodeActionsProvider, type TaskNodeActions, type TaskNodeType } from '@/components/canvas/task-node';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { createTaskData, type CanvasTaskData, type CanvasTaskParams } from '@/lib/canvas-types';
import { runCanvasTask } from '@/lib/canvas-run';
import { calculateApiCost } from '@/lib/cost-utils';
import { useI18n } from '@/lib/i18n';
import {
    Background,
    BackgroundVariant,
    Controls,
    MiniMap,
    ReactFlow,
    ReactFlowProvider,
    useEdgesState,
    useNodesState,
    useReactFlow,
    type Edge,
    type Node
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Brush, ImagePlus, LayoutGrid, Plus, Sparkles, Trash2 } from 'lucide-react';
import Image from 'next/image';
import * as React from 'react';

const STORAGE_KEY = 'gptImageCanvas';
const NODE_GAP_X = 440;
const NODE_GAP_Y = 120;

type CanvasSnapshot = {
    nodes: TaskNodeType[];
    edges: Edge[];
};

type CanvasBoardProps = {
    onTaskComplete?: (entry: HistoryMetadata) => void;
    passwordHash?: string | null;
};

function loadSnapshot(): CanvasSnapshot {
    if (typeof window === 'undefined') return { nodes: [], edges: [] };
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return { nodes: [], edges: [] };
        const parsed = JSON.parse(raw) as CanvasSnapshot;
        const nodes = Array.isArray(parsed.nodes)
            ? parsed.nodes.map((node) => ({
                  ...node,
                  // A node interrupted by a reload must not stay stuck in the "running" state, and a mask
                  // File cannot be persisted, so its badge is cleared with it.
                  data: {
                      ...node.data,
                      status: node.data.status === 'running' ? 'idle' : node.data.status,
                      maskFileName: null
                  }
              }))
            : [];
        return { nodes, edges: Array.isArray(parsed.edges) ? parsed.edges : [] };
    } catch (error) {
        console.error('Failed to read the saved canvas:', error);
        return { nodes: [], edges: [] };
    }
}

function CanvasFlow({ onTaskComplete, passwordHash }: CanvasBoardProps) {
    const { t } = useI18n();
    const initial = React.useMemo(loadSnapshot, []);
    const [nodes, setNodes, onNodesChange] = useNodesState<TaskNodeType>(initial.nodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);
    const [maskTarget, setMaskTarget] = React.useState<{ nodeId: string; filename: string; path: string } | null>(null);
    const [expanded, setExpanded] = React.useState<{ path: string; filename: string } | null>(null);
    const { screenToFlowPosition, fitView } = useReactFlow();

    const nodesRef = React.useRef(nodes);
    nodesRef.current = nodes;
    const maskFiles = React.useRef(new Map<string, File>());
    const skipFirstSave = React.useRef(true);

    React.useEffect(() => {
        if (skipFirstSave.current) {
            skipFirstSave.current = false;
            return;
        }
        const timer = window.setTimeout(() => {
            try {
                window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ nodes, edges }));
            } catch (error) {
                console.error('Failed to save the canvas:', error);
            }
        }, 400);
        return () => window.clearTimeout(timer);
    }, [nodes, edges]);

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

    const runNode = React.useCallback(
        async (id: string) => {
            const node = nodesRef.current.find((item) => item.id === id);
            if (!node) return;
            if (!node.data.prompt.trim()) return;

            const startedAt = Date.now();
            patchNode(id, { status: 'running', error: null });

            try {
                const { images, usage } = await runCanvasTask({
                    kind: node.data.kind,
                    prompt: node.data.prompt,
                    params: node.data.params,
                    sourceFilenames: node.data.sourceFilenames,
                    maskFile: maskFiles.current.get(id) ?? null,
                    passwordHash
                });
                const durationMs = Date.now() - startedAt;
                const costDetails = calculateApiCost(usage, node.data.params.model);

                patchNode(id, { status: 'idle', images, usage, costDetails, durationMs, error: null });
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
            }
        },
        [onTaskComplete, passwordHash, patchNode, t]
    );

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
            window.setTimeout(() => fitView({ padding: 0.25, duration: 300 }), 80);
            return id;
        },
        [fitView, screenToFlowPosition, setNodes]
    );

    const deriveEditNode = React.useCallback(
        (id: string) => {
            const parent = nodesRef.current.find((node) => node.id === id);
            const image = parent?.data.images[0];
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
            setEdges((prev) => [
                ...prev,
                {
                    id: `edge-${id}-${newId}`,
                    source: id,
                    target: newId,
                    animated: true,
                    style: { stroke: '#a5b4fc', strokeWidth: 2 }
                }
            ]);
            window.setTimeout(() => fitView({ padding: 0.25, duration: 300 }), 80);
        },
        [findFreePosition, fitView, setEdges, setNodes]
    );

    const deleteNode = React.useCallback(
        (id: string) => {
            if (!window.confirm(t('Delete this node? This cannot be undone.'))) return;
            maskFiles.current.delete(id);
            setNodes((prev) => prev.filter((node) => node.id !== id));
            setEdges((prev) => prev.filter((edge) => edge.source !== id && edge.target !== id));
        },
        [setEdges, setNodes, t]
    );

    const clearCanvas = React.useCallback(() => {
        if (!window.confirm(t('Clear the whole canvas? This cannot be undone.'))) return;
        maskFiles.current.clear();
        setNodes([]);
        setEdges([]);
    }, [setEdges, setNodes, t]);

    const actions = React.useMemo<TaskNodeActions>(
        () => ({
            onPatch: patchNode,
            onPatchParams: patchParams,
            onRun: runNode,
            onDeriveEdit: deriveEditNode,
            onOpenMask: (id, image) => setMaskTarget({ nodeId: id, filename: image.filename, path: image.path }),
            onDelete: deleteNode,
            onExpand: (image) => setExpanded(image)
        }),
        [deleteNode, deriveEditNode, patchNode, patchParams, runNode]
    );

    const nodeTypes = React.useMemo(() => ({ task: TaskNode }), []);

    return (
        <div className='relative h-[78vh] min-h-[640px] w-full overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-20px_rgba(15,23,42,0.25)]'>
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
                    onClick={() => addNode('edit')}
                    className='pointer-events-auto border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-100 hover:text-slate-900'>
                    <ImagePlus className='mr-1.5 h-4 w-4' /> {t('New edit node')}
                </Button>
                <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => fitView({ padding: 0.2, duration: 300 })}
                    className='pointer-events-auto border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-100 hover:text-slate-900'>
                    <LayoutGrid className='mr-1.5 h-4 w-4' /> {t('Fit view')}
                </Button>
                {nodes.length > 0 && (
                    <Button
                        type='button'
                        variant='outline'
                        size='sm'
                        onClick={clearCanvas}
                        className='pointer-events-auto border-slate-200 bg-white text-slate-500 shadow-sm hover:border-red-200 hover:bg-red-50 hover:text-red-600'>
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
                    nodeTypes={nodeTypes}
                    fitView
                    minZoom={0.15}
                    maxZoom={1.6}
                    className='canvas-shell bg-slate-50/60'>
                    <Background variant={BackgroundVariant.Dots} gap={18} size={1.5} color='#cbd5e1' />
                    <Controls className='!rounded-lg !border !border-slate-200 !bg-white !shadow-sm' showInteractive={false} />
                    <MiniMap
                        pannable
                        zoomable
                        className='!rounded-lg !border !border-slate-200 !bg-white'
                        nodeColor='#c7d2fe'
                        maskColor='rgba(241,245,249,0.7)'
                    />
                </ReactFlow>
            </TaskNodeActionsProvider>

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
                            hasMask={maskFiles.current.has(maskTarget.nodeId)}
                            onMaskChange={(file) => {
                                if (file) {
                                    maskFiles.current.set(maskTarget.nodeId, file);
                                } else {
                                    maskFiles.current.delete(maskTarget.nodeId);
                                }
                                patchNode(maskTarget.nodeId, { maskFileName: file ? file.name : null });
                            }}
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
    onMaskChange
}: {
    target: { nodeId: string; filename: string; path: string };
    hasMask: boolean;
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
