'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
    EXTENDED_QUALITIES,
    supportsExtendedQuality,
    type GptImageModel,
    type ImageBackground,
    type ImageModeration,
    type ImageOutputFormat,
    type ImageQuality
} from '@/lib/models';
import {
    CUSTOM_SIZE_EDGE_MULTIPLE,
    CUSTOM_SIZE_MAX_ASPECT,
    CUSTOM_SIZE_MAX_EDGE,
    CUSTOM_SIZE_MAX_PIXELS,
    CUSTOM_SIZE_MIN_PIXELS,
    getPresetTooltip,
    type SizePreset,
    type SizeValidation
} from '@/lib/size-utils';
import {
    BrickWall,
    Eraser,
    FileImage,
    RectangleHorizontal,
    RectangleVertical,
    ShieldAlert,
    ShieldCheck,
    Sparkles,
    Square,
    SquareDashed,
    Tally1,
    Tally2,
    Tally3,
    Tally4,
    Tally5
} from 'lucide-react';
import * as React from 'react';

type ImageOptionsProps = {
    /** Prefix for every element id, so the generate and edit forms (both mounted) never share an id. */
    idPrefix: string;
    model: GptImageModel;
    disabled: boolean;
    size: SizePreset;
    setSize: React.Dispatch<React.SetStateAction<SizePreset>>;
    customWidth: number;
    setCustomWidth: React.Dispatch<React.SetStateAction<number>>;
    customHeight: number;
    setCustomHeight: React.Dispatch<React.SetStateAction<number>>;
    sizeValidation: SizeValidation;
    quality: ImageQuality;
    setQuality: React.Dispatch<React.SetStateAction<ImageQuality>>;
    background: ImageBackground;
    setBackground: React.Dispatch<React.SetStateAction<ImageBackground>>;
    outputFormat: ImageOutputFormat;
    setOutputFormat: React.Dispatch<React.SetStateAction<ImageOutputFormat>>;
    compression: number[];
    setCompression: React.Dispatch<React.SetStateAction<number[]>>;
    moderation: ImageModeration;
    setModeration: React.Dispatch<React.SetStateAction<ImageModeration>>;
};

const RadioItemWithIcon = ({
    value,
    id,
    label,
    Icon
}: {
    value: string;
    id: string;
    label: string;
    Icon: React.ElementType;
}) => (
    <div className='flex items-center space-x-2'>
        <RadioGroupItem
            value={value}
            id={id}
            className='border-white/40 text-white data-[state=checked]:border-white data-[state=checked]:text-white'
        />
        <Label htmlFor={id} className='flex cursor-pointer items-center gap-2 text-base text-white/80'>
            <Icon className='h-5 w-5 text-white/60' />
            {label}
        </Label>
    </div>
);

const SIZE_PRESETS: { value: SizePreset; label: string; Icon: React.ElementType }[] = [
    { value: 'square', label: 'Square', Icon: Square },
    { value: 'landscape', label: 'Landscape', Icon: RectangleHorizontal },
    { value: 'portrait', label: 'Portrait', Icon: RectangleVertical }
];

