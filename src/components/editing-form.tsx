'use client';

import { ImageOptions } from '@/components/image-options';
import { ModeToggle } from '@/components/mode-toggle';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useI18n } from '@/lib/i18n';
import {
    GPT_IMAGE_MODELS,
    type GptImageModel,
    type ImageBackground,
    type ImageModeration,
    type ImageOutputFormat,
    type ImageQuality
} from '@/lib/models';
import { validateCustomSize, type SizePreset } from '@/lib/size-utils';
import { Upload, Eraser, Save, Loader2, X, ScanEye, UploadCloud, Lock, LockOpen, HelpCircle } from 'lucide-react';
import Image from 'next/image';
import * as React from 'react';

type DrawnPoint = {
    x: number;
    y: number;
    size: number;
};

export type EditingFormData = {
    prompt: string;
    n: number;
    size: SizePreset;
    customWidth: number;
    customHeight: number;
    quality: ImageQuality;
    output_format: ImageOutputFormat;
    output_compression?: number;
    background: ImageBackground;
    moderation: ImageModeration;
    imageFiles: File[];
    maskFile: File | null;
    model: GptImageModel;
};

type EditingFormProps = {
    onSubmit: (data: EditingFormData) => void;
    isLoading: boolean;
    currentMode: 'generate' | 'edit';
    onModeChange: (mode: 'generate' | 'edit') => void;
    isPasswordRequiredByBackend: boolean | null;
    clientPasswordHash: string | null;
    onOpenPasswordDialog: () => void;
    editModel: EditingFormData['model'];
    setEditModel: React.Dispatch<React.SetStateAction<EditingFormData['model']>>;
    imageFiles: File[];
    sourceImagePreviewUrls: string[];
    setImageFiles: React.Dispatch<React.SetStateAction<File[]>>;
    setSourceImagePreviewUrls: React.Dispatch<React.SetStateAction<string[]>>;
    maxImages: number;
    editPrompt: string;
    setEditPrompt: React.Dispatch<React.SetStateAction<string>>;
    editN: number[];
    setEditN: React.Dispatch<React.SetStateAction<number[]>>;
    editSize: EditingFormData['size'];
    setEditSize: React.Dispatch<React.SetStateAction<EditingFormData['size']>>;
    editCustomWidth: number;
    setEditCustomWidth: React.Dispatch<React.SetStateAction<number>>;
    editCustomHeight: number;
    setEditCustomHeight: React.Dispatch<React.SetStateAction<number>>;
    editQuality: EditingFormData['quality'];
    setEditQuality: React.Dispatch<React.SetStateAction<EditingFormData['quality']>>;
    editOutputFormat: EditingFormData['output_format'];
    setEditOutputFormat: React.Dispatch<React.SetStateAction<EditingFormData['output_format']>>;
    editCompression: number[];
    setEditCompression: React.Dispatch<React.SetStateAction<number[]>>;
    editBackground: EditingFormData['background'];
    setEditBackground: React.Dispatch<React.SetStateAction<EditingFormData['background']>>;
    editModeration: EditingFormData['moderation'];
    setEditModeration: React.Dispatch<React.SetStateAction<EditingFormData['moderation']>>;
    editBrushSize: number[];
    setEditBrushSize: React.Dispatch<React.SetStateAction<number[]>>;
    editShowMaskEditor: boolean;
    setEditShowMaskEditor: React.Dispatch<React.SetStateAction<boolean>>;
    editGeneratedMaskFile: File | null;
    setEditGeneratedMaskFile: React.Dispatch<React.SetStateAction<File | null>>;
    editIsMaskSaved: boolean;
    setEditIsMaskSaved: React.Dispatch<React.SetStateAction<boolean>>;
    editOriginalImageSize: { width: number; height: number } | null;
    setEditOriginalImageSize: React.Dispatch<React.SetStateAction<{ width: number; height: number } | null>>;
    editDrawnPoints: DrawnPoint[];
    setEditDrawnPoints: React.Dispatch<React.SetStateAction<DrawnPoint[]>>;
    editMaskPreviewUrl: string | null;
    setEditMaskPreviewUrl: React.Dispatch<React.SetStateAction<string | null>>;
    enableStreaming: boolean;
    setEnableStreaming: React.Dispatch<React.SetStateAction<boolean>>;
    partialImages: 1 | 2 | 3;
    setPartialImages: React.Dispatch<React.SetStateAction<1 | 2 | 3>>;
};

