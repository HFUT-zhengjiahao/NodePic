import type { TranslateVars } from '@/lib/i18n/config';

/** Function shape of `t()` from the i18n provider (passed in so this module stays framework-free). */
export type TranslateFn = (text: string, vars?: TranslateVars) => string;

export type SizeValidation = { valid: true } | { valid: false; reason: string };

export const CUSTOM_SIZE_MIN_PIXELS = 655_360;
export const CUSTOM_SIZE_MAX_PIXELS = 8_294_400;
export const CUSTOM_SIZE_MAX_EDGE = 3840;
export const CUSTOM_SIZE_EDGE_MULTIPLE = 16;
export const CUSTOM_SIZE_MAX_ASPECT = 3;

export function validateCustomSize(width: number, height: number, t: TranslateFn): SizeValidation {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return { valid: false, reason: t('Width and height must be positive numbers.') };
    }
    if (!Number.isInteger(width) || !Number.isInteger(height)) {
        return { valid: false, reason: t('Width and height must be whole numbers.') };
    }
    if (width % CUSTOM_SIZE_EDGE_MULTIPLE !== 0 || height % CUSTOM_SIZE_EDGE_MULTIPLE !== 0) {
        return {
            valid: false,
            reason: t('Both edges must be multiples of {multiple}.', { multiple: CUSTOM_SIZE_EDGE_MULTIPLE })
        };
    }
    if (width > CUSTOM_SIZE_MAX_EDGE || height > CUSTOM_SIZE_MAX_EDGE) {
        return { valid: false, reason: t('Maximum edge is {edge}px.', { edge: CUSTOM_SIZE_MAX_EDGE }) };
    }
    const long = Math.max(width, height);
    const short = Math.min(width, height);
    if (long / short > CUSTOM_SIZE_MAX_ASPECT) {
        return {
            valid: false,
            reason: t('Aspect ratio (long:short) must be ≤ {aspect}:1.', { aspect: CUSTOM_SIZE_MAX_ASPECT })
        };
    }
    const pixels = width * height;
    if (pixels < CUSTOM_SIZE_MIN_PIXELS) {
        return {
            valid: false,
            reason: t('Total pixels must be at least {min}.', { min: CUSTOM_SIZE_MIN_PIXELS.toLocaleString() })
        };
    }
    if (pixels > CUSTOM_SIZE_MAX_PIXELS) {
        return {
            valid: false,
            reason: t('Total pixels must be no more than {max}.', { max: CUSTOM_SIZE_MAX_PIXELS.toLocaleString() })
        };
    }
    return { valid: true };
}

export type SizePreset = 'auto' | 'custom' | 'square' | 'landscape' | 'portrait';

const PRESET_DIMENSIONS: Record<Exclude<SizePreset, 'auto' | 'custom'>, string> = {
    square: '2048x2048',
    landscape: '3072x2048',
    portrait: '2048x3072'
};

/**
 * Returns the concrete WxH string for a preset.
 * Returns null for 'auto' (let the API pick) and 'custom' (caller provides WxH).
 */
export function getPresetDimensions(preset: SizePreset): string | null {
    if (preset === 'auto' || preset === 'custom') return null;
    return PRESET_DIMENSIONS[preset];
}

/**
 * Human-readable dimension info for tooltips.
 */
export function getPresetTooltip(preset: SizePreset): string | null {
    const dims = getPresetDimensions(preset);
    if (!dims) return null;
    const [w, h] = dims.split('x').map(Number);
    const mp = ((w * h) / 1_000_000).toFixed(1);
    const ratio = preset === 'square' ? '1:1' : preset === 'landscape' ? '3:2' : '2:3';
    return `${w} × ${h} · ${ratio} · ${mp} MP`;
}
