'use client';

import { ImageOptions } from '@/components/image-options';
import { ModeToggle } from '@/components/mode-toggle';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
    GPT_IMAGE_MODELS,
    type GptImageModel,
    type ImageBackground,
    type ImageModeration,
    type ImageOutputFormat,
    type ImageQuality
} from '@/lib/models';
import { useI18n } from '@/lib/i18n';
import { validateCustomSize, type SizePreset } from '@/lib/size-utils';
import { HelpCircle, Loader2, Lock, LockOpen } from 'lucide-react';
import * as React from 'react';

export type GenerationFormData = {
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
    model: GptImageModel;
};

type GenerationFormProps = {
    onSubmit: (data: GenerationFormData) => void;
    isLoading: boolean;
    currentMode: 'generate' | 'edit';
    onModeChange: (mode: 'generate' | 'edit') => void;
    isPasswordRequiredByBackend: boolean | null;
    clientPasswordHash: string | null;
    onOpenPasswordDialog: () => void;
    model: GenerationFormData['model'];
    setModel: React.Dispatch<React.SetStateAction<GenerationFormData['model']>>;
    prompt: string;
    setPrompt: React.Dispatch<React.SetStateAction<string>>;
    n: number[];
    setN: React.Dispatch<React.SetStateAction<number[]>>;
    size: GenerationFormData['size'];
    setSize: React.Dispatch<React.SetStateAction<GenerationFormData['size']>>;
    customWidth: number;
    setCustomWidth: React.Dispatch<React.SetStateAction<number>>;
    customHeight: number;
    setCustomHeight: React.Dispatch<React.SetStateAction<number>>;
    quality: GenerationFormData['quality'];
    setQuality: React.Dispatch<React.SetStateAction<GenerationFormData['quality']>>;
    outputFormat: GenerationFormData['output_format'];
    setOutputFormat: React.Dispatch<React.SetStateAction<GenerationFormData['output_format']>>;
    compression: number[];
    setCompression: React.Dispatch<React.SetStateAction<number[]>>;
    background: GenerationFormData['background'];
    setBackground: React.Dispatch<React.SetStateAction<GenerationFormData['background']>>;
    moderation: GenerationFormData['moderation'];
    setModeration: React.Dispatch<React.SetStateAction<GenerationFormData['moderation']>>;
    enableStreaming: boolean;
    setEnableStreaming: React.Dispatch<React.SetStateAction<boolean>>;
    partialImages: 1 | 2 | 3;
    setPartialImages: React.Dispatch<React.SetStateAction<1 | 2 | 3>>;
};

