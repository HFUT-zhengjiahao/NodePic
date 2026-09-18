'use client';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { CanvasTaskData, CanvasTaskParams } from '@/lib/canvas-types';
import { useI18n } from '@/lib/i18n';
import { GPT_IMAGE_MODELS, MAX_EDIT_IMAGES, type GptImageModel } from '@/lib/models';
import { getPresetDimensions, type SizePreset } from '@/lib/size-utils';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import {
    Brush,
    Clock,
    CopyPlus,
    Download,
    ImageOff,
    Loader2,
    Maximize2,
    Play,
    Shuffle,
    Trash2,
    Wand2
} from 'lucide-react';
import Image from 'next/image';
import * as React from 'react';

export type TaskNodeType = Node<CanvasTaskData, 'task'>;

export type TaskNodeActions = {
    onPatch: (id: string, patch: Partial<CanvasTaskData>) => void;
    onPatchParams: (id: string, patch: Partial<CanvasTaskParams>) => void;
    onRun: (id: string) => void;
    onDeriveEdit: (id: string) => void;
    onClone: (id: string) => void;
    onRemoveSource: (id: string, filename: string) => void;
    onClearSources: (id: string) => void;
    onOpenMask: (id: string, image: { filename: string; path: string }) => void;
    onDelete: (id: string) => void;
    onExpand: (image: { filename: string; path: string }) => void;
};

const TaskNodeActionsContext = React.createContext<TaskNodeActions | null>(null);

export function TaskNodeActionsProvider({
    actions,
    children
}: {
    actions: TaskNodeActions;
    children: React.ReactNode;
}) {
    return <TaskNodeActionsContext.Provider value={actions}>{children}</TaskNodeActionsContext.Provider>;
}

export function useTaskNodeActions(): TaskNodeActions {
    const actions = React.useContext(TaskNodeActionsContext);
    if (!actions) throw new Error('useTaskNodeActions must be used inside <TaskNodeActionsProvider>.');
    return actions;
}

const selectClass =
    'nodrag h-7 w-full rounded-md border border-slate-200 bg-white px-1.5 text-[12px] text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50';

const SIZE_OPTIONS: Array<{ value: SizePreset; label: string }> = [
    { value: 'auto', label: 'Auto' },
    { value: 'square', label: 'Square' },
    { value: 'landscape', label: 'Landscape' },
    { value: 'portrait', label: 'Portrait' },
    { value: 'custom', label: 'Custom' }
];

const QUALITY_OPTIONS = ['auto', 'low', 'medium', 'high'] as const;
const BACKGROUND_OPTIONS = ['auto', 'opaque', 'transparent'] as const;
const FORMAT_OPTIONS = ['png', 'jpeg', 'webp'] as const;

