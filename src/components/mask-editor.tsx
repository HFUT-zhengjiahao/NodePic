'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { useI18n } from '@/lib/i18n';
import { Eraser, Save, UploadCloud } from 'lucide-react';
import Image from 'next/image';
import * as React from 'react';

type DrawnPoint = { x: number; y: number; size: number };

export type MaskEditorProps = {
    /** Image the mask is drawn on (object URL or /api/image/<file>). */
    imageUrl: string;
    imageWidth: number;
    imageHeight: number;
    /** Fired whenever the saved mask changes; null means "no mask". */
    onMaskChange: (file: File | null) => void;
    /** Fired with the generated/uploaded mask preview data URL (used to remember the state). */
    onPreviewChange?: (dataUrl: string | null) => void;
    disabled?: boolean;
};

/**
 * Self-contained mask painter: draw with the brush, upload a PNG mask, clear, or save.
 * Used by the editing form and by the canvas node dialog.
 */
export function MaskEditor({
    imageUrl,
    imageWidth,
    imageHeight,
    onMaskChange,
    onPreviewChange,
    disabled = false
}: MaskEditorProps) {
    const { t } = useI18n();
    const [brushSize, setBrushSize] = React.useState(20);
    const [drawnPoints, setDrawnPoints] = React.useState<DrawnPoint[]>([]);
    const [isMaskSaved, setIsMaskSaved] = React.useState(false);
    const [maskPreviewUrl, setMaskPreviewUrl] = React.useState<string | null>(null);
    const [isGeneratingPreview, setIsGeneratingPreview] = React.useState(false);

    const canvasRef = React.useRef<HTMLCanvasElement>(null);
    const feedbackCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
    const isDrawing = React.useRef(false);
    const lastPos = React.useRef<{ x: number; y: number } | null>(null);
    const maskInputRef = React.useRef<HTMLInputElement>(null);

    // Keep the offscreen feedback canvas in sync with the source image size.
    React.useEffect(() => {
        if (!feedbackCanvasRef.current) {
            feedbackCanvasRef.current = document.createElement('canvas');
        }
        feedbackCanvasRef.current.width = imageWidth;
        feedbackCanvasRef.current.height = imageHeight;
    }, [imageWidth, imageHeight]);

    // Repaint the red overlay every time the stroke set changes.
    React.useEffect(() => {
        const displayCanvas = canvasRef.current;
        const feedbackCanvas = feedbackCanvasRef.current;
        const displayCtx = displayCanvas?.getContext('2d');
        if (!displayCanvas || !feedbackCanvas || !displayCtx) return;

        const feedbackCtx = feedbackCanvas.getContext('2d');
        if (!feedbackCtx) return;

        feedbackCtx.clearRect(0, 0, feedbackCanvas.width, feedbackCanvas.height);
        feedbackCtx.fillStyle = 'red';
        drawnPoints.forEach((point) => {
            feedbackCtx.beginPath();
            feedbackCtx.arc(point.x, point.y, point.size, 0, Math.PI * 2);
            feedbackCtx.fill();
        });

        displayCtx.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
        displayCtx.save();
        displayCtx.globalAlpha = 0.5;
        displayCtx.drawImage(feedbackCanvas, 0, 0, displayCanvas.width, displayCanvas.height);
        displayCtx.restore();
    }, [drawnPoints]);

    const getMousePos = (e: React.MouseEvent | React.TouchEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
    };

    const addPoint = (x: number, y: number) => {
        setDrawnPoints((prev) => [...prev, { x, y, size: brushSize }]);
        setIsMaskSaved(false);
        setMaskPreviewUrl(null);
        onPreviewChange?.(null);
    };

    const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
        if (disabled) return;
        e.preventDefault();
        isDrawing.current = true;
        const pos = getMousePos(e);
        if (!pos) return;
        lastPos.current = pos;
        addPoint(pos.x, pos.y);
    };

    const drawLine = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isDrawing.current) return;
        e.preventDefault();
        const pos = getMousePos(e);
        if (!pos || !lastPos.current) return;

        const dist = Math.hypot(pos.x - lastPos.current.x, pos.y - lastPos.current.y);
        const angle = Math.atan2(pos.y - lastPos.current.y, pos.x - lastPos.current.x);
        const step = Math.max(1, brushSize / 4);
        for (let i = step; i < dist; i += step) {
            addPoint(lastPos.current.x + Math.cos(angle) * i, lastPos.current.y + Math.sin(angle) * i);
        }
        addPoint(pos.x, pos.y);
        lastPos.current = pos;
    };

    const stopDrawing = () => {
        isDrawing.current = false;
        lastPos.current = null;
    };

    const handleClearMask = () => {
        setDrawnPoints([]);
        setIsMaskSaved(false);
        setMaskPreviewUrl(null);
        onPreviewChange?.(null);
        onMaskChange(null);
    };

    /** Drawn areas become transparent (destination-out) so the API treats them as editable. */
    const saveMask = () => {
        if (drawnPoints.length === 0) {
            setIsMaskSaved(false);
            setMaskPreviewUrl(null);
            onPreviewChange?.(null);
            onMaskChange(null);
            return;
        }

        const offscreen = document.createElement('canvas');
        offscreen.width = imageWidth;
        offscreen.height = imageHeight;
        const ctx = offscreen.getContext('2d');
        if (!ctx) return;

        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, offscreen.width, offscreen.height);
        ctx.globalCompositeOperation = 'destination-out';
        drawnPoints.forEach((point) => {
            ctx.beginPath();
            ctx.arc(point.x, point.y, point.size, 0, Math.PI * 2);
            ctx.fill();
        });

        setIsGeneratingPreview(true);
        try {
            const dataUrl = offscreen.toDataURL('image/png');
            setMaskPreviewUrl(dataUrl);
            onPreviewChange?.(dataUrl);
        } catch (error) {
            console.error('Error generating mask preview data URL:', error);
            setMaskPreviewUrl(null);
            onPreviewChange?.(null);
        }

        offscreen.toBlob((blob) => {
            setIsGeneratingPreview(false);
            if (!blob) {
                console.error('Failed to generate mask blob.');
                setIsMaskSaved(false);
                return;
            }
            const file = new File([blob], 'generated-mask.png', { type: 'image/png' });
            setIsMaskSaved(true);
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
            alert(t('Invalid file type. Please upload a PNG file for the mask.'));
            event.target.value = '';
            return;
        }

        const reader = new FileReader();
        const img = new window.Image();
        const objectUrl = URL.createObjectURL(file);

        img.onload = () => {
            if (img.width !== imageWidth || img.height !== imageHeight) {
                alert(
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

            setDrawnPoints([]);
            setIsMaskSaved(true);
            onMaskChange(file);

            reader.onloadend = () => {
                setMaskPreviewUrl(reader.result as string);
                onPreviewChange?.(reader.result as string);
                URL.revokeObjectURL(objectUrl);
            };
            reader.onerror = () => {
                console.error('Error reading mask file for preview.');
                setMaskPreviewUrl(null);
                onPreviewChange?.(null);
                URL.revokeObjectURL(objectUrl);
            };
            reader.readAsDataURL(file);
            event.target.value = '';
        };

        img.onerror = () => {
            alert(t('Failed to load the uploaded mask image to check dimensions.'));
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
                    className={`absolute top-0 left-0 h-full w-full ${
                        disabled ? 'cursor-not-allowed' : 'cursor-crosshair'
                    }`}
                    onMouseDown={startDrawing}
                    onMouseMove={drawLine}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onTouchStart={startDrawing}
                    onTouchMove={drawLine}
                    onTouchEnd={stopDrawing}
                />
            </div>

            <div className='space-y-2'>
                <Label htmlFor='mask-brush-size' className='text-sm text-slate-700'>
                    {t('Brush Size: {size}px', { size: brushSize })}
                </Label>
                <Slider
                    id='mask-brush-size'
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
                        <Eraser className='mr-1.5 h-4 w-4' /> {t('Clear')}
                    </Button>
                    <Button
                        type='button'
                        size='sm'
                        onClick={saveMask}
                        disabled={disabled || drawnPoints.length === 0}
                        className='bg-indigo-600 text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50'>
                        <Save className='mr-1.5 h-4 w-4' /> {t('Save Mask')}
                    </Button>
                </div>
            </div>

            {maskPreviewUrl && (
                <div className='border-t border-slate-100 pt-3 text-center'>
                    <Label className='mb-1.5 block text-sm text-slate-700'>{t('Generated Mask Preview:')}</Label>
                    <div className='inline-block rounded border border-slate-200 bg-white p-1'>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={maskPreviewUrl} alt={t('Generated mask preview')} className='block max-w-full' style={{ height: 134, width: 'auto' }} />
                    </div>
                </div>
            )}
            {isGeneratingPreview && !maskPreviewUrl && (
                <p className='pt-1 text-center text-xs text-amber-600'>{t('Generating mask preview...')}</p>
            )}
            {isMaskSaved && maskPreviewUrl && (
                <p className='pt-1 text-center text-xs text-emerald-600'>{t('Mask saved successfully!')}</p>
            )}
        </div>
    );
}
