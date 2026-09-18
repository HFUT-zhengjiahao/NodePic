'use client';

import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { canvasStats, type CanvasMeta } from '@/lib/canvas-store';
import { Check, ChevronLeft, ChevronRight, Copy, History, Pencil, Plus, Trash2, Workflow } from 'lucide-react';
import Image from 'next/image';
import * as React from 'react';

export type WorkspaceView = 'canvas' | 'history';

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
 * It collapses to a narrow strip so the board can use the whole window, and each canvas card shows a
 * preview of its newest picture — with several boards named "画布 N" that thumbnail is the only way
 * to tell them apart at a glance.
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
    footer
}: CanvasSidebarProps) {
    const { t } = useI18n();
    const [editingId, setEditingId] = React.useState<string | null>(null);
    const [draftName, setDraftName] = React.useState('');

    // Counts and previews live in storage, so they are recomputed when the list or board changes.
    const stats = React.useMemo(
        () => new Map(canvases.map((canvas) => [canvas.id, canvasStats(canvas.id)])),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [canvases, revision]
    );

    const navButton = (target: WorkspaceView, Icon: typeof Workflow, label: string) => {
        const active = view === target;
        return (
            <button
                type='button'
                onClick={() => onViewChange(target)}
                aria-pressed={active}
                title={label}
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] transition-colors ${
                    active ? 'bg-indigo-50 font-medium text-indigo-600' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                } ${collapsed ? 'w-8 justify-center' : ''}`}>
                <Icon className='h-4 w-4 shrink-0' />
                {!collapsed && <span className='truncate'>{label}</span>}
            </button>
        );
    };

    if (collapsed) {
        return (
            <div className='sticky top-1 flex h-[calc(100dvh-1rem)] w-10 shrink-0 flex-col items-center gap-1.5 pt-1'>
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
        <aside className='sticky top-1 flex h-[calc(100dvh-1rem)] w-56 shrink-0 flex-col gap-3'>
            <div className='flex flex-col gap-0.5'>
                {navButton('canvas', Workflow, t('Canvas'))}
                {navButton('history', History, t('History'))}
            </div>

            <div className='flex min-h-0 flex-1 flex-col gap-2 border-t border-slate-200 pt-3'>
                <div className='flex items-center gap-1 px-1'>
                    <span className='text-[13px] font-semibold text-slate-700'>{t('Canvases')}</span>
                    <span className='text-[11px] text-slate-400'>({canvases.length})</span>
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

                <div className='flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1'>
                    {canvases.map((canvas) => {
                        const active = canvas.id === activeId;
                        const stat = stats.get(canvas.id);
                        return (
                            <div
                                key={canvas.id}
                                className={`group/item overflow-hidden rounded-xl border transition-colors ${
                                    active
                                        ? 'border-indigo-300 bg-indigo-50'
                                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                                }`}>
                                <button type='button' onClick={() => onSelect(canvas.id)} className='block w-full text-left'>
                                    <span className='relative block h-20 w-full bg-slate-100'>
                                        {stat?.thumbnail ? (
                                            <Image
                                                src={`/api/image/${encodeURIComponent(stat.thumbnail)}`}
                                                alt=''
                                                fill
                                                sizes='220px'
                                                className='object-cover'
                                                unoptimized
                                            />
                                        ) : (
                                            <span className='flex h-full items-center justify-center text-[11px] text-slate-400'>
                                                {t('Empty canvas')}
                                            </span>
                                        )}
                                        {active && (
                                            <span className='absolute top-1.5 left-1.5 flex items-center gap-1 rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600'>
                                                <Check className='h-3 w-3' />
                                                {t('Open')}
                                            </span>
                                        )}
                                    </span>
                                    <span className='block px-2 pt-1.5 pb-0.5'>
                                        {editingId === canvas.id ? null : (
                                            <span
                                                className={`block truncate text-[13px] ${
                                                    active ? 'font-medium text-indigo-700' : 'text-slate-700'
                                                }`}>
                                                {canvas.name}
                                            </span>
                                        )}
                                        <span className='block text-[11px] text-slate-400'>
                                            {t('{count} nodes', { count: stat?.nodeCount ?? 0 })} ·{' '}
                                            {formatWhen(canvas.updatedAt)}
                                        </span>
                                    </span>
                                </button>

                                {editingId === canvas.id ? (
                                    <div className='px-2 pb-1.5'>
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
                                            className='w-full rounded border border-indigo-300 bg-white px-1 py-0.5 text-[13px] text-slate-800 outline-none'
                                        />
                                    </div>
                                ) : (
                                    <div className='flex items-center gap-0.5 px-1.5 pb-1.5 opacity-0 transition-opacity group-focus-within/item:opacity-100 group-hover/item:opacity-100'>
                                        <button
                                            type='button'
                                            title={t('Rename')}
                                            onClick={() => {
                                                setEditingId(canvas.id);
                                                setDraftName(canvas.name);
                                            }}
                                            className='flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-white hover:text-slate-700'>
                                            <Pencil className='h-3 w-3' />
                                        </button>
                                        <button
                                            type='button'
                                            title={t('Duplicate')}
                                            onClick={() => onDuplicate(canvas.id)}
                                            className='flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-white hover:text-slate-700'>
                                            <Copy className='h-3 w-3' />
                                        </button>
                                        <button
                                            type='button'
                                            title={t('Delete canvas')}
                                            disabled={canvases.length <= 1}
                                            onClick={() => onDelete(canvas.id)}
                                            className='ml-auto flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-white hover:text-red-600 disabled:opacity-30'>
                                            <Trash2 className='h-3 w-3' />
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {footer && <div className='mt-auto border-t border-slate-200 pt-3'>{footer}</div>}
            </div>
        </aside>
    );
}