export function TaskNode({ id, data, selected }: NodeProps<TaskNodeType>) {
    const { t } = useI18n();
    const actions = useTaskNodeActions();
    const [showParams, setShowParams] = React.useState(false);

    const isRunning = data.status === 'running';
    const isQueued = data.status === 'queued';
    const [imageIndex, setImageIndex] = React.useState(0);
    const visibleImage = data.images[Math.min(imageIndex, Math.max(0, data.images.length - 1))];
    const firstImage = data.images[0];
    const hasImage = !!visibleImage && !data.resultMissing;
    const isEdit = data.kind === 'edit';
    // A mask describes what the model may repaint, so it belongs to the *source* picture of an edit
    // node — never to that node's own result.
    const maskTarget = isEdit && data.sourceFilenames[0]
        ? { filename: data.sourceFilenames[0], path: `/api/image/${data.sourceFilenames[0]}` }
        : null;

    const sizeLabel = (value: SizePreset) => {
        if (value === 'custom') return `${data.params.customWidth}×${data.params.customHeight}`;
        const dims = getPresetDimensions(value);
        return dims ? dims.replace('x', '×') : t('Auto');
    };

    return (
        <div
            className={`w-[380px] overflow-hidden rounded-xl border bg-white text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.06),0_14px_36px_-24px_rgba(15,23,42,0.35)] transition-shadow ${
                selected ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-slate-200'
            }`}>
            <Handle
                type='target'
                position={Position.Left}
                className='!h-3 !w-3 !border-2 !border-white !bg-indigo-300 transition-transform hover:!scale-125'
            />

            {/* header */}
            <div className='flex items-center gap-2 border-b border-slate-100 px-3 py-2'>
                <span
                    className={`h-2 w-2 shrink-0 rounded-full ${isEdit ? 'bg-violet-500' : 'bg-indigo-500'}`}
                    aria-hidden='true'
                />
                <span className='text-[13px] font-semibold tracking-tight'>{isEdit ? t('Edit Image') : t('Generate Image')}</span>
                <select
                    className={`${selectClass} ml-auto !w-[150px]`}
                    value={data.params.model}
                    disabled={isRunning}
                    onChange={(event) => actions.onPatchParams(id, { model: event.target.value as GptImageModel })}>
                    {GPT_IMAGE_MODELS.map((model) => (
                        <option key={model} value={model}>
                            {model}
                        </option>
                    ))}
                </select>
                <button
                    type='button'
                    className='nodrag rounded p-1 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600'
                    title={t('Delete node')}
                    onClick={() => actions.onDelete(id)}>
                    <Trash2 className='h-3.5 w-3.5' />
                </button>
            </div>

            {/* source strip (edit nodes) */}
            {isEdit && (
                <div className='flex items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-3 py-2'>
                    <span className='text-[12px] text-slate-500'>{t('Source Image(s)')}</span>
                    <div className='flex items-center gap-1'>
                        {data.sourceFilenames.length === 0 && (
                            <span className='text-[12px] text-slate-400'>{t('None yet — click “Use as source” on another node')}</span>
                        )}
                        {data.sourceFilenames.slice(0, 4).map((filename) => (
                            <span
                                key={filename}
                                className='group/src relative block h-10 w-10 overflow-hidden rounded border border-slate-200 bg-white'>
                                <Image
                                    src={`/api/image/${filename}`}
                                    alt={filename}
                                    width={32}
                                    height={32}
                                    className='h-full w-full object-cover'
                                    unoptimized
                                />
                                <button
                                    type='button'
                                    title={t('Remove this source image')}
                                    onClick={() => actions.onRemoveSource(id, filename)}
                                    className='nodrag absolute top-0 right-0 flex h-[18px] w-[18px] items-center justify-center rounded-bl-md bg-slate-900/70 text-[13px] leading-none text-white transition-colors hover:bg-red-600'>
                                    ×
                                </button>
                            </span>
                        ))}
                        {data.sourceFilenames.length > 4 && (
                            <span className='text-[12px] text-slate-500'>+{data.sourceFilenames.length - 4}</span>
                        )}
                        {data.sourceFilenames.length > 0 && (
                            <button
                                type='button'
                                onClick={() => actions.onClearSources(id)}
                                title={t('Remove every source image')}
                                className='nodrag rounded px-1.5 py-1 text-[12px] text-slate-500 hover:bg-slate-100 hover:text-slate-800'>
                                {t('Clear sources')}
                            </button>
                        )}
                    </div>
                    {data.maskFileName && !data.sourceMissing && (
                        <span className='ml-auto rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-700'>
                            {t('Mask applied')}
                        </span>
                    )}
                    {data.sourceMissing && (
                        <>
                            <span
                                className='ml-auto rounded-full bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-700'
                                title={t('The file was deleted from the history, so this node cannot run.')}>
                                {t('Source image missing')}
                            </span>
                            <button
                                type='button'
                                onClick={() => actions.onClearSources(id)}
                                className='nodrag rounded-full border border-red-200 bg-white px-1.5 py-0.5 text-[11px] text-red-600 hover:bg-red-50'>
                                {t('Remove broken source')}
                            </button>
                        </>
                    )}
                </div>
            )}

            {/* result */}
            <div className='relative h-[210px] w-full bg-slate-50'>
                {isQueued && !firstImage ? (
                    <div className='flex h-full flex-col items-center justify-center gap-2 text-slate-500'>
                        <Clock className='h-6 w-6 text-amber-500' />
                        <span className='text-xs'>{t('Queued — waiting for a free slot…')}</span>
                    </div>
                ) : isRunning && !firstImage ? (
                    <div className='flex h-full flex-col items-center justify-center gap-2 text-slate-500'>
                        <Loader2 className='h-6 w-6 animate-spin text-indigo-500' />
                        <span className='text-xs'>{t('Generating…')}</span>
                    </div>
                ) : hasImage && visibleImage ? (
                    <>
                        <Image
                            src={visibleImage.path}
                            alt={data.prompt || t('Generated image output')}
                            fill
                            sizes='380px'
                            className='object-contain'
                            unoptimized
                        />
                        {data.images.length > 1 && (
                            <div className='nodrag absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-slate-900/75 px-1.5 py-0.5 text-[11px] text-white'>
                                <button
                                    type='button'
                                    className='rounded px-1 hover:bg-white/20'
                                    onClick={() => setImageIndex((prev) => (prev - 1 + data.images.length) % data.images.length)}>
                                    ‹
                                </button>
                                <span>{Math.min(imageIndex, data.images.length - 1) + 1}/{data.images.length}</span>
                                <button
                                    type='button'
                                    className='rounded px-1 hover:bg-white/20'
                                    onClick={() => setImageIndex((prev) => (prev + 1) % data.images.length)}>
                                    ›
                                </button>
                            </div>
                        )}
                    </>
                ) : data.resultMissing ? (
                    <div className='flex h-full flex-col items-center justify-center gap-2 px-4 text-center'>
                        <ImageOff className='h-6 w-6 text-amber-500' />
                        <span className='text-[11px] leading-relaxed text-amber-700'>
                            {t('This node’s image file was deleted. Run it again to recreate the picture.')}
                        </span>
                    </div>
                ) : data.sourceMissing ? (
                    <div className='flex h-full flex-col items-center justify-center gap-2 px-4 text-center'>
                        <ImageOff className='h-6 w-6 text-red-400' />
                        <span className='text-[11px] leading-relaxed text-red-600'>
                            {t('A source image of this node no longer exists. Re-run its parent node or connect a new source.')}
                        </span>
                    </div>
                ) : data.status === 'error' ? (
                    <div className='flex h-full flex-col items-center justify-center gap-2 px-4 text-center'>
                        <ImageOff className='h-6 w-6 text-red-400' />
                        <span className='text-[12px] leading-relaxed text-red-600'>{data.error}</span>
                    </div>
                ) : (
                    <div className='flex h-full flex-col items-center justify-center gap-2 text-slate-400'>
                        <Wand2 className='h-6 w-6' />
                        <span className='px-6 text-center text-[12px]'>{t('Write a prompt, then run this node.')}</span>
                    </div>
                )}

                {hasImage && firstImage && (
                    <div className='absolute top-2 right-2 flex gap-1 opacity-85 transition-opacity hover:opacity-100'>
                        <button
                            type='button'
                            className='nodrag rounded-md border border-slate-200 bg-white/95 p-1.5 text-slate-500 shadow-sm hover:text-slate-900'
                            title={t('Expand')}
                            onClick={() => visibleImage && actions.onExpand(visibleImage)}>
                            <Maximize2 className='h-3.5 w-3.5' />
                        </button>
                        <a
                            className='nodrag rounded-md border border-slate-200 bg-white/95 p-1.5 text-slate-500 shadow-sm hover:text-slate-900'
                            title={t('Download')}
                            href={visibleImage.path}
                            download={visibleImage.filename}>
                            <Download className='h-3.5 w-3.5' />
                        </a>
                    </div>
                )}
            </div>

            {/* prompt + actions */}
            <div className='space-y-2 px-3 py-2.5'>
                <Textarea
                    value={data.prompt}
                    onChange={(event) => actions.onPatch(id, { prompt: event.target.value })}
                    placeholder={isEdit ? t('e.g., Add a party hat to the main subject') : t('e.g., A photorealistic cat astronaut floating in space')}
                    disabled={isRunning}
                    className='nodrag nowheel min-h-[64px] resize-y rounded-lg border-slate-200 bg-white text-[13px] text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100'
                />

                <div className='flex items-center gap-2'>
                    <Button
                        type='button'
                        size='sm'
                        disabled={isRunning || isQueued || !data.prompt.trim()}
                        onClick={() => actions.onRun(id)}
                        className='nodrag h-8 flex-1 bg-indigo-600 text-[13px] text-white shadow-sm hover:bg-indigo-500 disabled:bg-slate-200 disabled:text-slate-400'>
                        {isRunning || isQueued ? (
                            <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
                        ) : (
                            <Play className='mr-1.5 h-3.5 w-3.5' />
                        )}
                        {isQueued ? t('Queued…') : isRunning ? t('Generating…') : isEdit ? t('Edit Image') : t('Generate')}
                    </Button>
                    <Button
                        type='button'
                        variant='outline'
                        size='sm'
                        disabled={!hasImage || isRunning}
                        title={t('Use as source for edit')}
                        onClick={() => actions.onDeriveEdit(id)}
                        className='nodrag h-8 border-slate-200 px-2 text-[12px] text-slate-600 hover:bg-slate-100 hover:text-slate-900'>
                        <Shuffle className='mr-1 h-3.5 w-3.5' />
                        {t('Branch edit')}
                    </Button>
                    <Button
                        type='button'
                        variant='outline'
                        size='sm'
                        disabled={isRunning}
                        title={t('Clone node (same prompt and settings, no result)')}
                        onClick={() => actions.onClone(id)}
                        className='nodrag h-8 border-slate-200 px-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900'>
                        <CopyPlus className='h-3.5 w-3.5' />
                    </Button>
                    <Button
                        type='button'
                        variant='outline'
                        size='sm'
                        disabled={!maskTarget || isRunning}
                        title={isEdit ? t('Mask') : t('Masks only apply to edit nodes')}
                        onClick={() => maskTarget && actions.onOpenMask(id, maskTarget)}
                        className='nodrag h-8 border-slate-200 px-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900'>
                        <Brush className='h-3.5 w-3.5' />
                    </Button>
                </div>

                <div className='flex items-center gap-2 text-[12px] text-slate-500'>
                    <button
                        type='button'
                        className='nodrag rounded px-1 py-0.5 hover:bg-slate-100 hover:text-slate-900'
                        onClick={() => setShowParams((prev) => !prev)}>
                        {showParams ? t('Hide parameters') : t('Show parameters')}
                    </button>
                    <span className='ml-auto'>
                        {sizeLabel(data.params.size)} · {data.params.quality} · {data.params.outputFormat.toUpperCase()}
                    </span>
                </div>

                {showParams && (
                    <div className='nodrag grid grid-cols-4 gap-1.5 pt-0.5'>
                        <select
                            className={selectClass}
                            value={data.params.size}
                            disabled={isRunning}
                            onChange={(event) => actions.onPatchParams(id, { size: event.target.value as SizePreset })}>
                            {SIZE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {t(option.label)}
                                </option>
                            ))}
                        </select>
                        <select
                            className={selectClass}
                            value={data.params.quality}
                            disabled={isRunning}
                            onChange={(event) =>
                                actions.onPatchParams(id, { quality: event.target.value as CanvasTaskParams['quality'] })
                            }>
                            {QUALITY_OPTIONS.map((option) => (
                                <option key={option} value={option}>
                                    {t(option.charAt(0).toUpperCase() + option.slice(1))}
                                </option>
                            ))}
                        </select>
                        <select
                            className={selectClass}
                            value={data.params.background}
                            disabled={isRunning}
                            onChange={(event) =>
                                actions.onPatchParams(id, {
                                    background: event.target.value as CanvasTaskParams['background']
                                })
                            }>
                            {BACKGROUND_OPTIONS.map((option) => (
                                <option key={option} value={option}>
                                    {t(option.charAt(0).toUpperCase() + option.slice(1))}
                                </option>
                            ))}
                        </select>
                        <select
                            className={selectClass}
                            value={data.params.outputFormat}
                            disabled={isRunning}
                            onChange={(event) =>
                                actions.onPatchParams(id, {
                                    outputFormat: event.target.value as CanvasTaskParams['outputFormat']
                                })
                            }>
                            {FORMAT_OPTIONS.map((option) => (
                                <option key={option} value={option}>
                                    {option.toUpperCase()}
                                </option>
                            ))}
                        </select>
                    </div>
                )}

                {(data.durationMs || data.costDetails) && (
                    <div className='flex items-center gap-3 text-[12px] text-slate-400'>
                        {data.durationMs ? <span>{(data.durationMs / 1000).toFixed(1)}s</span> : null}
                        {data.costDetails ? <span>${data.costDetails.estimated_cost_usd.toFixed(4)}</span> : null}
                    </div>
                )}
            </div>

            <Handle
                type='source'
                position={Position.Right}
                title={t('Drag to connect this node to another')}
                className='!h-3.5 !w-3.5 !border-2 !border-white !bg-indigo-500 transition-transform hover:!scale-125'
            />
        </div>
    );
}
