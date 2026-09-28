'use client';

import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { imageUrl } from '@/lib/image-url';
import { canvasStats, type CanvasMeta } from '@/lib/canvas-store';
import {
    Check,
    ChevronLeft,
    ChevronRight,
    Copy,
    History,
    ImageOff,
    Pencil,
    Plus,
    Trash2,
    Workflow
} from 'lucide-react';
import Image from 'next/image';
import * as React from 'react';

export type WorkspaceView = 'canvas' | 'history' | 'trash';

export type CanvasSidebarProps = {
    view: WorkspaceView;
    onViewChange: (view: WorkspaceView) => void;
    canvases: CanvasMeta[];
    activeId: string;
    /** Bumped whenever the open canvas is saved, so the node counts and previews refresh. */
    revision: number;
    collapsed: boolean;
    onToggleCollapsed: () => void;
    onSelect: (id: string) => void;
    onCreate: () => void;
    onRename: (id: string, name: string) => void;
    onDuplicate: (id: string) => void;
    onDelete: (id: string) => void;
    /** How many canvases sit in the recycle bin, shown as a badge on its nav entry. */
    trashCount: number;
    /** Rendered at the bottom of the rail — the settings panel sits here, not on the canvas. */
    footer?: React.ReactNode;
};

function formatWhen(timestamp: number): string {
    const date = new Date(timestamp);
    const today = new Date();
    const sameDay = date.toDateString() === today.toDateString();
    return sameDay
        ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : date.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
}

/**
 * The single navigation surface: workspace views on top, saved canvases below.
 *
 * The project's mark and name sit at the very top (the app's top-left corner), above the workspace
 * views. It collapses to a narrow strip so the board can use the whole window, and each canvas card
 * shows a preview of its newest picture — with several boards named "画布 N" that thumbnail is the
 * only way to tell them apart at a glance.
 */
