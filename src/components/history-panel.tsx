'use client';

import type { HistoryMetadata } from '@/app/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter,
    DialogClose
} from '@/components/ui/dialog';
import { getModelRates, tokensToUsd, type ModelRates } from '@/lib/cost-utils';
import { useI18n } from '@/lib/i18n';
import { GPT_IMAGE_MODELS, type GptImageModel } from '@/lib/models';
import { cn } from '@/lib/utils';
import {
    Copy,
    Check,
    Layers,
    DollarSign,
    Pencil,
    Sparkles as SparklesIcon,
    HardDrive,
    Database,
    FileImage,
    Trash2
} from 'lucide-react';
import Image from 'next/image';
import * as React from 'react';

type HistoryPanelProps = {
    history: HistoryMetadata[];
    onSelectImage: (item: HistoryMetadata) => void;
    onClearHistory: () => void;
    getImageSrc: (filename: string) => string | undefined;
    onDeleteItemRequest: (item: HistoryMetadata, referenceWarning: string | null) => void;
    /** Returns a warning when the entry still feeds canvas nodes, otherwise null. */
    describeReferenceWarning: (item: HistoryMetadata) => string | null;
    /** Set while the confirmation dialog is open for an entry the canvas still references. */
    referenceWarning: string | null;
    /** Removes generated files that nothing references any more. */
    onCleanupUnusedImages: () => void;
    itemPendingDeleteConfirmation: HistoryMetadata | null;
    onConfirmDeletion: () => void;
    onCancelDeletion: () => void;
    deletePreferenceDialogValue: boolean;
    onDeletePreferenceDialogChange: (isChecked: boolean) => void;
};

const formatDuration = (ms: number): string => {
    if (ms < 1000) {
        return `${ms}ms`;
    }
    return `${(ms / 1000).toFixed(1)}s`;
};

const formatUsd = (tokens: number, perMillion: number): string => tokensToUsd(tokens, perMillion).toFixed(4);

// Selectable models grouped by identical pricing, for the total-cost summary.
const RATE_GROUPS = GPT_IMAGE_MODELS.reduce<{ rates: ModelRates; models: GptImageModel[] }[]>((groups, model) => {
    const rates = getModelRates(model);
    const group = groups.find(
        (g) =>
            g.rates.textInputPerMillion === rates.textInputPerMillion &&
            g.rates.imageInputPerMillion === rates.imageInputPerMillion &&
            g.rates.imageOutputPerMillion === rates.imageOutputPerMillion
    );
    if (group) {
        group.models.push(model);
    } else {
        groups.push({ rates, models: [model] });
    }
    return groups;
}, []);

