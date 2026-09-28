'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { useI18n } from '@/lib/i18n';
import { Brush, Eraser, Save, Trash2, UploadCloud } from 'lucide-react';
import Image from 'next/image';
import * as React from 'react';

export type MaskEditorProps = {
    /** Image the mask is drawn on (object URL or /api/image/<file>). */
    imageUrl: string;
    imageWidth: number;
    imageHeight: number;
    /** Fired whenever the mask changes; null means "no mask". */
    onMaskChange: (file: File | null) => void;
    /** Object URL of the mask already saved for this picture, loaded so it can be edited further. */
    initialMaskUrl?: string | null;
    disabled?: boolean;
};

/**
 * Mask painter: brush, eraser, upload, clear, save.
 *
 * The editing surface is a bitmap of the *repaintable* area — the inverse of the stored mask, which
 * is black where the picture must stay untouched and transparent where the model may change it.
 *
 * Keeping that bitmap alive across saves is what makes a saved mask editable. The previous version
 * kept only the strokes of the current session and rebuilt the mask from them on every save, so a
 * second visit could only replace the first mask wholesale; now the stored mask is loaded into the
 * bitmap on open, which means strokes add to what is already there and the eraser takes parts away.
 */
export function MaskEditor({
    imageUrl,
    imageWidth,
    imageHeight,
    onMaskChange,
    initialMaskUrl = null,
    disabled = false
}: MaskEditorProps) {
    const { t } = useI18n();
    const [brushSize, setBrushSize] = React.useState(20);
    /** Paint adds to the repaintable area, erase takes it away. */
    const [tool, setTool] = React.useState<'brush' | 'eraser'>('brush');
    /** Something has been drawn or erased since the last save. */
    const [isDirty, setIsDirty] = React.useState(false);
    /** The mask as it is currently stored — what a run would actually send. */
    const [appliedPreviewUrl, setAppliedPreviewUrl] = React.useState<string | null>(initialMaskUrl ?? null);
    const [isGeneratingPreview, setIsGeneratingPreview] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const canvasRef = React.useRef<HTMLCanvasElement>(null);
    /** Offscreen bitmap of the repaintable area, painted red (only its alpha is used). */
    const paintRef = React.useRef<HTMLCanvasElement | null>(null);
    const isDrawing = React.useRef(false);
    const lastPos = React.useRef<{ x: number; y: number } | null>(null);
    const maskInputRef = React.useRef<HTMLInputElement>(null);

    const paintCanvas = () => {
        const existing = paintRef.current;
        if (existing) return existing;
        const created = document.createElement('canvas');
        paintRef.current = created;
        return created;
    };

    /** Draws the paint bitmap onto the visible canvas as a translucent red overlay. */
    const redraw = React.useCallback(() => {
        const display = canvasRef.current;
        const paint = paintRef.current;
        const ctx = display?.getContext('2d');
        if (!display || !paint || !ctx) return;
        ctx.clearRect(0, 0, display.width, display.height);
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.drawImage(paint, 0, 0, display.width, display.height);
        ctx.restore();
    }, []);

    /**
     * Loads a mask PNG into the paint bitmap.
     *
     * The stored mask is opaque (black) where the picture must stay untouched, so painting the bitmap
     * solid and then *removing* the mask's opaque pixels with `destination-out` leaves exactly the
     * repaintable area — soft edges included, no per-pixel loop needed.
     */
    const loadMaskIntoPaint = React.useCallback(
        (source: string, onLoaded?: () => void) => {
            const paint = paintCanvas();
            paint.width = imageWidth;
            paint.height = imageHeight;
            const ctx = paint.getContext('2d');
            if (!ctx) return;

            const img = new window.Image();
            img.onload = () => {
                ctx.save();
                ctx.globalCompositeOperation = 'source-over';
                ctx.fillStyle = '#ff0000';
                ctx.fillRect(0, 0, paint.width, paint.height);
                ctx.globalCompositeOperation = 'destination-out';
                ctx.drawImage(img, 0, 0, paint.width, paint.height);
                ctx.restore();
                onLoaded?.();
                redraw();
            };
            img.onerror = () => {
                console.error('Could not read the stored mask — starting from an empty one.');
                paint.width = imageWidth;
                paint.height = imageHeight;
                onLoaded?.();
                redraw();
            };
            img.src = source;
        },
        [imageHeight, imageWidth, redraw]
    );

    // Open with the stored mask already in place, sized to the picture. Assigning width/height also
    // clears the bitmap, which is what "no stored mask" needs. No state is set here: a different
    // picture means a different `key` on this component (see MaskTargetEditor), so the initial state
    // is already correct.
    React.useEffect(() => {
        if (initialMaskUrl) {
            loadMaskIntoPaint(initialMaskUrl);
            return;
        }
        const paint = paintCanvas();
        paint.width = imageWidth;
        paint.height = imageHeight;
        redraw();
    }, [imageHeight, imageWidth, initialMaskUrl, loadMaskIntoPaint, redraw]);

    const getPointerPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
    };

    /** One segment of a stroke, drawn straight into the bitmap. */
    const strokeTo = (from: { x: number; y: number }, to: { x: number; y: number }) => {
        const paint = paintRef.current;
        const ctx = paint?.getContext('2d');
        if (!paint || !ctx) return;
        ctx.save();
        ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
        ctx.strokeStyle = '#ff0000';
        // The slider is a radius, as it was when each point was an arc of that size.
        ctx.lineWidth = brushSize * 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        ctx.restore();
    };

    const startDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (disabled) return;
        e.preventDefault();
        // Pointer capture keeps the stroke alive once the pointer leaves the canvas. React attaches
        // touchmove passively, so the old onTouchMove + preventDefault() did not stop the page from
        // scrolling under a finger; `touch-action: none` on the canvas does.
        e.currentTarget.setPointerCapture?.(e.pointerId);
        const pos = getPointerPos(e);
        if (!pos) return;
        isDrawing.current = true;
        lastPos.current = pos;
        strokeTo(pos, pos);
        setIsDirty(true);
        redraw();
    };

    const drawLine = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!isDrawing.current) return;
        e.preventDefault();
        const pos = getPointerPos(e);
        if (!pos || !lastPos.current) return;
        strokeTo(lastPos.current, pos);
        lastPos.current = pos;
        redraw();
    };

    const stopDrawing = () => {
        isDrawing.current = false;
        lastPos.current = null;
    };

    const handleClearMask = () => {
        const paint = paintCanvas();
        paint.width = imageWidth;
        paint.height = imageHeight;
        setIsDirty(false);
        setAppliedPreviewUrl(null);
        onMaskChange(null);
        redraw();
    };

    /** Black everywhere, transparent in the repaintable area — the shape the API expects. */
    const buildMaskCanvas = () => {
        const paint = paintRef.current;
        const output = document.createElement('canvas');
        output.width = imageWidth;
        output.height = imageHeight;
        const ctx = output.getContext('2d');
        if (!ctx || !paint) return null;
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, output.width, output.height);
        ctx.globalCompositeOperation = 'destination-out';
        ctx.drawImage(paint, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        return output;
    };

    const saveMask = () => {
        const output = buildMaskCanvas();
        if (!output) return;

        setIsGeneratingPreview(true);
        try {
            const dataUrl = output.toDataURL('image/png');
            setAppliedPreviewUrl(dataUrl);
        } catch (previewError) {
            console.error('Error generating mask preview data URL:', previewError);
            setAppliedPreviewUrl(null);
        }

        output.toBlob((blob) => {
            setIsGeneratingPreview(false);
            if (!blob) {
                console.error('Failed to generate mask blob.');
                return;
            }
            const file = new File([blob], 'generated-mask.png', { type: 'image/png' });
            setIsDirty(false);
            onMaskChange(file);
        }, 'image/png');
    };

    const handleMaskFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) {
            event.target.value = '';
            return;
        }

        if (file.type !== 'image/png') {
            setError(t('Invalid file type. Please upload a PNG file for the mask.'));
            event.target.value = '';
            return;
        }

        const objectUrl = URL.createObjectURL(file);
        const img = new window.Image();

        img.onload = () => {
            if (img.width !== imageWidth || img.height !== imageHeight) {
                setError(
                    t(
                        'Mask dimensions ({width}x{height}) must match the source image dimensions ({sourceWidth}x{sourceHeight}).',
                        {
                            width: img.width,
                            height: img.height,
                            sourceWidth: imageWidth,
                            sourceHeight: imageHeight
                        }
                    )
                );
                URL.revokeObjectURL(objectUrl);
                event.target.value = '';
                return;
            }

            setError(null);
            // The upload replaces the whole mask, and is then editable like any other.
            setAppliedPreviewUrl(objectUrl);
            onMaskChange(file);
            loadMaskIntoPaint(objectUrl, () => setIsDirty(false));
            event.target.value = '';
        };

        img.onerror = () => {
            setError(t('Failed to load the uploaded mask image to check dimensions.'));
            URL.revokeObjectURL(objectUrl);
            event.target.value = '';
        };

        img.src = objectUrl;
    };

    return (
        <div className='space-y-3'>
            <p className='text-xs text-slate-500'>
                {t('Draw on the image below to mark areas for editing (drawn areas become transparent in the mask).')}
            </p>

            <div
                className='relative mx-auto w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-50'
                // Cap by viewport height as well as width: a square mask picture would otherwise push
                // the brush slider and the Save button below the fold on a 728px-tall laptop screen.
                style={{
                    maxWidth: `min(100%, ${imageWidth}px, ${((44 * imageWidth) / imageHeight).toFixed(2)}vh)`,
                    aspectRatio: `${imageWidth} / ${imageHeight}`
                }}>
                <Image
                    src={imageUrl}
                    alt={t('Image preview for masking')}
                    width={imageWidth}
                    height={imageHeight}
                    className='block h-auto w-full'
                    unoptimized
                />
                <canvas
                    ref={canvasRef}
                    width={imageWidth}
                    height={imageHeight}
                    role='application'
                    aria-label={t('Mask drawing area — paint over the parts you want to edit')}
                    className={`absolute top-0 left-0 h-full w-full ${
                        disabled ? 'cursor-not-allowed' : 'cursor-crosshair'
                    }`}
                    // Without this a finger drag scrolls the page instead of painting.
                    style={{ touchAction: 'none' }}
                    onPointerDown={startDrawing}
                    onPointerMove={drawLine}
                    onPointerUp={stopDrawing}
                    onPointerCancel={stopDrawing}
                    onPointerLeave={stopDrawing}
                />
            </div>

            <div className='space-y-2'>
                <div className='flex items-center gap-2'>
                    {/* Two tools, one canvas: the brush extends the repaintable area, the eraser trims it. */}
                    <div
                        className='flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5'
                        role='group'
                        aria-label={t('Tool')}>
                        <button
                            type='button'
                            aria-pressed={tool === 'brush'}
                            title={t('Brush')}
                            onClick={() => setTool('brush')}
                            disabled={disabled}
                            className={`flex h-7 items-center gap-1 rounded-md px-2 text-[12px] transition-colors disabled:opacity-40 ${
                                tool === 'brush'
                                    ? 'bg-indigo-50 text-indigo-600'
                                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                            }`}>
                            <Brush className='h-3.5 w-3.5' />
                            {t('Brush')}
                        </button>
                        <button
                            type='button'
                            aria-pressed={tool === 'eraser'}
                            title={t('Eraser')}
                            onClick={() => setTool('eraser')}
                            disabled={disabled}
                            className={`flex h-7 items-center gap-1 rounded-md px-2 text-[12px] transition-colors disabled:opacity-40 ${
                                tool === 'eraser'
                                    ? 'bg-indigo-50 text-indigo-600'
                                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                            }`}>
                            <Eraser className='h-3.5 w-3.5' />
                            {t('Eraser')}
                        </button>
                    </div>
                    <Label htmlFor='mask-brush-size' className='ml-auto text-sm text-slate-700'>
                        {t('Brush Size: {size}px', { size: brushSize })}
                    </Label>
                </div>
                <Slider
                    id='mask-brush-size'
                    // The Label above points at the Radix root, which is not the element carrying
                    // role="slider" — without this the thumb is announced without a name.
                    aria-label={t('Brush size in pixels')}
                    min={5}
                    max={100}
                    step={1}
                    value={[brushSize]}
                    onValueChange={(value) => setBrushSize(value[0])}
                    disabled={disabled}
                    className='[&>button]:border-white [&>button]:bg-indigo-600 [&>button]:ring-offset-white [&>span:first-child]:h-1 [&>span:first-child>span]:bg-indigo-500'
                />
            </div>

            <div className='flex items-center justify-between gap-2 pt-1'>
                <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => maskInputRef.current?.click()}
                    disabled={disabled}
                    className='mr-auto border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900'>
                    <UploadCloud className='mr-1.5 h-4 w-4' /> {t('Upload Mask')}
                </Button>
                <Input
                    ref={maskInputRef}
                    id='mask-file-input'
                    type='file'
                    accept='image/png'
                    onChange={handleMaskFileChange}
                    className='sr-only'
                />
                <div className='flex gap-2'>
                    <Button
                        type='button'
                        variant='outline'
                        size='sm'
                        onClick={handleClearMask}
                        disabled={disabled}
                        className='border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900'>
                        <Trash2 className='mr-1.5 h-4 w-4' /> {t('Clear')}
                    </Button>
                    <Button
                        type='button'
                        size='sm'
                        onClick={saveMask}
                        disabled={disabled || !isDirty}
                        className='bg-indigo-600 text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50'>
                        <Save className='mr-1.5 h-4 w-4' /> {isDirty ? t('Save changes') : t('Save Mask')}
                    </Button>
                </div>
            </div>

            {error && (
                <p role='alert' className='text-xs text-red-600'>
                    {error}
                </p>
            )}
            {appliedPreviewUrl && (
                <div className='border-t border-slate-100 pt-3 text-center'>
                    <Label className='mb-1.5 block text-sm text-slate-700'>{t('Generated Mask Preview:')}</Label>
                    <div className='inline-block rounded border border-slate-200 bg-white p-1'>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={appliedPreviewUrl}
                            alt={t('Generated mask preview')}
                            className='block max-w-full'
                            style={{ height: 134, width: 'auto' }}
                        />
                    </div>
                </div>
            )}
            {isGeneratingPreview && !appliedPreviewUrl && (
                <p className='pt-1 text-center text-xs text-amber-600'>{t('Generating mask preview...')}</p>
            )}
            {isDirty && (
                <p className='pt-1 text-center text-xs text-amber-600'>
                    {t('Unsaved changes — press Save to apply them.')}
                </p>
            )}
        </div>
    );
}
