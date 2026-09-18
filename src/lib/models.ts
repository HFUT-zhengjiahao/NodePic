/** Models that can be selected for new generations and edits, in display order. */
export const GPT_IMAGE_MODELS = ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'gpt-image-2'] as const;
export type GptImageModel = (typeof GPT_IMAGE_MODELS)[number];
export const DEFAULT_GPT_IMAGE_MODEL: GptImageModel = 'gpt-image-2.5-flare';

/** Selectable models plus retired ones that may still appear in stored history. */
export type HistoryGptImageModel = GptImageModel | 'gpt-image-1' | 'gpt-image-1-mini' | 'gpt-image-1.5';

export function isGptImageModel(value: unknown): value is GptImageModel {
    return (GPT_IMAGE_MODELS as readonly unknown[]).includes(value);
}

export type ImageQuality = 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
/** Quality tiers that only the gpt-image-2.5 models accept; gpt-image-2 rejects them with HTTP 400. */
export const EXTENDED_QUALITIES: readonly ImageQuality[] = ['xhigh', 'max'];
/**
 * Local tweak: this instance talks to PackyAPI (https://cf.api.fan), whose validation only accepts
 * low/medium/high/auto and rejects xhigh/max with HTTP 400 for every gpt-image model.
 * Restore the upstream `model !== 'gpt-image-2'` behaviour if you ever point this at OpenAI directly.
 */
export function supportsExtendedQuality(model: GptImageModel): boolean {
    void model;
    return false;
}

export type ImageBackground = 'auto' | 'opaque' | 'transparent';
export const IMAGE_OUTPUT_FORMATS = ['png', 'jpeg', 'webp'] as const;
export type ImageOutputFormat = (typeof IMAGE_OUTPUT_FORMATS)[number];
export type ImageModeration = 'auto' | 'low';

/** Maximum source images per edit request for GPT Image models. */
export const MAX_EDIT_IMAGES = 16;