export function EditingForm({
    onSubmit,
    isLoading,
    currentMode,
    onModeChange,
    isPasswordRequiredByBackend,
    clientPasswordHash,
    onOpenPasswordDialog,
    editModel,
    setEditModel,
    imageFiles,
    sourceImagePreviewUrls,
    setImageFiles,
    setSourceImagePreviewUrls,
    maxImages,
    editPrompt,
    setEditPrompt,
    editN,
    setEditN,
    editSize,
    setEditSize,
    editCustomWidth,
    setEditCustomWidth,
    editCustomHeight,
    setEditCustomHeight,
    editQuality,
    setEditQuality,
    editOutputFormat,
    setEditOutputFormat,
    editCompression,
    setEditCompression,
    editBackground,
    setEditBackground,
    editModeration,
    setEditModeration,
    editBrushSize,
    setEditBrushSize,
    editShowMaskEditor,
    setEditShowMaskEditor,
    editGeneratedMaskFile,
    setEditGeneratedMaskFile,
    editIsMaskSaved,
    setEditIsMaskSaved,
    editOriginalImageSize,
    setEditOriginalImageSize,
    editDrawnPoints,
    setEditDrawnPoints,
    editMaskPreviewUrl,
    setEditMaskPreviewUrl,
    enableStreaming,
    setEnableStreaming,
    partialImages,
    setPartialImages
}: EditingFormProps) {
    const { t } = useI18n();
    const [firstImagePreviewUrl, setFirstImagePreviewUrl] = React.useState<string | null>(null);

    const showCompression = editOutputFormat === 'jpeg' || editOutputFormat === 'webp';
    const customSizeValidation =
        editSize === 'custom'
        ? validateCustomSize(editCustomWidth, editCustomHeight, t)
        : { valid: true as const };
    const customSizeInvalid = !customSizeValidation.valid;

    // Disable streaming when editN > 1 (OpenAI limitation)
    React.useEffect(() => {
        if (editN[0] > 1 && enableStreaming) {
            setEnableStreaming(false);
        }
    }, [editN, enableStreaming, setEnableStreaming]);

    const canvasRef = React.useRef<HTMLCanvasElement>(null);
    const visualFeedbackCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
    const isDrawing = React.useRef(false);
    const lastPos = React.useRef<{ x: number; y: number } | null>(null);
    const maskInputRef = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => {
        if (editOriginalImageSize) {
            if (!visualFeedbackCanvasRef.current) {
                visualFeedbackCanvasRef.current = document.createElement('canvas');
            }
            visualFeedbackCanvasRef.current.width = editOriginalImageSize.width;
            visualFeedbackCanvasRef.current.height = editOriginalImageSize.height;
        }
    }, [editOriginalImageSize]);

    React.useEffect(() => {
        let cancelled = false;

        queueMicrotask(() => {
            if (cancelled) return;

            setEditGeneratedMaskFile(null);
            setEditIsMaskSaved(false);
            setEditOriginalImageSize(null);
            setFirstImagePreviewUrl(null);
            setEditDrawnPoints([]);
            setEditMaskPreviewUrl(null);

            if (imageFiles.length > 0 && sourceImagePreviewUrls.length > 0) {
                const img = new window.Image();
                img.onload = () => {
                    if (!cancelled) {
                        setEditOriginalImageSize({ width: img.width, height: img.height });
                    }
                };
                img.src = sourceImagePreviewUrls[0];
                setFirstImagePreviewUrl(sourceImagePreviewUrls[0]);
            } else {
                setEditShowMaskEditor(false);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [
        imageFiles,
        sourceImagePreviewUrls,
        setEditGeneratedMaskFile,
        setEditIsMaskSaved,
        setEditOriginalImageSize,
        setEditDrawnPoints,
        setEditMaskPreviewUrl,
        setEditShowMaskEditor
    ]);

    React.useEffect(() => {
        const displayCtx = canvasRef.current?.getContext('2d');
        const displayCanvas = canvasRef.current;
        const feedbackCanvas = visualFeedbackCanvasRef.current;

        if (!displayCtx || !displayCanvas || !feedbackCanvas || !editOriginalImageSize) return;

        const feedbackCtx = feedbackCanvas.getContext('2d');
        if (!feedbackCtx) return;

        feedbackCtx.clearRect(0, 0, feedbackCanvas.width, feedbackCanvas.height);
        feedbackCtx.fillStyle = 'red';
        editDrawnPoints.forEach((point) => {
            feedbackCtx.beginPath();
            feedbackCtx.arc(point.x, point.y, point.size, 0, Math.PI * 2);
            feedbackCtx.fill();
        });

        displayCtx.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
        displayCtx.save();
        displayCtx.globalAlpha = 0.5;
        displayCtx.drawImage(feedbackCanvas, 0, 0, displayCanvas.width, displayCanvas.height);
        displayCtx.restore();
    }, [editDrawnPoints, editOriginalImageSize]);

    const getMousePos = (e: React.MouseEvent | React.TouchEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    };

    const addPoint = (x: number, y: number) => {
        setEditDrawnPoints((prevPoints) => [...prevPoints, { x, y, size: editBrushSize[0] }]);
        setEditIsMaskSaved(false);
        setEditMaskPreviewUrl(null);
    };

    const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
        e.preventDefault();
        isDrawing.current = true;
        const currentPos = getMousePos(e);
        if (!currentPos) return;
        lastPos.current = currentPos;
        addPoint(currentPos.x, currentPos.y);
    };

    const drawLine = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isDrawing.current) return;
        e.preventDefault();
        const currentPos = getMousePos(e);
        if (!currentPos || !lastPos.current) return;

        const dist = Math.hypot(currentPos.x - lastPos.current.x, currentPos.y - lastPos.current.y);
        const angle = Math.atan2(currentPos.y - lastPos.current.y, currentPos.x - lastPos.current.x);
        const step = Math.max(1, editBrushSize[0] / 4);

        for (let i = step; i < dist; i += step) {
            const x = lastPos.current.x + Math.cos(angle) * i;
            const y = lastPos.current.y + Math.sin(angle) * i;
            addPoint(x, y);
        }
        addPoint(currentPos.x, currentPos.y);

        lastPos.current = currentPos;
    };

    const drawMaskStroke = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number) => {
        ctx.fillStyle = 'black';
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
    };

    const stopDrawing = () => {
        isDrawing.current = false;
        lastPos.current = null;
    };

    const handleClearMask = () => {
        setEditDrawnPoints([]);
        setEditGeneratedMaskFile(null);
        setEditIsMaskSaved(false);
        setEditMaskPreviewUrl(null);
    };

    const generateAndSaveMask = () => {
        if (!editOriginalImageSize || editDrawnPoints.length === 0) {
            setEditGeneratedMaskFile(null);
            setEditIsMaskSaved(false);
            setEditMaskPreviewUrl(null);
            return;
        }

        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = editOriginalImageSize.width;
        offscreenCanvas.height = editOriginalImageSize.height;
        const offscreenCtx = offscreenCanvas.getContext('2d');

        if (!offscreenCtx) return;

        offscreenCtx.fillStyle = '#000000';
        offscreenCtx.fillRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
        offscreenCtx.globalCompositeOperation = 'destination-out';
        editDrawnPoints.forEach((point) => {
            drawMaskStroke(offscreenCtx, point.x, point.y, point.size);
        });

        try {
            const dataUrl = offscreenCanvas.toDataURL('image/png');
            setEditMaskPreviewUrl(dataUrl);
        } catch (e) {
            console.error('Error generating mask preview data URL:', e);
            setEditMaskPreviewUrl(null);
        }

        offscreenCanvas.toBlob((blob) => {
            if (blob) {
                const maskFile = new File([blob], 'generated-mask.png', { type: 'image/png' });
                setEditGeneratedMaskFile(maskFile);
                setEditIsMaskSaved(true);
            } else {
                console.error('Failed to generate mask blob.');
                setEditIsMaskSaved(false);
                setEditMaskPreviewUrl(null);
            }
        }, 'image/png');
    };

    const handleImageFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files) {
            const newFiles = Array.from(event.target.files);
            const totalFiles = imageFiles.length + newFiles.length;

            if (totalFiles > maxImages) {
                alert(t('You can only select up to {max} images.', { max: maxImages }));
                const allowedNewFiles = newFiles.slice(0, maxImages - imageFiles.length);
                if (allowedNewFiles.length === 0) {
                    event.target.value = '';
                    return;
                }
                newFiles.splice(allowedNewFiles.length);
            }

            setImageFiles((prevFiles) => [...prevFiles, ...newFiles]);

            const newFilePromises = newFiles.map((file) => {
                return new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });
            });

            Promise.all(newFilePromises)
                .then((newUrls) => {
                    setSourceImagePreviewUrls((prevUrls) => [...prevUrls, ...newUrls]);
                })
                .catch((error) => {
                    console.error('Error reading new image files:', error);
                });

            event.target.value = '';
        }
    };

    const handleRemoveImage = (indexToRemove: number) => {
        setImageFiles((prevFiles) => prevFiles.filter((_, index) => index !== indexToRemove));
        setSourceImagePreviewUrls((prevUrls) => prevUrls.filter((_, index) => index !== indexToRemove));
    };

    const handleMaskFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file || !editOriginalImageSize) {
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
            if (img.width !== editOriginalImageSize.width || img.height !== editOriginalImageSize.height) {
                alert(
                    t(
                        'Mask dimensions ({width}x{height}) must match the source image dimensions ({sourceWidth}x{sourceHeight}).',
                        {
                            width: img.width,
                            height: img.height,
                            sourceWidth: editOriginalImageSize.width,
                            sourceHeight: editOriginalImageSize.height
                        }
                    )
                );
                URL.revokeObjectURL(objectUrl);
                event.target.value = '';
                return;
            }

            setEditGeneratedMaskFile(file);
            setEditIsMaskSaved(true);
            setEditDrawnPoints([]);

            reader.onloadend = () => {
                setEditMaskPreviewUrl(reader.result as string);
                URL.revokeObjectURL(objectUrl);
            };
            reader.onerror = () => {
                console.error('Error reading mask file for preview.');
                setEditMaskPreviewUrl(null);
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

    const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (imageFiles.length === 0) {
            alert(t('Please select at least one image to edit.'));
            return;
        }
        if (editDrawnPoints.length > 0 && !editGeneratedMaskFile && !editIsMaskSaved) {
            alert(t('Please save the mask you have drawn before submitting.'));
            return;
        }
        if (customSizeInvalid) {
            return;
        }

        const formData: EditingFormData = {
            prompt: editPrompt,
            n: editN[0],
            size: editSize,
            customWidth: editCustomWidth,
            customHeight: editCustomHeight,
            quality: editQuality,
            output_format: editOutputFormat,
            background: editBackground,
            moderation: editModeration,
            imageFiles: imageFiles,
            maskFile: editGeneratedMaskFile,
            model: editModel
        };
        if (showCompression) {
            formData.output_compression = editCompression[0];
        }
        onSubmit(formData);
    };

    const displayFileNames = (files: File[]) => {
        if (files.length === 0) return t('No file selected.');
        if (files.length === 1) return files[0].name;
        return t('{count} files selected', { count: files.length });
    };

    return (
        <Card className='flex h-full w-full flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-20px_rgba(15,23,42,0.25)]'>
            <CardHeader className='flex items-start justify-between border-b border-slate-100 bg-white px-5 py-4'>
                <div>
                    <div className='flex items-center gap-2.5'>
                        <span className='h-2 w-2 shrink-0 rounded-full bg-violet-500' aria-hidden='true' />
                        <CardTitle className='text-[17px] font-semibold tracking-tight text-slate-900'>
                            {t('Edit Image')}
                        </CardTitle>
                        {isPasswordRequiredByBackend && (
                            <Button
                                variant='ghost'
                                size='icon'
                                onClick={onOpenPasswordDialog}
                                className='ml-2 text-slate-500 hover:text-slate-900'
                                aria-label={t('Configure Password')}>
                                {clientPasswordHash ? <Lock className='h-4 w-4' /> : <LockOpen className='h-4 w-4' />}
                            </Button>
                        )}
                    </div>
                    <CardDescription className='mt-1 pl-[18px] text-[13px] text-slate-500'>
                        {t('Modify an existing image with a text prompt.')}
                    </CardDescription>
                </div>
                <ModeToggle currentMode={currentMode} onModeChange={onModeChange} />
            </CardHeader>
            <form onSubmit={handleSubmit} className='flex h-full flex-1 flex-col overflow-hidden'>
                <CardContent className='flex-1 space-y-5 overflow-y-auto p-4'>
                    <div className='space-y-1.5'>
                        <Label htmlFor='edit-model-select' className='text-slate-900'>
                            {t('Model')}
                        </Label>
                        <div className='flex items-center gap-4'>
                            <Select
                                value={editModel}
                                onValueChange={(value) => setEditModel(value as GptImageModel)}
                                disabled={isLoading}>
                                <SelectTrigger
                                    id='edit-model-select'
                                    className='w-[220px] rounded-md border border-slate-200 bg-white text-slate-900 focus:border-indigo-400 focus:ring-indigo-100'>
                                    <SelectValue placeholder={t('Select model')} />
                                </SelectTrigger>
                                <SelectContent className='border-slate-200 bg-white text-slate-900'>
                                    {GPT_IMAGE_MODELS.map((id) => (
                                        <SelectItem key={id} value={id} className='focus:bg-slate-100'>
                                            {id}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div className='flex items-center gap-2'>
                                        <Checkbox
                                            id='edit-enable-streaming'
                                            checked={enableStreaming}
                                            onCheckedChange={(checked) => setEnableStreaming(!!checked)}
                                            disabled={isLoading || editN[0] > 1}
                                            className='border-slate-300 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-indigo-600 data-[state=checked]:bg-indigo-600 data-[state=checked]:text-white'
                                        />
                                        <Label
                                            htmlFor='edit-enable-streaming'
                                            className={`text-sm ${editN[0] > 1 ? 'cursor-not-allowed text-slate-400' : 'cursor-pointer text-slate-700'}`}>
                                            {t('Enable Streaming')}
                                        </Label>
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent className='max-w-[250px]'>
                                    {editN[0] > 1
                                        ? t('Streaming is only supported when generating a single image (n=1).')
                                        : t(
                                              'Shows partial preview images as they are generated, providing a more interactive experience.'
                                          )}
                                </TooltipContent>
                            </Tooltip>
                        </div>
                    </div>

                    {enableStreaming && (
                        <div className='space-y-3'>
                            <div className='flex items-center gap-2'>
                                <Label className='text-slate-900'>{t('Preview Images')}</Label>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <HelpCircle className='h-4 w-4 cursor-help text-slate-400 hover:text-slate-500' />
                                    </TooltipTrigger>
                                    <TooltipContent className='max-w-[250px]'>
                                        {t('Each preview image adds ~$0.003 to the cost (100 additional output tokens).')}
                                    </TooltipContent>
                                </Tooltip>
                            </div>
                            <RadioGroup
                                value={String(partialImages)}
                                onValueChange={(value) => setPartialImages(Number(value) as 1 | 2 | 3)}
                                disabled={isLoading}
                                className='flex gap-x-5'>
                                <div className='flex items-center space-x-2'>
                                    <RadioGroupItem
                                        value='1'
                                        id='edit-partial-1'
                                        className='border-slate-300 text-slate-500 data-[state=checked]:border-indigo-600 data-[state=checked]:text-indigo-600'
                                    />
                                    <Label htmlFor='edit-partial-1' className='cursor-pointer text-slate-700'>
                                        1
                                    </Label>
                                </div>
                                <div className='flex items-center space-x-2'>
                                    <RadioGroupItem
                                        value='2'
                                        id='edit-partial-2'
                                        className='border-slate-300 text-slate-500 data-[state=checked]:border-indigo-600 data-[state=checked]:text-indigo-600'
                                    />
                                    <Label htmlFor='edit-partial-2' className='cursor-pointer text-slate-700'>
                                        2
                                    </Label>
                                </div>
                                <div className='flex items-center space-x-2'>
                                    <RadioGroupItem
                                        value='3'
                                        id='edit-partial-3'
                                        className='border-slate-300 text-slate-500 data-[state=checked]:border-indigo-600 data-[state=checked]:text-indigo-600'
                                    />
                                    <Label htmlFor='edit-partial-3' className='cursor-pointer text-slate-700'>
                                        3
                                    </Label>
                                </div>
                            </RadioGroup>
                        </div>
                    )}

                    <div className='space-y-1.5'>
                        <Label htmlFor='edit-prompt' className='text-slate-900'>
                            {t('Prompt')}
                        </Label>
                        <Textarea
                            id='edit-prompt'
                            placeholder={t('e.g., Add a party hat to the main subject')}
                            value={editPrompt}
                            onChange={(e) => setEditPrompt(e.target.value)}
                            required
                            disabled={isLoading}
                            className='min-h-[80px] rounded-md border border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:ring-indigo-100'
                        />
                    </div>

                    <div className='space-y-2'>
                        <Label className='text-slate-900'>
                            {t('Source Image(s) [Max: {max}]', { max: maxImages })}
                        </Label>
                        <Label
                            htmlFor='image-files-input'
                            className='flex h-10 w-full cursor-pointer items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-sm transition-colors hover:bg-slate-50'>
                            <span className='truncate pr-2 text-slate-500'>{displayFileNames(imageFiles)}</span>
                            <span className='flex shrink-0 items-center gap-1.5 rounded-md bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200'>
                                <Upload className='h-3 w-3' /> {t('Browse...')}
                            </span>
                        </Label>
                        <Input
                            id='image-files-input'
                            type='file'
                            accept='image/png, image/jpeg, image/webp'
                            multiple
                            onChange={handleImageFileChange}
                            disabled={isLoading || imageFiles.length >= maxImages}
                            className='sr-only'
                        />
                        {sourceImagePreviewUrls.length > 0 && (
                            <div className='flex space-x-2 overflow-x-auto pt-2'>
                                {sourceImagePreviewUrls.map((url, index) => (
                                    <div key={url} className='relative shrink-0'>
                                        <Image
                                            src={url}
                                            alt={`Source preview ${index + 1}`}
                                            width={80}
                                            height={80}
                                            className='rounded border border-slate-200 object-cover'
                                            unoptimized
                                        />
                                        <Button
                                            type='button'
                                            variant='destructive'
                                            size='icon'
                                            className='absolute top-0 right-0 h-5 w-5 translate-x-1/3 -translate-y-1/3 transform rounded-full bg-red-600 p-0.5 text-slate-900 hover:bg-red-700'
                                            onClick={() => handleRemoveImage(index)}
                                            aria-label={`Remove image ${index + 1}`}>
                                            <X className='h-3 w-3' />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className='space-y-3'>
                        <Label className='block text-slate-900'>{t('Mask')}</Label>
                        <Button
                            type='button'
                            variant='outline'
                            size='sm'
                            onClick={() => setEditShowMaskEditor(!editShowMaskEditor)}
                            disabled={isLoading || !editOriginalImageSize}
                            className='w-full justify-start border-slate-200 px-3 text-slate-700 hover:bg-slate-100 hover:text-slate-900'>
                            {editShowMaskEditor
                                ? t('Close Mask Editor')
                                : editGeneratedMaskFile
                                  ? t('Edit Saved Mask')
                                  : t('Create Mask')}
                            {editIsMaskSaved && !editShowMaskEditor && (
                                <span className='ml-auto text-xs text-emerald-600'>{t('(Saved)')}</span>
                            )}
                            <ScanEye className='mt-0.5' />
                        </Button>

                        {editShowMaskEditor && firstImagePreviewUrl && editOriginalImageSize && (
                            <div className='space-y-3 rounded-md border border-slate-200 bg-white p-3'>
                                <p className='text-xs text-slate-500'>
                                    {t(
                                        'Draw on the image below to mark areas for editing (drawn areas become transparent in the mask).'
                                    )}
                                </p>
                                <div
                                    className='relative mx-auto w-full overflow-hidden rounded border border-slate-200'
                                    style={{
                                        maxWidth: `min(100%, ${editOriginalImageSize.width}px)`,
                                        aspectRatio: `${editOriginalImageSize.width} / ${editOriginalImageSize.height}`
                                    }}>
                                    <Image
                                        src={firstImagePreviewUrl}
                                        alt={t('Image preview for masking')}
                                        width={editOriginalImageSize.width}
                                        height={editOriginalImageSize.height}
                                        className='block h-auto w-full'
                                        unoptimized
                                    />
                                    <canvas
                                        ref={canvasRef}
                                        width={editOriginalImageSize.width}
                                        height={editOriginalImageSize.height}
                                        className='absolute top-0 left-0 h-full w-full cursor-crosshair'
                                        onMouseDown={startDrawing}
                                        onMouseMove={drawLine}
                                        onMouseUp={stopDrawing}
                                        onMouseLeave={stopDrawing}
                                        onTouchStart={startDrawing}
                                        onTouchMove={drawLine}
                                        onTouchEnd={stopDrawing}
                                    />
                                </div>
                                <div className='grid grid-cols-1 gap-4 pt-2'>
                                    <div className='space-y-2'>
                                        <Label htmlFor='brush-size-slider' className='text-sm text-slate-900'>
                                            {t('Brush Size: {size}px', { size: editBrushSize[0] })}
                                        </Label>
                                        <Slider
                                            id='brush-size-slider'
                                            min={5}
                                            max={100}
                                            step={1}
                                            value={editBrushSize}
                                            onValueChange={setEditBrushSize}
                                            disabled={isLoading}
                                            className='mt-1 [&>button]:border-slate-300 [&>button]:bg-indigo-600 [&>button]:ring-offset-white [&>span:first-child]:h-1 [&>span:first-child>span]:bg-indigo-500'
                                        />
                                    </div>
                                </div>
                                <div className='flex items-center justify-between gap-2 pt-3'>
                                    <Button
                                        type='button'
                                        variant='outline'
                                        size='sm'
                                        onClick={() => maskInputRef.current?.click()}
                                        disabled={isLoading || !editOriginalImageSize}
                                        className='mr-auto border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900'>
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
                                            disabled={isLoading}
                                            className='border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900'>
                                            <Eraser className='mr-1.5 h-4 w-4' /> {t('Clear')}
                                        </Button>
                                        <Button
                                            type='button'
                                            variant='default'
                                            size='sm'
                                            onClick={generateAndSaveMask}
                                            disabled={isLoading || editDrawnPoints.length === 0}
                                            className='bg-indigo-600 text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50'>
                                            <Save className='mr-1.5 h-4 w-4' /> {t('Save Mask')}
                                        </Button>
                                    </div>
                                </div>
                                {editMaskPreviewUrl && (
                                    <div className='mt-3 border-t border-slate-200 pt-3 text-center'>
                                        <Label className='mb-1.5 block text-sm text-slate-900'>
                                            {t('Generated Mask Preview:')}
                                        </Label>
                                        <div className='inline-block rounded border border-slate-200 bg-white p-1'>
                                            <Image
                                                src={editMaskPreviewUrl}
                                                alt={t('Generated mask preview')}
                                                width={0}
                                                height={134}
                                                className='block max-w-full'
                                                style={{ width: 'auto', height: '134px' }}
                                                unoptimized
                                            />
                                        </div>
                                    </div>
                                )}
                                {editIsMaskSaved && !editMaskPreviewUrl && (
                                    <p className='pt-1 text-center text-xs text-amber-600'>
                                        {t('Generating mask preview...')}
                                    </p>
                                )}
                                {editIsMaskSaved && editMaskPreviewUrl && (
                                    <p className='pt-1 text-center text-xs text-emerald-600'>{t('Mask saved successfully!')}</p>
                                )}
                            </div>
                        )}
                        {!editShowMaskEditor && editGeneratedMaskFile && (
                            <p className='pt-1 text-xs text-emerald-600'>
                                {t('Mask applied: {filename}', { filename: editGeneratedMaskFile.name })}
                            </p>
                        )}
                    </div>

                    <div className='space-y-2'>
                        <Label htmlFor='edit-n-slider' className='text-slate-900'>
                            {t('Number of Images: {count}', { count: editN[0] })}
                        </Label>
                        <Slider
                            id='edit-n-slider'
                            min={1}
                            max={10}
                            step={1}
                            value={editN}
                            onValueChange={setEditN}
                            disabled={isLoading}
                            className='mt-3 [&>button]:border-slate-300 [&>button]:bg-indigo-600 [&>button]:ring-offset-white [&>span:first-child]:h-1 [&>span:first-child>span]:bg-indigo-500'
                        />
                    </div>

                    <ImageOptions
                        idPrefix='edit'
                        model={editModel}
                        disabled={isLoading}
                        size={editSize}
                        setSize={setEditSize}
                        customWidth={editCustomWidth}
                        setCustomWidth={setEditCustomWidth}
                        customHeight={editCustomHeight}
                        setCustomHeight={setEditCustomHeight}
                        sizeValidation={customSizeValidation}
                        quality={editQuality}
                        setQuality={setEditQuality}
                        background={editBackground}
                        setBackground={setEditBackground}
                        outputFormat={editOutputFormat}
                        setOutputFormat={setEditOutputFormat}
                        compression={editCompression}
                        setCompression={setEditCompression}
                        moderation={editModeration}
                        setModeration={setEditModeration}
                    />
                </CardContent>
                <CardFooter className='border-t border-slate-200 p-4'>
                    <Button
                        type='submit'
                        disabled={isLoading || !editPrompt || imageFiles.length === 0 || customSizeInvalid}
                        className='flex w-full items-center justify-center gap-2 rounded-md bg-indigo-600 text-white shadow-sm hover:bg-indigo-500 disabled:bg-slate-200 disabled:text-slate-400'>
                        {isLoading && <Loader2 className='h-4 w-4 animate-spin' />}
                        {isLoading ? t('Editing...') : t('Edit Image')}
                    </Button>
                </CardFooter>
            </form>
        </Card>
    );
}