export function CanvasSidebar({
    view,
    onViewChange,
    canvases,
    activeId,
    revision,
    collapsed,
    onToggleCollapsed,
    onSelect,
    onCreate,
    onRename,
    onDuplicate,
    onDelete,
    trashCount,
    footer
}: CanvasSidebarProps) {
    const { t } = useI18n();
    const [editingId, setEditingId] = React.useState<string | null>(null);
    const [draftName, setDraftName] = React.useState('');

    // Counts and previews live in storage, so they are recomputed when the list or board changes.
    const stats = React.useMemo(
        () => new Map(canvases.map((canvas) => [canvas.id, canvasStats(canvas.id)])),
        // `revision` is a deliberate cache-buster: the stats live in localStorage, which the
        // dependency checker cannot see. Without it the cards keep stale counts after every save.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [canvases, revision]
    );

    const navButton = (target: WorkspaceView, Icon: typeof Workflow, label: string, badge = 0) => {
        const active = view === target;
        return (
            <button
                type='button'
                onClick={() => onViewChange(target)}
                aria-pressed={active}
                title={badge > 0 ? `${label} (${badge})` : label}
                className={`relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] transition-colors ${
                    active ? 'bg-indigo-50 font-medium text-indigo-600' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                } ${collapsed ? 'w-8 justify-center' : ''}`}>
                <Icon className='h-4 w-4 shrink-0' />
                {!collapsed && <span className='truncate'>{label}</span>}
                {badge > 0 &&
                    (collapsed ? (
                        <span className='absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-indigo-500' aria-hidden='true' />
                    ) : (
                        <span className='ml-auto rounded-full bg-slate-200/70 px-1.5 text-[11px] font-medium text-slate-600'>
                            {badge}
                        </span>
                    ))}
            </button>
        );
    };

    if (collapsed) {
        return (
            <div className='sticky top-1 flex h-[calc(100dvh-1rem)] w-10 shrink-0 flex-col items-center gap-1.5 pt-1'>
                <Image
                    src='/logo.png'
                    alt='NodePic'
                    width={32}
                    height={32}
                    className='h-8 w-8 shrink-0'
                    unoptimized
                />
                <Button
                    type='button'
                    variant='outline'
                    size='icon'
                    onClick={onToggleCollapsed}
                    title={t('Show the sidebar')}
                    className='h-8 w-8 border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-100 hover:text-slate-900'>
                    <ChevronRight className='h-4 w-4' />
                </Button>
                {navButton('canvas', Workflow, t('Canvas'))}
                {navButton('history', History, t('History'))}
                {navButton('trash', Trash2, t('Recycle bin'), trashCount)}
                <Button
                    type='button'
                    variant='outline'
                    size='icon'
                    onClick={onCreate}
                    title={t('New canvas')}
                    className='h-8 w-8 border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-100 hover:text-slate-900'>
                    <Plus className='h-4 w-4' />
                </Button>
                <div className='mt-auto'>{footer}</div>
            </div>
        );
    }

    return (
        <aside className='sticky top-1 flex h-[calc(100dvh-1rem)] w-60 shrink-0 flex-col gap-3'>
            {/* The project's corner: the mark and the wordmark, side by side. */}
            <div className='flex items-center gap-2 rounded-xl border border-slate-200/70 bg-white px-2 py-1.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]'>
                <Image
                    src='/logo.png'
                    alt='NodePic'
                    width={40}
                    height={40}
                    className='h-9 w-9 shrink-0'
                    unoptimized
                />
                <Image
                    src='/wordmark.png'
                    alt=''
                    width={512}
                    height={170}
                    className='h-7 w-auto'
                    unoptimized
                />
            </div>

            <div className='flex flex-col gap-0.5'>
                {navButton('canvas', Workflow, t('Canvas'))}
                {navButton('history', History, t('History'))}
                {navButton('trash', Trash2, t('Recycle bin'), trashCount)}
            </div>

            <div className='flex min-h-0 flex-1 flex-col gap-2 border-t border-slate-200 pt-3'>
                <div className='flex items-center gap-1.5 px-1'>
                    <span className='text-[13px] font-semibold text-slate-700'>{t('Canvases')}</span>
                    <span className='rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500'>
                        {canvases.length}
                    </span>
                    <Button
                        type='button'
                        variant='outline'
                        size='icon'
                        onClick={onCreate}
                        title={t('New canvas')}
                        className='ml-auto h-7 w-7 border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-100 hover:text-slate-900'>
                        <Plus className='h-3.5 w-3.5' />
                    </Button>
                    <Button
                        type='button'
                        variant='ghost'
                        size='icon'
                        onClick={onToggleCollapsed}
                        title={t('Hide the sidebar')}
                        className='h-7 w-7 text-slate-400 hover:bg-slate-100 hover:text-slate-700'>
                        <ChevronLeft className='h-3.5 w-3.5' />
                    </Button>
                </div>

                <div className='flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-0.5'>
                    {canvases.map((canvas) => {
                        const active = canvas.id === activeId;
                        const stat = stats.get(canvas.id);
                        const editing = editingId === canvas.id;
                        // A 40px square preview: enough to tell two boards apart at a glance, without
                        // turning the rail into a wall of pictures that pushes the names out of view.
                        const preview = (
                            <span
                                title={stat?.thumbnail ? undefined : t('Empty canvas')}
                                className='relative h-10 w-10 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-100'>
                                {stat?.thumbnail ? (
                                    <Image
                                        src={imageUrl(stat.thumbnail)}
                                        alt=''
                                        fill
                                        sizes='80px'
                                        className='object-cover'
                                        unoptimized
                                    />
                                ) : (
                                    <span className='flex h-full w-full items-center justify-center text-slate-300'>
                                        <ImageOff className='h-4 w-4' />
                                    </span>
                                )}
                            </span>
                        );
                        const actionClass =
                            'flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-white hover:text-slate-700';
                        return (
                            <div
                                key={canvas.id}
                                // `shrink-0` is what keeps the rows readable: the list is a flex column,
                                // and a full one used to squeeze every card — with `overflow-hidden` on it,
                                // the canvas name ended up cut in half.
                                className={`group/item flex shrink-0 items-center gap-1.5 rounded-lg border px-1.5 py-1.5 transition-colors ${
                                    active
                                        ? 'border-indigo-200 bg-indigo-50'
                                        : 'border-transparent hover:border-slate-200 hover:bg-slate-50'
                                }`}>
                                {editing ? (
                                    <div className='flex min-w-0 flex-1 items-center gap-2'>
                                        {preview}
                                        <input
                                            autoFocus
                                            value={draftName}
                                            onChange={(event) => setDraftName(event.target.value)}
                                            onBlur={() => {
                                                onRename(canvas.id, draftName.trim() || canvas.name);
                                                setEditingId(null);
                                            }}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter') {
                                                    onRename(canvas.id, draftName.trim() || canvas.name);
                                                    setEditingId(null);
                                                }
                                                if (event.key === 'Escape') setEditingId(null);
                                            }}
                                            className='min-w-0 flex-1 rounded-md border border-indigo-300 bg-white px-1.5 py-1 text-[13px] text-slate-800 outline-none'
                                        />
                                    </div>
                                ) : (
                                    <button
                                        type='button'
                                        onClick={() => onSelect(canvas.id)}
                                        title={canvas.name}
                                        className='flex min-w-0 flex-1 items-center gap-2 text-left'>
                                        {preview}
                                        <span className='min-w-0 flex-1'>
                                            <span className='flex items-center gap-1'>
                                                {active && <Check className='h-3 w-3 shrink-0 text-indigo-500' />}
                                                <span
                                                    className={`truncate text-[13px] ${
                                                        active ? 'font-medium text-indigo-700' : 'text-slate-700'
                                                    }`}>
                                                    {canvas.name}
                                                </span>
                                            </span>
                                            <span className='mt-0.5 block truncate text-[11px] text-slate-400'>
                                                {t('{count} nodes', { count: stat?.nodeCount ?? 0 })} ·{' '}
                                                {formatWhen(canvas.updatedAt)}
                                            </span>
                                        </span>
                                    </button>
                                )}

                                {/* Always on screen instead of revealed on hover: a delete button the user
                                    has to hunt for is one that does not get found. */}
                                <div className='flex shrink-0 items-center'>
                                    <button
                                        type='button'
                                        title={t('Rename')}
                                        onClick={() => {
                                            setEditingId(canvas.id);
                                            setDraftName(canvas.name);
                                        }}
                                        className={actionClass}>
                                        <Pencil className='h-3.5 w-3.5' />
                                    </button>
                                    <button
                                        type='button'
                                        title={t('Duplicate')}
                                        onClick={() => onDuplicate(canvas.id)}
                                        className={actionClass}>
                                        <Copy className='h-3.5 w-3.5' />
                                    </button>
                                    <button
                                        type='button'
                                        title={
                                            canvases.length <= 1
                                                ? t('This is the only canvas — it cannot be deleted.')
                                                : t('Delete canvas')
                                        }
                                        disabled={canvases.length <= 1}
                                        onClick={() => onDelete(canvas.id)}
                                        className={`${actionClass} hover:bg-red-50 hover:text-red-600 disabled:hover:bg-transparent disabled:hover:text-slate-300`}>
                                        <Trash2 className='h-3.5 w-3.5' />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {footer && <div className='mt-auto border-t border-slate-200 pt-3'>{footer}</div>}
            </div>
        </aside>
    );
}
