'use client';

import type { HistoryMetadata } from '@/app/page';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/lib/i18n';
import {
    Copy,
    Download,
    HardDrive,
    ImagePlus,
    Maximize2,
    Search,
    Sparkles,
    Trash2
} from 'lucide-react';
import Image from 'next/image';
import * as React from 'react';

export type HistoryGalleryProps = {
    history: HistoryMetadata[];
    getImageSrc: (filename: string) => string | undefined;
    /** Warnings when an entry still feeds canvas nodes, otherwise null. */
    describeReferenceWarning: (item: HistoryMetadata) => string | null;
    onDelete: (item: HistoryMetadata) => void;
    onClearHistory: () => void;
    onCleanupUnusedImages: () => void;
    cleanupDisabled?: boolean;
    /** Puts the picture on the active canvas as a new node. */
    onSendToCanvas: (filename: string) => void;
    skipConfirm: boolean;
    onSkipConfirmChange: (skip: boolean) => void;
};

type ModeFilter = 'all' | 'generate' | 'edit';

const dayLabel = (timestamp: number) => new Date(timestamp).toLocaleDateString();

/**
 * Full-page gallery of everything that was ever generated.
 *
 * The card unit is still one API call (one prompt, one or more pictures) because that is what the
 * metadata describes, but the layout is a scannable grid with search, so a specific picture can be
 * found by its prompt instead of by scrolling a timeline.
 */
