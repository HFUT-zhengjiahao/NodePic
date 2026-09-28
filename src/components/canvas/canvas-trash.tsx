'use client';

import { Button } from '@/components/ui/button';
import { nodesStats, type TrashedCanvas } from '@/lib/canvas-store';
import { useI18n } from '@/lib/i18n';
import { imageUrl } from '@/lib/image-url';
import { ImageOff, RotateCcw, Trash, Trash2 } from 'lucide-react';
import Image from 'next/image';
import * as React from 'react';

export type CanvasTrashProps = {
    entries: TrashedCanvas[];
    onRestore: (id: string) => void;
    /** Removes the canvas for good, pictures included (after the caller's confirmation). */
    onDeleteForever: (id: string) => void;
    onEmpty: () => void;
};

function formatWhen(timestamp: number): string {
    const date = new Date(timestamp);
    const today = new Date();
    const sameDay = date.toDateString() === today.toDateString();
    return sameDay
        ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : date.toLocaleDateString([], { year: 'numeric', month: 'numeric', day: 'numeric' });
}

/**
 * The canvas recycle bin.
 *
 * Deleting a canvas used to be the end of it: the board disappeared while its pictures stayed on
 * disk with nothing pointing at them. Deleted canvases land here instead, whole, so the choice
 * between "I want that back" and "I want that gone, disk space included" stays open until the user
 * makes it.
 */
export function CanvasTrash({ entries, onRestore, onDeleteForever, onEmpty }: CanvasTrashProps) {
    const { t } = useI18n();
    // Stats come from the trash records themselves: a trashed canvas has no registry entry left to
    // look its pictures up through.
    const stats = React.useMemo(
        () => new Map(entries.map((entry) => [entry.meta.id, nodesStats(entry.nodes ?? [])])),
        [entries]
    );

    return (
        <section className='flex h-[calc(100dvh-1rem)] min-h-[560px] flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-20px_rgba(15,23,42,0.25)]'>
            <header className='flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3'>
                <Trash2 className='h-4 w-4 text-slate-400' />
                <h1 className='text-sm font-semibold text-slate-800'>{t('Recycle bin')}</h1>
                <span className='rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500'>
                    {entries.length}
                </span>
                <p className='hidden max-w-lg text-[11px] leading-relaxed text-slate-400 lg:block'>
                    {t('Deleted canvases wait here. Removing one for good also deletes the pictures only it uses.')}
                </p>
                {entries.length > 0 && (
                    <Button
                        type='button'
                        variant='outline'
                        size='sm'
                        onClick={onEmpty}
                        className='ml-auto h-8 border-red-200 text-[12px] text-red-600 hover:bg-red-50 hover:text-red-700'>
                        <Trash className='mr-1.5 h-3.5 w-3.5' />
                        {t('Empty the recycle bin')}
                    </Button>
                )}
            </header>

            {entries.length === 0 ? (
                <div className='pointer-events-none flex flex-1 flex-col items-center justify-center gap-3 text-center'>
                    <Trash2 className='h-8 w-8 text-slate-300' />
                    <p className='text-sm font-medium text-slate-600'>{t('The recycle bin is empty')}</p>
                    <p className='max-w-sm text-xs leading-relaxed text-slate-400'>
                        {t(
                            'Deleting a canvas from the sidebar puts it here first, so you can restore it or remove it — pictures and all — later.'
                        )}
                    </p>
                </div>
            ) : (
                <div className='grid flex-1 content-start gap-3 overflow-y-auto p-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4'>
                    {entries.map((entry) => {
                        const stat = stats.get(entry.meta.id);
                        return (
                            <article
                                key={entry.meta.id}
                                className='flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white transition-shadow hover:shadow-[0_1px_2px_rgba(15,23,42,0.06),0_12px_28px_-20px_rgba(15,23,42,0.35)]'>
                                <span className='relative block h-32 w-full bg-slate-100'>
                                    {stat?.thumbnail ? (
                                        <Image
                                            src={imageUrl(stat.thumbnail)}
                                            alt=''
                                            fill
                                            sizes='320px'
                                            className='object-cover opacity-80'
                                            unoptimized
                                        />
                                    ) : (
                                        <span className='flex h-full w-full flex-col items-center justify-center gap-1 text-slate-300'>
                                            <ImageOff className='h-5 w-5' />
                                            <span className='text-[11px]'>{t('No pictures')}</span>
                                        </span>
                                    )}
                                </span>
                                <div className='flex min-w-0 flex-1 flex-col gap-2 px-3 py-2.5'>
                                    <div className='min-w-0'>
                                        <p
                                            className='truncate text-[13px] font-medium text-slate-800'
                                            title={entry.meta.name}>
                                            {entry.meta.name}
                                        </p>
                                        <p className='mt-0.5 truncate text-[11px] text-slate-400'>
                                            {t('Deleted at {when}', { when: formatWhen(entry.deletedAt) })} ·{' '}
                                            {t('{count} nodes', { count: stat?.nodeCount ?? 0 })} ·{' '}
                                            {t('{count} picture(s)', { count: stat?.imageCount ?? 0 })}
                                        </p>
                                    </div>
                                    <div className='mt-auto flex items-center gap-1.5'>
                                        <Button
                                            type='button'
                                            size='sm'
                                            onClick={() => onRestore(entry.meta.id)}
                                            className='h-7 flex-1 bg-indigo-600 text-[12px] text-white shadow-sm hover:bg-indigo-500'>
                                            <RotateCcw className='mr-1 h-3.5 w-3.5' />
                                            {t('Restore')}
                                        </Button>
                                        <Button
                                            type='button'
                                            variant='outline'
                                            size='sm'
                                            onClick={() => onDeleteForever(entry.meta.id)}
                                            title={t('Delete this canvas and its pictures for good')}
                                            className='h-7 border-red-200 px-2 text-[12px] text-red-600 hover:bg-red-50 hover:text-red-700'>
                                            <Trash2 className='h-3.5 w-3.5' />
                                        </Button>
                                    </div>
                                </div>
                            </article>
                        );
                    })}
                </div>
            )}
        </section>
    );
}
