'use client';

import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Loader2, Send, Grid } from 'lucide-react';
import Image from 'next/image';
import * as React from 'react';

function ElapsedTimer({ startTime, className }: { startTime: number; className?: string }) {
    const [now, setNow] = React.useState(() => Date.now());
    React.useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 100);
        return () => clearInterval(id);
    }, []);
    return <span className={cn('tabular-nums', className)}>{Math.max(0, (now - startTime) / 1000).toFixed(1)}s</span>;
}

type ImageInfo = {
    path: string;
    filename: string;
};

type ImageOutputProps = {
    imageBatch: ImageInfo[] | null;
    viewMode: 'grid' | number;
    onViewChange: (view: 'grid' | number) => void;
    altText?: string;
    isLoading: boolean;
    loadingStartTime: number | null;
    onSendToEdit: (filename: string) => void;
    currentMode: 'generate' | 'edit';
    baseImagePreviewUrl: string | null;
    streamingPreviewImages?: Map<number, string>;
};

const getGridColsClass = (count: number): string => {
    if (count <= 1) return 'grid-cols-1';
    if (count <= 4) return 'grid-cols-2';
    if (count <= 9) return 'grid-cols-3';
    return 'grid-cols-3';
};

export function ImageOutput({
    imageBatch,
    viewMode,
    onViewChange,
    altText,
    isLoading,
    loadingStartTime,
    onSendToEdit,
    currentMode,
    baseImagePreviewUrl,
    streamingPreviewImages
}: ImageOutputProps) {
    const { t } = useI18n();
    const resolvedAltText = altText ?? t('Generated image output');

    const handleSendClick = () => {
        // Send to edit only works when a single image is selected
        if (typeof viewMode === 'number' && imageBatch && imageBatch[viewMode]) {
            onSendToEdit(imageBatch[viewMode].filename);
        }
    };

    const showCarousel = imageBatch && imageBatch.length > 1;
    const isSingleImageView = typeof viewMode === 'number';
    const canSendToEdit = !isLoading && isSingleImageView && imageBatch && imageBatch[viewMode];

    return (
        <div className='flex h-full min-h-[300px] w-full flex-col items-center justify-between gap-4 overflow-hidden rounded-2xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-20px_rgba(15,23,42,0.25)]'>
            <div className='relative flex h-full w-full flex-grow items-center justify-center overflow-hidden rounded-xl border border-dashed border-slate-200 bg-slate-50/60'>
                {isLoading ? (
                    streamingPreviewImages && streamingPreviewImages.size > 0 ? (
                        // Show streaming preview images - single image centered like final view
                        <div className='relative flex h-full w-full items-center justify-center'>
                            {/* Show the latest preview image (highest index) */}
                            {(() => {
                                const entries = Array.from(streamingPreviewImages.entries());
                                const latestEntry = entries[entries.length - 1];
                                if (!latestEntry) return null;
                                const [, dataUrl] = latestEntry;
                                return (
                                    <Image
                                        src={dataUrl}
                                        alt={t('Streaming preview')}
                                        width={512}
                                        height={512}
                                        className='max-h-full max-w-full object-contain'
                                        unoptimized
                                    />
                                );
                            })()}
                            {/* Overlay loader at bottom center */}
                            <div className='absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-white/85 px-3 py-1.5 text-slate-700'>
                                <Loader2 className='h-4 w-4 animate-spin' />
                                <p className='text-sm'>{t('Streaming...')}</p>
                                {loadingStartTime !== null && (
                                    <ElapsedTimer startTime={loadingStartTime} className='text-sm text-slate-500' />
                                )}
                            </div>
                        </div>
                    ) : currentMode === 'edit' && baseImagePreviewUrl ? (
                        <div className='relative flex h-full w-full items-center justify-center'>
                            <Image
                                src={baseImagePreviewUrl}
                                alt={t('Base image for editing')}
                                fill
                                style={{ objectFit: 'contain' }}
                                className='blur-md filter'
                                unoptimized
                            />
                            <div className='absolute inset-0 flex flex-col items-center justify-center bg-white/70 text-slate-700'>
                                <Loader2 className='mb-2 h-8 w-8 animate-spin' />
                                <p>{t('Editing image...')}</p>
                                {loadingStartTime !== null && (
                                    <ElapsedTimer startTime={loadingStartTime} className='mt-1 text-sm text-slate-500' />
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className='flex flex-col items-center justify-center text-slate-500'>
                            <Loader2 className='mb-2 h-8 w-8 animate-spin' />
                            <p>{t('Generating image...')}</p>
                            {loadingStartTime !== null && (
                                <ElapsedTimer startTime={loadingStartTime} className='mt-1 text-sm text-slate-400' />
                            )}
                        </div>
                    )
                ) : imageBatch && imageBatch.length > 0 ? (
                    viewMode === 'grid' ? (
                        <div
                            className={`grid ${getGridColsClass(imageBatch.length)} max-h-full w-full max-w-full gap-1 p-1`}>
                            {imageBatch.map((img, index) => (
                                <div
                                    key={img.filename}
                                    className='relative aspect-square overflow-hidden rounded border border-slate-200'>
                                    <Image
                                        src={img.path}
                                        alt={t('Generated image {index}', { index: index + 1 })}
                                        fill
                                        style={{ objectFit: 'contain' }}
                                        sizes='(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw'
                                        unoptimized
                                    />
                                </div>
                            ))}
                        </div>
                    ) : imageBatch[viewMode] ? (
                        <Image
                            src={imageBatch[viewMode].path}
                            alt={resolvedAltText}
                            width={512}
                            height={512}
                            className='max-h-full max-w-full object-contain'
                            unoptimized
                        />
                    ) : (
                        <div className='text-center text-slate-400'>
                            <p>{t('Error displaying image.')}</p>
                        </div>
                    )
                ) : (
                    <div className='px-6 text-center'>
                        <p className='text-sm text-slate-400'>{t('Your generated image will appear here.')}</p>
                    </div>
                )}
            </div>

            <div className='flex h-10 w-full shrink-0 items-center justify-center gap-4'>
                {showCarousel && (
                    <div className='flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-100 p-1'>
                        <Button
                            variant='ghost'
                            size='icon'
                            className={cn(
                                'h-8 w-8 rounded p-1',
                                viewMode === 'grid'
                                    ? 'bg-slate-200 text-slate-900'
                                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                            )}
                            onClick={() => onViewChange('grid')}
                            aria-label={t('Show grid view')}>
                            <Grid className='h-4 w-4' />
                        </Button>
                        {imageBatch.map((img, index) => (
                            <Button
                                key={img.filename}
                                variant='ghost'
                                size='icon'
                                className={cn(
                                    'h-8 w-8 overflow-hidden rounded p-0.5',
                                    viewMode === index
                                        ? 'ring-2 ring-white ring-offset-1 ring-offset-white'
                                        : 'opacity-60 hover:opacity-100'
                                )}
                                onClick={() => onViewChange(index)}
                                aria-label={t('Select image {index}', { index: index + 1 })}>
                                <Image
                                    src={img.path}
                                    alt={t('Thumbnail {index}', { index: index + 1 })}
                                    width={28}
                                    height={28}
                                    className='h-full w-full object-cover'
                                    unoptimized
                                />
                            </Button>
                        ))}
                    </div>
                )}

                <Button
                    variant='outline'
                    size='sm'
                    onClick={handleSendClick}
                    disabled={!canSendToEdit}
                    className={cn(
                        'shrink-0 border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-50',
                        // Hide button completely if grid view is active and there are multiple images
                        showCarousel && viewMode === 'grid' ? 'invisible' : 'visible'
                    )}>
                    <Send className='mr-2 h-4 w-4' />
                    {t('Send to Edit')}
                </Button>
            </div>
        </div>
    );
}