export function HistoryGallery({
    history,
    getImageSrc,
    describeReferenceWarning,
    onDelete,
    onClearHistory,
    onCleanupUnusedImages,
    cleanupDisabled = false,
    onSendToCanvas,
    skipConfirm,
    onSkipConfirmChange
}: HistoryGalleryProps) {
    const { t } = useI18n();
    const [query, setQuery] = React.useState('');
    const [modeFilter, setModeFilter] = React.useState<ModeFilter>('all');
    const [detail, setDetail] = React.useState<HistoryMetadata | null>(null);
    const [copiedTimestamp, setCopiedTimestamp] = React.useState<number | null>(null);
    const [pendingDelete, setPendingDelete] = React.useState<HistoryMetadata | null>(null);
    const [dontAskAgain, setDontAskAgain] = React.useState(false);

    const totals = React.useMemo(() => {
        const images = history.reduce((sum, entry) => sum + entry.images.length, 0);
        const cost = history.reduce((sum, entry) => sum + (entry.costDetails?.estimated_cost_usd ?? 0), 0);
        return { images, cost };
    }, [history]);

    const filtered = React.useMemo(() => {
        const needle = query.trim().toLowerCase();
        return history
            .filter((entry) => (modeFilter === 'all' ? true : entry.mode === modeFilter))
            .filter((entry) => (needle ? (entry.prompt ?? '').toLowerCase().includes(needle) : true))
            .sort((a, b) => b.timestamp - a.timestamp);
    }, [history, modeFilter, query]);

    const grouped = React.useMemo(() => {
        const groups: Array<{ day: string; entries: HistoryMetadata[] }> = [];
        for (const entry of filtered) {
            const day = dayLabel(entry.timestamp);
            const last = groups[groups.length - 1];
            if (last && last.day === day) last.entries.push(entry);
            else groups.push({ day, entries: [entry] });
        }
        return groups;
    }, [filtered]);

    const requestDelete = (item: HistoryMetadata) => {
        const warning = describeReferenceWarning(item);
        if (skipConfirm && !warning) {
            onDelete(item);
            return;
        }
        setDontAskAgain(skipConfirm);
        setPendingDelete(item);
    };

    const copyPrompt = async (item: HistoryMetadata) => {
        try {
            await navigator.clipboard.writeText(item.prompt ?? '');
            setCopiedTimestamp(item.timestamp);
            window.setTimeout(() => setCopiedTimestamp(null), 1500);
        } catch (error) {
            console.error('Could not copy the prompt:', error);
        }
    };

    return (
        <div className='w-full space-y-4'>
            <div className='flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200/70 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-20px_rgba(15,23,42,0.25)]'>
                <span className='h-2 w-2 rounded-full bg-emerald-500' aria-hidden='true' />
                <h2 className='text-[17px] font-semibold tracking-tight text-slate-900'>{t('History')}</h2>
                <span className='text-[12px] text-slate-400'>
                    {t('{count} pictures · ${cost}', { count: totals.images, cost: totals.cost.toFixed(4) })}
                </span>

                <div className='relative ml-auto'>
                    <Search className='pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400' />
                    <Input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder={t('Search prompts…')}
                        className='h-8 w-56 border-slate-200 bg-white pl-7 text-[13px]'
                    />
                </div>

                <div className='flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5'>
                    {(['all', 'generate', 'edit'] as ModeFilter[]).map((value) => (
                        <button
                            key={value}
                            type='button'
                            onClick={() => setModeFilter(value)}
                            className={`rounded-md px-2 py-1 text-[12px] transition-colors ${
                                modeFilter === value
                                    ? 'bg-indigo-50 text-indigo-600'
                                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                            }`}>
                            {value === 'all' ? t('All') : value === 'generate' ? t('Generate') : t('Edit')}
                        </button>
                    ))}
                </div>

                <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    disabled={cleanupDisabled}
                    title={
                        cleanupDisabled
                            ? t('Disk cleanup is only available in filesystem storage mode.')
                            : t('Delete registered image files that no history entry or canvas node uses')
                    }
                    onClick={onCleanupUnusedImages}
                    className='h-8 border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40'>
                    <HardDrive className='mr-1.5 h-3.5 w-3.5' />
                    {t('Clean up orphaned files on disk')}
                </Button>
                {history.length > 0 && (
                    <Button
                        type='button'
                        variant='ghost'
                        size='sm'
                        onClick={onClearHistory}
                        className='h-8 text-slate-400 hover:bg-slate-100 hover:text-slate-700'>
                        {t('Clear')}
                    </Button>
                )}
            </div>

            {filtered.length === 0 ? (
                <div className='rounded-2xl border border-slate-200/70 bg-white py-20 text-center shadow-sm'>
                    <Sparkles className='mx-auto h-7 w-7 text-slate-300' />
                    <p className='mt-3 text-[13px] text-slate-500'>
                        {history.length === 0
                            ? t('Nothing here yet — every picture you generate shows up in this list.')
                            : t('No picture matches this search.')}
                    </p>
                </div>
            ) : (
                grouped.map((group) => (
                    <section key={group.day} className='space-y-2'>
                        <h3 className='sticky top-0 z-10 bg-slate-50/95 py-1 text-[12px] font-medium text-slate-500 backdrop-blur'>
                            {group.day}
                        </h3>
                        <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'>
                            {group.entries.map((entry) =>
                                entry.images.map((image, index) => {
                                    const src = getImageSrc(image.filename);
                                    const cost = entry.costDetails?.estimated_cost_usd;
                                    return (
                                        <article
                                            key={`${entry.timestamp}-${image.filename}`}
                                            className='group/card overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md'>
                                            <button
                                                type='button'
                                                onClick={() => setDetail(entry)}
                                                className='relative block aspect-square w-full bg-slate-50'>
                                                {src ? (
                                                    <Image
                                                        src={src}
                                                        alt={entry.prompt?.slice(0, 40) || image.filename}
                                                        fill
                                                        sizes='(max-width: 768px) 50vw, 20vw'
                                                        className='object-cover'
                                                        unoptimized
                                                    />
                                                ) : (
                                                    <span className='flex h-full items-center justify-center text-[11px] text-slate-400'>
                                                        {t('Image unavailable')}
                                                    </span>
                                                )}
                                                <span className='absolute top-1.5 left-1.5 rounded-full bg-slate-900/70 px-1.5 py-0.5 text-[10px] text-white'>
                                                    {entry.mode === 'edit' ? t('Edit') : t('Generate')}
                                                </span>
                                                {entry.images.length > 1 && (
                                                    <span className='absolute top-1.5 right-1.5 rounded-full bg-slate-900/70 px-1.5 py-0.5 text-[10px] text-white'>
                                                        {index + 1}/{entry.images.length}
                                                    </span>
                                                )}
                                            </button>

                                            <div className='space-y-1.5 px-2.5 py-2'>
                                                <p className='line-clamp-2 text-[11px] leading-snug text-slate-500'>
                                                    {entry.prompt?.trim() || t('No prompt recorded.')}
                                                </p>
                                                <div className='flex items-center justify-between text-[10px] text-slate-400'>
                                                    <span>
                                                        {new Date(entry.timestamp).toLocaleTimeString([], {
                                                            hour: '2-digit',
                                                            minute: '2-digit'
                                                        })}
                                                        {' · '}
                                                        {entry.model ?? 'gpt-image-1'}
                                                    </span>
                                                    {cost ? <span>${(cost / entry.images.length).toFixed(4)}</span> : null}
                                                </div>
                                                <div className='flex items-center gap-1 opacity-0 transition-opacity group-focus-within/card:opacity-100 group-hover/card:opacity-100'>
                                                    <button
                                                        type='button'
                                                        title={t('Expand')}
                                                        onClick={() => setDetail(entry)}
                                                        className='rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700'>
                                                        <Maximize2 className='h-3.5 w-3.5' />
                                                    </button>
                                                    <a
                                                        title={t('Download')}
                                                        href={src}
                                                        download={image.filename}
                                                        className='rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700'>
                                                        <Download className='h-3.5 w-3.5' />
                                                    </a>
                                                    <button
                                                        type='button'
                                                        title={t('Send to canvas')}
                                                        onClick={() => onSendToCanvas(image.filename)}
                                                        className='rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700'>
                                                        <ImagePlus className='h-3.5 w-3.5' />
                                                    </button>
                                                    <button
                                                        type='button'
                                                        title={t('Delete history item')}
                                                        onClick={() => requestDelete(entry)}
                                                        className='ml-auto rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600'>
                                                        <Trash2 className='h-3.5 w-3.5' />
                                                    </button>
                                                </div>
                                            </div>
                                        </article>
                                    );
                                })
                            )}
                        </div>
                    </section>
                ))
            )}

            {/* detail */}
            <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
                <DialogContent className='max-h-[92vh] overflow-y-auto border-slate-200 bg-white text-slate-900 sm:max-w-[900px]'>
                    {detail && (
                        <>
                            <DialogHeader>
                                <DialogTitle className='text-base'>
                                    {detail.mode === 'edit' ? t('Edit Image') : t('Generate Image')}
                                </DialogTitle>
                                <DialogDescription className='text-[12px] text-slate-500'>
                                    {new Date(detail.timestamp).toLocaleString()} · {detail.model ?? 'gpt-image-1'} ·{' '}
                                    {detail.quality} · {detail.background} · {(detail.output_format ?? 'png').toUpperCase()}
                                    {detail.costDetails
                                        ? ` · $${detail.costDetails.estimated_cost_usd.toFixed(4)}`
                                        : ''}
                                    {detail.durationMs ? ` · ${(detail.durationMs / 1000).toFixed(1)}s` : ''}
                                </DialogDescription>
                            </DialogHeader>

                            <div className='flex flex-wrap justify-center gap-3'>
                                {detail.images.map((image) => {
                                    const src = getImageSrc(image.filename);
                                    return (
                                        <div key={image.filename} className='space-y-1'>
                                            {src ? (
                                                <Image
                                                    src={src}
                                                    alt={image.filename}
                                                    width={1200}
                                                    height={1200}
                                                    className='h-auto max-h-[60vh] w-auto rounded-lg border border-slate-200 object-contain'
                                                    unoptimized
                                                />
                                            ) : (
                                                <p className='text-[12px] text-slate-400'>{t('Image unavailable')}</p>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            <div className='space-y-1.5'>
                                <p className='text-[12px] font-medium text-slate-600'>{t('Prompt')}</p>
                                <p className='max-h-40 overflow-y-auto rounded-lg bg-slate-50 px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap text-slate-700'>
                                    {detail.prompt?.trim() || t('No prompt recorded.')}
                                </p>
                            </div>

                            <DialogFooter className='flex-wrap gap-2 sm:justify-end'>
                                <Button
                                    type='button'
                                    variant='outline'
                                    size='sm'
                                    onClick={() => void copyPrompt(detail)}
                                    className='border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900'>
                                    <Copy className='mr-1.5 h-3.5 w-3.5' />
                                    {copiedTimestamp === detail.timestamp ? t('Copied!') : t('Copy')}
                                </Button>
                                <Button
                                    type='button'
                                    variant='outline'
                                    size='sm'
                                    onClick={() => {
                                        detail.images.forEach((image) => onSendToCanvas(image.filename));
                                        setDetail(null);
                                    }}
                                    className='border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900'>
                                    <ImagePlus className='mr-1.5 h-3.5 w-3.5' />
                                    {t('Send to canvas')}
                                </Button>
                                <Button
                                    type='button'
                                    size='sm'
                                    onClick={() => {
                                        requestDelete(detail);
                                        setDetail(null);
                                    }}
                                    className='bg-red-600 text-white hover:bg-red-500'>
                                    <Trash2 className='mr-1.5 h-3.5 w-3.5' />
                                    {t('Delete')}
                                </Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>

            {/* delete confirmation */}
            <Dialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
                <DialogContent className='border-slate-200 bg-white text-slate-900 sm:max-w-md'>
                    <DialogHeader>
                        <DialogTitle className='text-base'>{t('Confirm Deletion')}</DialogTitle>
                        <DialogDescription className='pt-1 text-slate-600'>
                            {t(
                                'Are you sure you want to delete this history entry? This will remove {count} image(s). Deleted files stay recoverable in the trash folder.',
                                { count: pendingDelete?.images.length ?? 0 }
                            )}
                        </DialogDescription>
                        {pendingDelete && describeReferenceWarning(pendingDelete) && (
                            <div className='mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] leading-relaxed text-red-700'>
                                {describeReferenceWarning(pendingDelete)}
                            </div>
                        )}
                    </DialogHeader>
                    <label className='flex items-center gap-2 py-1 text-[12px] text-slate-600'>
                        <input
                            type='checkbox'
                            checked={dontAskAgain}
                            onChange={(event) => setDontAskAgain(event.target.checked)}
                            className='h-3.5 w-3.5 accent-indigo-600'
                        />
                        {t("Don't ask me again")}
                    </label>
                    <DialogFooter className='gap-2 sm:justify-end'>
                        <Button
                            type='button'
                            variant='outline'
                            size='sm'
                            onClick={() => setPendingDelete(null)}
                            className='border-slate-300 text-slate-600 hover:bg-slate-200 hover:text-slate-900'>
                            {t('Cancel')}
                        </Button>
                        <Button
                            type='button'
                            size='sm'
                            onClick={() => {
                                if (pendingDelete) onDelete(pendingDelete);
                                onSkipConfirmChange(dontAskAgain);
                                setPendingDelete(null);
                            }}
                            className='bg-red-600 text-white hover:bg-red-500'>
                            {t('Delete')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