export function ImageOptions({
    idPrefix,
    model,
    disabled,
    size,
    setSize,
    customWidth,
    setCustomWidth,
    customHeight,
    setCustomHeight,
    sizeValidation,
    quality,
    setQuality,
    background,
    setBackground,
    outputFormat,
    setOutputFormat,
    compression,
    setCompression,
    moderation,
    setModeration
}: ImageOptionsProps) {
    const id = (suffix: string) => `${idPrefix}-${suffix}`;
    const showExtendedQuality = supportsExtendedQuality(model);
    const showCompression = outputFormat === 'jpeg' || outputFormat === 'webp';

    // xhigh/max only exist on gpt-image-2.5; reset when switching to a model that rejects them
    React.useEffect(() => {
        if (!showExtendedQuality && EXTENDED_QUALITIES.includes(quality)) {
            setQuality('auto');
        }
    }, [showExtendedQuality, quality, setQuality]);

    return (
        <>
            <div className='space-y-3'>
                <Label className='block text-white'>Size</Label>
                <RadioGroup
                    value={size}
                    onValueChange={(value) => setSize(value as SizePreset)}
                    disabled={disabled}
                    className='flex flex-wrap gap-x-5 gap-y-3'>
                    <RadioItemWithIcon value='auto' id={id('size-auto')} label='Auto' Icon={Sparkles} />
                    <RadioItemWithIcon value='custom' id={id('size-custom')} label='Custom' Icon={SquareDashed} />
                    {SIZE_PRESETS.map(({ value, label, Icon }) => (
                        <Tooltip key={value}>
                            <TooltipTrigger asChild>
                                <div>
                                    <RadioItemWithIcon
                                        value={value}
                                        id={id(`size-${value}`)}
                                        label={label}
                                        Icon={Icon}
                                    />
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>{getPresetTooltip(value)}</TooltipContent>
                        </Tooltip>
                    ))}
                </RadioGroup>
                {size === 'custom' && (
                    <div className='space-y-2 rounded-md border border-white/10 bg-white/5 p-3'>
                        <div className='flex items-center gap-3'>
                            <div className='flex-1 space-y-1'>
                                <Label htmlFor={id('custom-width')} className='text-xs text-white/70'>
                                    Width (px)
                                </Label>
                                <Input
                                    id={id('custom-width')}
                                    type='number'
                                    min={CUSTOM_SIZE_EDGE_MULTIPLE}
                                    max={CUSTOM_SIZE_MAX_EDGE}
                                    step={CUSTOM_SIZE_EDGE_MULTIPLE}
                                    value={customWidth}
                                    onChange={(e) => setCustomWidth(parseInt(e.target.value, 10) || 0)}
                                    disabled={disabled}
                                    className='rounded-md border border-white/20 bg-black text-white focus:border-white/50 focus:ring-white/50'
                                />
                            </div>
                            <span className='pt-5 text-white/60'>×</span>
                            <div className='flex-1 space-y-1'>
                                <Label htmlFor={id('custom-height')} className='text-xs text-white/70'>
                                    Height (px)
                                </Label>
                                <Input
                                    id={id('custom-height')}
                                    type='number'
                                    min={CUSTOM_SIZE_EDGE_MULTIPLE}
                                    max={CUSTOM_SIZE_MAX_EDGE}
                                    step={CUSTOM_SIZE_EDGE_MULTIPLE}
                                    value={customHeight}
                                    onChange={(e) => setCustomHeight(parseInt(e.target.value, 10) || 0)}
                                    disabled={disabled}
                                    className='rounded-md border border-white/20 bg-black text-white focus:border-white/50 focus:ring-white/50'
                                />
                            </div>
                        </div>
                        <p className='text-xs text-white/50'>
                            {(customWidth * customHeight).toLocaleString()} pixels (
                            {(((customWidth * customHeight) / CUSTOM_SIZE_MAX_PIXELS) * 100).toFixed(1)}% of max) ·{' '}
                            {customWidth > 0 && customHeight > 0
                                ? `${(Math.max(customWidth, customHeight) / Math.min(customWidth, customHeight)).toFixed(2)}:1 ratio`
                                : '—'}
                        </p>
                        {!sizeValidation.valid && <p className='text-xs text-red-400'>{sizeValidation.reason}</p>}
                        <p className='text-xs text-white/40'>
                            Constraints: multiples of {CUSTOM_SIZE_EDGE_MULTIPLE}, max edge {CUSTOM_SIZE_MAX_EDGE}px,
                            aspect ratio ≤ {CUSTOM_SIZE_MAX_ASPECT}:1, {CUSTOM_SIZE_MIN_PIXELS.toLocaleString()} to{' '}
                            {CUSTOM_SIZE_MAX_PIXELS.toLocaleString()} total pixels.
                        </p>
                    </div>
                )}
            </div>

            <div className='space-y-3'>
                <Label className='block text-white'>Quality</Label>
                <RadioGroup
                    value={quality}
                    onValueChange={(value) => setQuality(value as ImageQuality)}
                    disabled={disabled}
                    className='flex flex-wrap gap-x-5 gap-y-3'>
                    <RadioItemWithIcon value='auto' id={id('quality-auto')} label='Auto' Icon={Sparkles} />
                    <RadioItemWithIcon value='low' id={id('quality-low')} label='Low' Icon={Tally1} />
                    <RadioItemWithIcon value='medium' id={id('quality-medium')} label='Medium' Icon={Tally2} />
                    <RadioItemWithIcon value='high' id={id('quality-high')} label='High' Icon={Tally3} />
                    {showExtendedQuality && (
                        <>
                            <RadioItemWithIcon value='xhigh' id={id('quality-xhigh')} label='XHigh' Icon={Tally4} />
                            <RadioItemWithIcon value='max' id={id('quality-max')} label='Max' Icon={Tally5} />
                        </>
                    )}
                </RadioGroup>
            </div>

            <div className='space-y-3'>
                <Label className='block text-white'>Background</Label>
                <RadioGroup
                    value={background}
                    onValueChange={(value) => setBackground(value as ImageBackground)}
                    disabled={disabled}
                    className='flex flex-wrap gap-x-5 gap-y-3'>
                    <RadioItemWithIcon value='auto' id={id('bg-auto')} label='Auto' Icon={Sparkles} />
                    <RadioItemWithIcon value='opaque' id={id('bg-opaque')} label='Opaque' Icon={BrickWall} />
                    <RadioItemWithIcon
                        value='transparent'
                        id={id('bg-transparent')}
                        label='Transparent'
                        Icon={Eraser}
                    />
                </RadioGroup>
            </div>

            <div className='space-y-3'>
                <Label className='block text-white'>Output Format</Label>
                <RadioGroup
                    value={outputFormat}
                    onValueChange={(value) => setOutputFormat(value as ImageOutputFormat)}
                    disabled={disabled}
                    className='flex flex-wrap gap-x-5 gap-y-3'>
                    <RadioItemWithIcon value='png' id={id('format-png')} label='PNG' Icon={FileImage} />
                    <RadioItemWithIcon value='jpeg' id={id('format-jpeg')} label='JPEG' Icon={FileImage} />
                    <RadioItemWithIcon value='webp' id={id('format-webp')} label='WebP' Icon={FileImage} />
                </RadioGroup>
            </div>

            {showCompression && (
                <div className='space-y-2 pt-2 transition-opacity duration-300'>
                    <Label htmlFor={id('compression-slider')} className='text-white'>
                        Compression: {compression[0]}%
                    </Label>
                    <Slider
                        id={id('compression-slider')}
                        min={0}
                        max={100}
                        step={1}
                        value={compression}
                        onValueChange={setCompression}
                        disabled={disabled}
                        className='mt-3 [&>button]:border-black [&>button]:bg-white [&>button]:ring-offset-black [&>span:first-child]:h-1 [&>span:first-child>span]:bg-white'
                    />
                </div>
            )}

            <div className='space-y-3'>
                <Label className='block text-white'>Moderation Level</Label>
                <RadioGroup
                    value={moderation}
                    onValueChange={(value) => setModeration(value as ImageModeration)}
                    disabled={disabled}
                    className='flex flex-wrap gap-x-5 gap-y-3'>
                    <RadioItemWithIcon value='auto' id={id('mod-auto')} label='Auto' Icon={ShieldCheck} />
                    <RadioItemWithIcon value='low' id={id('mod-low')} label='Low' Icon={ShieldAlert} />
                </RadioGroup>
            </div>
        </>
    );
}