function HistoryPanelImpl({
    history,
    onSelectImage,
    onClearHistory,
    getImageSrc,
    onDeleteItemRequest,
    describeReferenceWarning,
    referenceWarning,
    onCleanupUnusedImages,
    itemPendingDeleteConfirmation,
    onConfirmDeletion,
    onCancelDeletion,
    deletePreferenceDialogValue,
    onDeletePreferenceDialogChange
}: HistoryPanelProps) {
    const { t } = useI18n();
    const [openPromptDialogTimestamp, setOpenPromptDialogTimestamp] = React.useState<number | null>(null);
    const [openCostDialogTimestamp, setOpenCostDialogTimestamp] = React.useState<number | null>(null);
    const [isTotalCostDialogOpen, setIsTotalCostDialogOpen] = React.useState(false);
    const [copiedTimestamp, setCopiedTimestamp] = React.useState<number | null>(null);

    const { totalCost, totalImages } = React.useMemo(() => {
        let cost = 0;
        let images = 0;
        history.forEach((item) => {
            if (item.costDetails) {
                cost += item.costDetails.estimated_cost_usd;
            }
            images += item.images?.length ?? 0;
        });

        return { totalCost: Math.round(cost * 10000) / 10000, totalImages: images };
    }, [history]);

    const averageCost = totalImages > 0 ? totalCost / totalImages : 0;

    const handleCopy = async (text: string | null | undefined, timestamp: number) => {
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            setCopiedTimestamp(timestamp);
            setTimeout(() => setCopiedTimestamp(null), 1500);
        } catch (err) {
            console.error('Failed to copy text: ', err);
        }
    };

    return (
        <Card className='flex h-full w-full flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-20px_rgba(15,23,42,0.25)]'>
            <CardHeader className='flex flex-row items-center justify-between gap-4 border-b border-slate-100 bg-white px-5 py-3.5'>
                <div className='flex items-center gap-2.5'>
                    <span className='h-2 w-2 shrink-0 rounded-full bg-emerald-500' aria-hidden='true' />
                    <CardTitle className='text-[17px] font-semibold tracking-tight text-slate-900'>{t('History')}</CardTitle>
                    {totalCost > 0 && (
                        <Dialog open={isTotalCostDialogOpen} onOpenChange={setIsTotalCostDialogOpen}>
                            <DialogTrigger asChild>
                                <button
                                    className='mt-0.5 flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[12px] text-slate-900 transition-colors hover:bg-emerald-200'
                                    aria-label={t('Show total cost summary')}>
                                    {t('Total Cost: ${cost}', { cost: totalCost.toFixed(4) })}
                                </button>
                            </DialogTrigger>
                            <DialogContent className='border-slate-200 bg-white text-slate-900 sm:max-w-[450px]'>
                                <DialogHeader>
                                    <DialogTitle className='text-slate-900'>{t('Total Cost Summary')}</DialogTitle>
                                    {/* Add sr-only description for accessibility */}
                                    <DialogDescription className='sr-only'>
                                        {t('A summary of the total estimated cost for all generated images in the history.')}
                                    </DialogDescription>
                                </DialogHeader>
                                <div className='space-y-2 pt-1 text-xs text-slate-400'>
                                    {RATE_GROUPS.map(({ rates, models }) => (
                                        <div key={models.join(',')} className='space-y-1'>
                                            <p className='font-medium'>{models.join(', ')}:</p>
                                            <ul className='list-disc pl-4'>
                                                <li>
                                                    {t('Text Input: ${price} / 1M tokens', {
                                                        price: rates.textInputPerMillion
                                                    })}
                                                </li>
                                                <li>
                                                    {t('Image Input: ${price} / 1M tokens', {
                                                        price: rates.imageInputPerMillion
                                                    })}
                                                </li>
                                                <li>
                                                    {t('Image Output: ${price} / 1M tokens', {
                                                        price: rates.imageOutputPerMillion
                                                    })}
                                                </li>
                                            </ul>
                                        </div>
                                    ))}
                                </div>
                                <div className='space-y-2 py-4 text-sm text-slate-600'>
                                    <div className='flex justify-between'>
                                        <span>{t('Total Images Generated:')}</span>{' '}
                                        <span>{totalImages.toLocaleString()}</span>
                                    </div>
                                    <div className='flex justify-between'>
                                        <span>{t('Average Cost Per Image:')}</span>{' '}
                                        <span>${averageCost.toFixed(4)}</span>
                                    </div>
                                    <hr className='my-2 border-slate-200' />
                                    <div className='flex justify-between font-medium text-slate-900'>
                                        <span>{t('Total Estimated Cost:')}</span>
                                        <span>${totalCost.toFixed(4)}</span>
                                    </div>
                                </div>
                                <DialogFooter>
                                    <DialogClose asChild>
                                        <Button
                                            type='button'
                                            variant='secondary'
                                            size='sm'
                                            className='bg-slate-200 text-slate-700 hover:bg-slate-300'>
                                            {t('Close')}
                                        </Button>
                                    </DialogClose>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    )}
                </div>
                <div className='flex items-center gap-1'>
                    {history.length > 0 && (
                        <Button
                            variant='ghost'
                            size='sm'
                            onClick={onClearHistory}
                            className='h-auto rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900'>
                            {t('Clear')}
                        </Button>
                    )}
                    <Button
                        type='button'
                        variant='ghost'
                        size='sm'
                        title={t('Delete generated files that no history entry or canvas node uses')}
                        onClick={onCleanupUnusedImages}
                        className='h-auto rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900'>
                        <Trash2 className='mr-1 h-3.5 w-3.5' />
                        {t('Clean up files')}
                    </Button>
                </div>
            </CardHeader>
            <CardContent className='flex-grow overflow-y-auto p-4'>
                {history.length === 0 ? (
                    <div className='flex h-full items-center justify-center text-slate-400'>
                        <p>{t('Generated images will appear here.')}</p>
                    </div>
                ) : (
                    <div className='grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5'>
                        {[...history].map((item) => {
                            const firstImage = item.images?.[0];
                            const imageCount = item.images?.length ?? 0;
                            const isMultiImage = imageCount > 1;
                            const itemKey = item.timestamp;
                            const originalStorageMode = item.storageModeUsed || 'fs';
                            const outputFormat = item.output_format || 'png';
                            const model = item.model ?? 'gpt-image-1';

                            let thumbnailUrl: string | undefined;
                            if (firstImage) {
                                if (originalStorageMode === 'indexeddb') {
                                    thumbnailUrl = getImageSrc(firstImage.filename);
                                } else {
                                    thumbnailUrl = `/api/image/${firstImage.filename}`;
                                }
                            }

                            return (
                                <div key={itemKey} className='flex flex-col'>
                                    <div className='group relative'>
                                        <button
                                            onClick={() => onSelectImage(item)}
                                            className='relative block aspect-square w-full overflow-hidden rounded-t-md border border-slate-200 transition-all duration-150 group-hover:border-slate-300 focus:ring-2 focus:ring-indigo-200 focus:ring-offset-2 focus:ring-offset-white focus:outline-none'
                                            aria-label={t('View image batch from {timestamp}', {
                                                timestamp: new Date(item.timestamp).toLocaleString()
                                            })}>
                                            {thumbnailUrl ? (
                                                <Image
                                                    src={thumbnailUrl}
                                                    alt={t('Preview for batch generated at {timestamp}', {
                                                        timestamp: new Date(item.timestamp).toLocaleString()
                                                    })}
                                                    width={150}
                                                    height={150}
                                                    className='h-full w-full object-cover'
                                                    unoptimized
                                                />
                                            ) : (
                                                <div className='flex h-full w-full items-center justify-center bg-slate-100 text-slate-500'>
                                                    ?
                                                </div>
                                            )}
                                            <div
                                                className={cn(
                                                    'pointer-events-none absolute top-1 left-1 z-10 flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] text-slate-900',
                                                    item.mode === 'edit' ? 'bg-amber-100' : 'bg-sky-100'
                                                )}>
                                                {item.mode === 'edit' ? (
                                                    <Pencil size={12} />
                                                ) : (
                                                    <SparklesIcon size={12} />
                                                )}
                                                {item.mode === 'edit' ? t('Edit') : t('Create')}
                                            </div>
                                            {isMultiImage && (
                                                <div className='pointer-events-none absolute right-1 bottom-1 z-10 flex items-center gap-1 rounded-full bg-white/85 px-1.5 py-0.5 text-[12px] text-slate-900'>
                                                    <Layers size={16} />
                                                    {imageCount}
                                                </div>
                                            )}
                                            <div className='pointer-events-none absolute bottom-1 left-1 z-10 flex items-center gap-1'>
                                                <div className='flex items-center gap-1 rounded-full border border-slate-200 bg-white/90 px-1 py-0.5 text-[11px] text-slate-600'>
                                                    {originalStorageMode === 'fs' ? (
                                                        <HardDrive size={12} className='text-slate-400' />
                                                    ) : (
                                                        <Database size={12} className='text-blue-500' />
                                                    )}
                                                    <span>{originalStorageMode === 'fs' ? t('file') : t('db')}</span>
                                                </div>
                                                {item.output_format && (
                                                    <div className='flex items-center gap-1 rounded-full border border-slate-200 bg-white/90 px-1 py-0.5 text-[11px] text-slate-600'>
                                                        <FileImage size={12} className='text-slate-400' />
                                                        <span>{outputFormat.toUpperCase()}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </button>
                                        {item.costDetails && (
                                            <Dialog
                                                open={openCostDialogTimestamp === itemKey}
                                                onOpenChange={(isOpen) => !isOpen && setOpenCostDialogTimestamp(null)}>
                                                <DialogTrigger asChild>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setOpenCostDialogTimestamp(itemKey);
                                                        }}
                                                        className='absolute top-1 right-1 z-20 flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[11px] text-slate-900 transition-colors hover:bg-emerald-200'
                                                        aria-label={t('Show cost breakdown')}>
                                                        <DollarSign size={12} />
                                                        {item.costDetails.estimated_cost_usd.toFixed(4)}
                                                    </button>
                                                </DialogTrigger>
                                                <DialogContent className='border-slate-200 bg-white text-slate-900 sm:max-w-[450px]'>
                                                    <DialogHeader>
                                                        <DialogTitle className='text-slate-900'>
                                                            {t('Cost Breakdown')}
                                                        </DialogTitle>
                                                        <DialogDescription className='sr-only'>
                                                            {t('Estimated cost breakdown for this image generation.')}
                                                        </DialogDescription>
                                                    </DialogHeader>
                                                    {(() => {
                                                        const rates = getModelRates(model);
                                                        return (
                                                            <>
                                                                <div className='space-y-1 pt-1 text-xs text-slate-400'>
                                                                    <p>{t('Pricing for {model}:', { model })}</p>
                                                                    <ul className='list-disc pl-4'>
                                                                        <li>
                                                                            {t('Text Input: ${price} / 1M tokens', {
                                                                                price: rates.textInputPerMillion
                                                                            })}
                                                                        </li>
                                                                        <li>
                                                                            {t('Image Input: ${price} / 1M tokens', {
                                                                                price: rates.imageInputPerMillion
                                                                            })}
                                                                        </li>
                                                                        <li>
                                                                            {t('Image Output: ${price} / 1M tokens', {
                                                                                price: rates.imageOutputPerMillion
                                                                            })}
                                                                        </li>
                                                                    </ul>
                                                                </div>
                                                                <div className='space-y-2 py-4 text-sm text-slate-600'>
                                                                    <div className='flex justify-between'>
                                                                        <span>{t('Text Input Tokens:')}</span>{' '}
                                                                        <span>
                                                                            {item.costDetails.text_input_tokens.toLocaleString()}{' '}
                                                                            (~$
                                                                            {formatUsd(
                                                                                item.costDetails.text_input_tokens,
                                                                                rates.textInputPerMillion
                                                                            )}
                                                                            )
                                                                        </span>
                                                                    </div>
                                                                    {item.costDetails.image_input_tokens > 0 && (
                                                                        <div className='flex justify-between'>
                                                                            <span>{t('Image Input Tokens:')}</span>{' '}
                                                                            <span>
                                                                                {item.costDetails.image_input_tokens.toLocaleString()}{' '}
                                                                                (~$
                                                                                {formatUsd(
                                                                                    item.costDetails.image_input_tokens,
                                                                                    rates.imageInputPerMillion
                                                                                )}
                                                                                )
                                                                            </span>
                                                                        </div>
                                                                    )}
                                                                    <div className='flex justify-between'>
                                                                        <span>{t('Image Output Tokens:')}</span>{' '}
                                                                        <span>
                                                                            {item.costDetails.image_output_tokens.toLocaleString()}{' '}
                                                                            (~$
                                                                            {formatUsd(
                                                                                item.costDetails.image_output_tokens,
                                                                                rates.imageOutputPerMillion
                                                                            )}
                                                                            )
                                                                        </span>
                                                                    </div>
                                                                    <hr className='my-2 border-slate-200' />
                                                                    <div className='flex justify-between font-medium text-slate-900'>
                                                                        <span>{t('Total Estimated Cost:')}</span>
                                                                        <span>
                                                                            $
                                                                            {item.costDetails.estimated_cost_usd.toFixed(
                                                                                4
                                                                            )}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            </>
                                                        );
                                                    })()}
                                                    <DialogFooter>
                                                        <DialogClose asChild>
                                                            <Button
                                                                type='button'
                                                                variant='secondary'
                                                                size='sm'
                                                                className='bg-slate-200 text-slate-700 hover:bg-slate-300'>
                                                                {t('Close')}
                                                            </Button>
                                                        </DialogClose>
                                                    </DialogFooter>
                                                </DialogContent>
                                            </Dialog>
                                        )}
                                    </div>

                                    <div className='space-y-1 rounded-b-md border border-t-0 border-slate-200 bg-white p-2 text-xs text-slate-500'>
                                        <p title={t('Generated on: {timestamp}', { timestamp: new Date(item.timestamp).toLocaleString() })}>
                                            <span className='font-medium text-slate-700'>{t('Time:')}</span>{' '}
                                            {formatDuration(item.durationMs)}
                                        </p>
                                        <p>
                                            <span className='font-medium text-slate-700'>{t('Model:')}</span> {model}
                                        </p>
                                        <p>
                                            <span className='font-medium text-slate-700'>{t('Quality:')}</span>{' '}
                                            {item.quality}
                                        </p>
                                        <p>
                                            <span className='font-medium text-slate-700'>{t('BG:')}</span>{' '}
                                            {item.background}
                                        </p>
                                        <p>
                                            <span className='font-medium text-slate-700'>{t('Mod:')}</span>{' '}
                                            {item.moderation}
                                        </p>
                                        <div className='mt-2 flex items-center gap-1'>
                                            <Dialog
                                                open={openPromptDialogTimestamp === itemKey}
                                                onOpenChange={(isOpen) =>
                                                    !isOpen && setOpenPromptDialogTimestamp(null)
                                                }>
                                                <DialogTrigger asChild>
                                                    <Button
                                                        variant='outline'
                                                        size='sm'
                                                        className='h-6 flex-grow border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                                                        onClick={() => setOpenPromptDialogTimestamp(itemKey)}>
                                                        {t('Show Prompt')}
                                                    </Button>
                                                </DialogTrigger>
                                                <DialogContent className='border-slate-200 bg-white text-slate-900 sm:max-w-[625px]'>
                                                    <DialogHeader>
                                                        <DialogTitle className='text-slate-900'>{t('Prompt')}</DialogTitle>
                                                        <DialogDescription className='sr-only'>
                                                            {t('The full prompt used to generate this image batch.')}
                                                        </DialogDescription>
                                                    </DialogHeader>
                                                    <div className='max-h-[400px] overflow-y-auto rounded-md border border-slate-300 bg-slate-100 p-3 py-4 text-sm text-slate-600'>
                                                        {item.prompt || t('No prompt recorded.')}
                                                    </div>
                                                    <DialogFooter>
                                                        <Button
                                                            variant='outline'
                                                            size='sm'
                                                            onClick={() => handleCopy(item.prompt, itemKey)}
                                                            className='border-slate-300 text-slate-600 hover:bg-slate-200 hover:text-slate-900'>
                                                            {copiedTimestamp === itemKey ? (
                                                                <Check className='mr-2 h-4 w-4 text-emerald-600' />
                                                            ) : (
                                                                <Copy className='mr-2 h-4 w-4' />
                                                            )}
                                                            {copiedTimestamp === itemKey ? t('Copied!') : t('Copy')}
                                                        </Button>
                                                        <DialogClose asChild>
                                                            <Button
                                                                type='button'
                                                                variant='secondary'
                                                                size='sm'
                                                                className='bg-slate-200 text-slate-700 hover:bg-slate-300'>
                                                                {t('Close')}
                                                            </Button>
                                                        </DialogClose>
                                                    </DialogFooter>
                                                </DialogContent>
                                            </Dialog>
                                            <Dialog
                                                open={itemPendingDeleteConfirmation?.timestamp === item.timestamp}
                                                onOpenChange={(isOpen) => {
                                                    if (!isOpen) onCancelDeletion();
                                                }}>
                                                <DialogTrigger asChild>
                                                    <Button
                                                        className='h-6 w-6 border border-slate-200 bg-white text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600'
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onDeleteItemRequest(
                                                                item,
                                                                describeReferenceWarning(item)
                                                            );
                                                        }}
                                                        aria-label={t('Delete history item')}>
                                                        <Trash2 size={14} />
                                                    </Button>
                                                </DialogTrigger>
                                                <DialogContent className='border-slate-200 bg-white text-slate-900 sm:max-w-md'>
                                                    <DialogHeader>
                                                        <DialogTitle className='text-slate-900'>
                                                            {t('Confirm Deletion')}
                                                        </DialogTitle>
                                                        <DialogDescription className='pt-2 text-slate-600'>
                                                            {t(
                                                                'Are you sure you want to delete this history entry? This will remove {count} image(s). This action cannot be undone.',
                                                                { count: item.images.length }
                                                            )}
                                                        </DialogDescription>
                                                        {referenceWarning && itemPendingDeleteConfirmation?.timestamp === item.timestamp && (
                                                            <div className='mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700'>
                                                                {referenceWarning}
                                                            </div>
                                                        )}
                                                    </DialogHeader>
                                                    <div className='flex items-center space-x-2 py-2'>
                                                        <Checkbox
                                                            id={`dont-ask-${item.timestamp}`}
                                                            checked={deletePreferenceDialogValue}
                                                            onCheckedChange={(checked) =>
                                                                onDeletePreferenceDialogChange(!!checked)
                                                            }
                                                            className='border-slate-300 bg-white data-[state=checked]:border-indigo-600 data-[state=checked]:bg-indigo-600 data-[state=checked]:text-white'
                                                        />
                                                        <label
                                                            htmlFor={`dont-ask-${item.timestamp}`}
                                                            className='text-sm leading-none font-medium text-slate-600 peer-disabled:cursor-not-allowed peer-disabled:opacity-70'>
                                                            {t("Don't ask me again")}
                                                        </label>
                                                    </div>
                                                    <DialogFooter className='gap-2 sm:justify-end'>
                                                        <Button
                                                            type='button'
                                                            variant='outline'
                                                            size='sm'
                                                            onClick={onCancelDeletion}
                                                            className='border-slate-300 text-slate-600 hover:bg-slate-200 hover:text-slate-900'>
                                                            {t('Cancel')}
                                                        </Button>
                                                        <Button
                                                            type='button'
                                                            variant='destructive'
                                                            size='sm'
                                                            onClick={onConfirmDeletion}
                                                            className='bg-red-600 text-slate-900 hover:bg-red-500'>
                                                            {t('Delete')}
                                                        </Button>
                                                    </DialogFooter>
                                                </DialogContent>
                                            </Dialog>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

export const HistoryPanel = React.memo(HistoryPanelImpl);