export function GenerationForm({
    onSubmit,
    isLoading,
    currentMode,
    onModeChange,
    isPasswordRequiredByBackend,
    clientPasswordHash,
    onOpenPasswordDialog,
    model,
    setModel,
    prompt,
    setPrompt,
    n,
    setN,
    size,
    setSize,
    customWidth,
    setCustomWidth,
    customHeight,
    setCustomHeight,
    quality,
    setQuality,
    outputFormat,
    setOutputFormat,
    compression,
    setCompression,
    background,
    setBackground,
    moderation,
    setModeration,
    enableStreaming,
    setEnableStreaming,
    partialImages,
    setPartialImages
}: GenerationFormProps) {
    const { t } = useI18n();
    const showCompression = outputFormat === 'jpeg' || outputFormat === 'webp';
    const customSizeValidation =
        size === 'custom' ? validateCustomSize(customWidth, customHeight, t) : { valid: true as const };
    const customSizeInvalid = !customSizeValidation.valid;

    // Disable streaming when n > 1 (OpenAI limitation)
    React.useEffect(() => {
        if (n[0] > 1 && enableStreaming) {
            setEnableStreaming(false);
        }
    }, [n, enableStreaming, setEnableStreaming]);

    const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (customSizeInvalid) {
            return;
        }
        const formData: GenerationFormData = {
            prompt,
            n: n[0],
            size,
            customWidth,
            customHeight,
            quality,
            output_format: outputFormat,
            background,
            moderation,
            model
        };
        if (showCompression) {
            formData.output_compression = compression[0];
        }
        onSubmit(formData);
    };

    return (
        <Card className='flex h-full w-full flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-20px_rgba(15,23,42,0.25)]'>
            <CardHeader className='flex items-start justify-between border-b border-slate-100 bg-white px-5 py-4'>
                <div>
                    <div className='flex items-center gap-2.5'>
                        <span className='h-2 w-2 shrink-0 rounded-full bg-indigo-500' aria-hidden='true' />
                        <CardTitle className='text-[17px] font-semibold tracking-tight text-slate-900'>
                            {t('Generate Image')}
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
                        {t('Create a new image from a text prompt.')}
                    </CardDescription>
                </div>
                <ModeToggle currentMode={currentMode} onModeChange={onModeChange} />
            </CardHeader>
            <form onSubmit={handleSubmit} className='flex h-full flex-1 flex-col overflow-hidden'>
                <CardContent className='flex-1 space-y-5 overflow-y-auto p-4'>
                    <div className='space-y-1.5'>
                        <Label htmlFor='model-select' className='text-slate-900'>
                            {t('Model')}
                        </Label>
                        <div className='flex items-center gap-4'>
                            <Select
                                value={model}
                                onValueChange={(value) => setModel(value as GptImageModel)}
                                disabled={isLoading}>
                                <SelectTrigger
                                    id='model-select'
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
                                            id='enable-streaming'
                                            checked={enableStreaming}
                                            onCheckedChange={(checked) => setEnableStreaming(!!checked)}
                                            disabled={isLoading || n[0] > 1}
                                            className='border-slate-300 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-indigo-600 data-[state=checked]:bg-indigo-600 data-[state=checked]:text-white'
                                        />
                                        <Label
                                            htmlFor='enable-streaming'
                                            className={`text-sm ${n[0] > 1 ? 'cursor-not-allowed text-slate-400' : 'cursor-pointer text-slate-700'}`}>
                                            {t('Enable Streaming')}
                                        </Label>
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent className='max-w-[250px]'>
                                    {n[0] > 1
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
                                        id='partial-1'
                                        className='border-slate-300 text-slate-500 data-[state=checked]:border-indigo-600 data-[state=checked]:text-indigo-600'
                                    />
                                    <Label htmlFor='partial-1' className='cursor-pointer text-slate-700'>
                                        1
                                    </Label>
                                </div>
                                <div className='flex items-center space-x-2'>
                                    <RadioGroupItem
                                        value='2'
                                        id='partial-2'
                                        className='border-slate-300 text-slate-500 data-[state=checked]:border-indigo-600 data-[state=checked]:text-indigo-600'
                                    />
                                    <Label htmlFor='partial-2' className='cursor-pointer text-slate-700'>
                                        2
                                    </Label>
                                </div>
                                <div className='flex items-center space-x-2'>
                                    <RadioGroupItem
                                        value='3'
                                        id='partial-3'
                                        className='border-slate-300 text-slate-500 data-[state=checked]:border-indigo-600 data-[state=checked]:text-indigo-600'
                                    />
                                    <Label htmlFor='partial-3' className='cursor-pointer text-slate-700'>
                                        3
                                    </Label>
                                </div>
                            </RadioGroup>
                        </div>
                    )}

                    <div className='space-y-1.5'>
                        <Label htmlFor='prompt' className='text-slate-900'>
                            {t('Prompt')}
                        </Label>
                        <Textarea
                            id='prompt'
                            placeholder={t('e.g., A photorealistic cat astronaut floating in space')}
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            required
                            disabled={isLoading}
                            className='min-h-[80px] rounded-md border border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:ring-indigo-100'
                        />
                    </div>

                    <div className='space-y-2'>
                        <Label htmlFor='n-slider' className='text-slate-900'>
                            {t('Number of Images: {count}', { count: n[0] })}
                        </Label>
                        <Slider
                            id='n-slider'
                            min={1}
                            max={10}
                            step={1}
                            value={n}
                            onValueChange={setN}
                            disabled={isLoading}
                            className='mt-3 [&>button]:border-slate-300 [&>button]:bg-indigo-600 [&>button]:ring-offset-white [&>span:first-child]:h-1 [&>span:first-child>span]:bg-indigo-500'
                        />
                    </div>

                    <ImageOptions
                        idPrefix='gen'
                        model={model}
                        disabled={isLoading}
                        size={size}
                        setSize={setSize}
                        customWidth={customWidth}
                        setCustomWidth={setCustomWidth}
                        customHeight={customHeight}
                        setCustomHeight={setCustomHeight}
                        sizeValidation={customSizeValidation}
                        quality={quality}
                        setQuality={setQuality}
                        background={background}
                        setBackground={setBackground}
                        outputFormat={outputFormat}
                        setOutputFormat={setOutputFormat}
                        compression={compression}
                        setCompression={setCompression}
                        moderation={moderation}
                        setModeration={setModeration}
                    />
                </CardContent>
                <CardFooter className='border-t border-slate-200 p-4'>
                    <Button
                        type='submit'
                        disabled={isLoading || !prompt || customSizeInvalid}
                        className='flex w-full items-center justify-center gap-2 rounded-md bg-indigo-600 text-white shadow-sm hover:bg-indigo-500 disabled:bg-slate-200 disabled:text-slate-400'>
                        {isLoading && <Loader2 className='h-4 w-4 animate-spin' />}
                        {isLoading ? t('Generating...') : t('Generate')}
                    </Button>
                </CardFooter>
            </form>
        </Card>
    );
}
