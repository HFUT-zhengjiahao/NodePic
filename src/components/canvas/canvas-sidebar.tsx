'use client';

import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { canvasStats, type CanvasMeta } from '@/lib/canvas-store';
import { Check, ChevronLeft, ChevronRight, Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import * as React from 'react';

export type CanvasSidebarProps = {
    canvases: CanvasMeta[];
    activeId: string;
    /** Bumped whenever the open canvas is saved, so the node counts refresh. */
    revision: number;
    collapsed: boolean;
    onToggleCollapsed: () => void;
    onSelect: (id: string) => void;
    onCreate: () => void;
    onRename: (id: string, name: string) => void;
    onDuplicate: (id: string) => void;
    onDelete: (id: string) => void;
};

function formatWhen(timestamp: number): string {
    const date = new Date(timestamp);
    const today = new Date();
    const sameDay = date.toDateString() === today.toDateString();
    return sameDay
        ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : date.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
}

/** The list of saved canvases: switch, create, rename, duplicate and delete. */
export function CanvasSidebar({
    canvases,
    activeId,
    revision,
    collapsed,
    onToggleCollapsed,
    onSelect,
    onCreate,
    onRename,
    onDuplicate,
    onDelete
}: CanvasSidebarProps) {
    const { t } = useI18n();
    const [editingId, setEditingId] = React.useState<string | null>(null);
    const [draftName, setDraftName] = React.useState('');

    // Node counts come from storage, so they are recomputed when the list or the open canvas changes.
    // `revision` is intentionally part of the key even though the linter cannot see it being read.
    const stats = React.useMemo(
        () => new Map(canvases.map((canvas) => [canvas.id, canvasStats(canvas.id)])),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [canvases, revision]
    );

    if (collapsed) {
        return (
            <div className='flex w-10 shrink-0 flex-col items-center gap-2 pt-1'>
                <Button
                    type='button'
                    variant='outline'
                    size='icon'
                    onClick={onToggleCollapsed}
                    title={t('Show the canvas list')}
                    className='h-8 w-8 border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-100 hover:text-slate-900'>
                    <ChevronRight className='h-4 w-4' />
                </Button>
            </div>
        );
    }

    return (
        <aside className='flex w-56 shrink-0 flex-col gap-2'>
            <div className='flex items-center gap-1'>
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
                    title={t('Hide the canvas list')}
                    className='h-7 w-7 text-slate-400 hover:bg-slate-100 hover:text-slate-700'>
                    <ChevronLeft className='h-3.5 w-3.5' />
                </Button>
            </div>

            <div className='flex max-h-[calc(100dvh-160px)] flex-col gap-1 overflow-y-auto pr-1'>
                {canvases.map((canvas) => {
                    const active = canvas.id === activeId;
                    const stat = stats.get(canvas.id);
                    return (
                        <div
                            key={canvas.id}
                            className={`group/item rounded-lg border px-2 py-1.5 transition-colors ${
                                active
                                    ? 'border-indigo-200 bg-indigo-50'
                                    : 'border-slate-200 bg-white hover:bg-slate-50'
                            }`}>
                            {editingId === canvas.id ? (
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
                            ) : (
                                <button
                                    type='button'
                                    onClick={() => onSelect(canvas.id)}
                                    className='flex w-full items-start gap-1.5 text-left'>
                                    <span className='mt-[3px] flex h-3.5 w-3.5 shrink-0 items-center justify-center'>
                                        {active && <Check className='h-3.5 w-3.5 text-indigo-600' />}
                                    </span>
                                    <span className='min-w-0 flex-1'>
                                        <span
                                            className={`block truncate text-[13px] ${
                                                active ? 'font-medium text-indigo-700' : 'text-slate-700'
                                            }`}>
                                            {canvas.name}
                                        </span>
                                        <span className='block text-[11px] text-slate-400'>
                                            {t('{count} nodes', { count: stat?.nodeCount ?? 0 })} ·{' '}
                                            {formatWhen(canvas.updatedAt)}
                                        </span>
                                    </span>
                                </button>
                            )}

                            <div className='mt-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/item:opacity-100'>
                                <button
                                    type='button'
                                    title={t('Rename')}
                                    onClick={() => {
                                        setEditingId(canvas.id);
                                        setDraftName(canvas.name);
                                    }}
                                    className='rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700'>
                                    <Pencil className='h-3 w-3' />
                                </button>
                                <button
                                    type='button'
                                    title={t('Duplicate')}
                                    onClick={() => onDuplicate(canvas.id)}
                                    className='rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700'>
                                    <Copy className='h-3 w-3' />
                                </button>
                                <button
                                    type='button'
                                    title={t('Delete canvas')}
                                    disabled={canvases.length <= 1}
                                    onClick={() => onDelete(canvas.id)}
                                    className='rounded p-1 text-slate-400 hover:bg-white hover:text-red-600 disabled:opacity-30'>
                                    <Trash2 className='h-3 w-3' />
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </aside>
    );
}
