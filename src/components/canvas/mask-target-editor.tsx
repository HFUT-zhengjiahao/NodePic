'use client';

import { MaskEditor } from '@/components/mask-editor';
import { useI18n } from '@/lib/i18n';
import { loadMaskRecord } from '@/lib/mask-store';
import * as React from 'react';

/** Loads the picture, then hands it to the shared mask painter. */
export function MaskTargetEditor({
    target,
    maskKey,
    hasMask,
    multiSource,
    onMaskChange
}: {
    target: { nodeId: string; filename: string; path: string };
    /**
     * The picture this mask belongs to (`${canvasId}:${sourceFilename}`).
     *
     * Masks are addressed by picture rather than by node: a mask is a PNG the size of one specific
     * source image, so it has to travel with that image — through a node delete and undo, through a
     * duplicated canvas (a different canvas id, hence a different key), and away from a node whose
     * first source has since been swapped for another picture.
     */
    maskKey: string;
    hasMask: boolean;
    multiSource: boolean;
    onMaskChange: (file: File | null) => void;
}) {
    const { t } = useI18n();
    const [size, setSize] = React.useState<{ width: number; height: number } | null>(null);
    /**
     * `MaskEditor` loads `initialMaskUrl` once, when it mounts, and that is the mask it will edit.
     * Mounting it before the IndexedDB lookup settled used to give it `null`, and the prop arriving a
     * moment later was ignored — the painter opened empty over a mask the user could not see, and the
     * next stroke silently replaced it. Keeping the key alongside the result means the painter only
     * mounts once the lookup for *this* picture is done, which removes the race without resetting
     * state during an effect.
     */
    const [loadedMask, setLoadedMask] = React.useState<{ key: string; url: string | null } | null>(null);
    const existingMaskUrl = loadedMask?.key === maskKey ? loadedMask.url : null;
    const maskLookupDone = loadedMask?.key === maskKey;

    React.useEffect(() => {
        const img = new window.Image();
        img.onload = () => setSize({ width: img.width, height: img.height });
        img.src = target.path;
    }, [target.path]);

    // The painter opens empty, so the stored mask is loaded explicitly and handed over as the bitmap
    // it starts editing — otherwise the first stroke would replace a mask the user cannot even see.
    React.useEffect(() => {
        let url: string | null = null;
        let cancelled = false;

        void loadMaskRecord(maskKey)
            .then((record) => {
                if (cancelled) return;
                if (record?.blob) url = URL.createObjectURL(record.blob);
                setLoadedMask({ key: maskKey, url });
            })
            .catch((error) => {
                console.error('Could not read the stored mask:', error);
                if (!cancelled) setLoadedMask({ key: maskKey, url: null });
            });

        return () => {
            cancelled = true;
            if (url) URL.revokeObjectURL(url);
        };
    }, [maskKey]);

    if (!size || !maskLookupDone) {
        return <p className='py-8 text-center text-xs text-slate-400'>{t('Loading…')}</p>;
    }

    return (
        <div className='space-y-2'>
            {hasMask && (
                <p className='text-[11px] text-amber-600'>
                    {t('This picture already has a mask — it is loaded below, ready to be extended or erased.')}
                </p>
            )}
            {multiSource && (
                <p className='text-[11px] text-slate-500'>
                    {t('With several sources the mask is applied to the first picture.')}
                </p>
            )}
            <MaskEditor
                // A fresh painter per picture: its state (the bitmap being edited, whether it is
                // dirty, the applied preview) belongs to one mask, not to the dialog.
                key={maskKey}
                imageUrl={target.path}
                imageWidth={size.width}
                imageHeight={size.height}
                initialMaskUrl={existingMaskUrl}
                onMaskChange={onMaskChange}
            />
            <p className='text-[11px] text-slate-400'>
                {t('Masks are stored in this browser only — a canvas export does not carry them.')}
            </p>
        </div>
    );
}
