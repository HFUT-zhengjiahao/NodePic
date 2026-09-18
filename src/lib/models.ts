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

/** The four quality tiers every GPT Image model accepts. */
export const BASE_QUALITIES: readonly ImageQuality[] = ['auto', 'low', 'medium', 'high'];
/** Tiers only some models accept; gpt-image-2 rejects them with HTTP 400. */
export const EXTENDED_QUALITIES: readonly ImageQuality[] = ['xhigh', 'max'];

/**
 * Accepted quality tiers per model.
 *
 * This deployment talks to PackyAPI (https://cf.api.fan), whose validation accepts only
 * low/medium/high/auto for every gpt-image model — no model advertises the extended tiers here.
 * Pointing this at OpenAI directly means adding 'xhigh'/'max' to the gpt-image-2.5 entries.
 */
const MODEL_QUALITY_TIERS: Record<GptImageModel, readonly ImageQuality[]> = {
    'gpt-image-2.5-flare': BASE_QUALITIES,
    'gpt-image-2.5-sunburst': BASE_QUALITIES,
    'gpt-image-2': BASE_QUALITIES
};

/** Quality tiers the given model accepts, in display order. */
export function qualityOptionsFor(model: GptImageModel): readonly ImageQuality[] {
    return MODEL_QUALITY_TIERS[model] ?? BASE_QUALITIES;
}

export function supportsExtendedQuality(model: GptImageModel): boolean {
    return qualityOptionsFor(model).some((tier) => EXTENDED_QUALITIES.includes(tier));
}

export type ImageBackground = 'auto' | 'opaque' | 'transparent';
export const IMAGE_OUTPUT_FORMATS = ['png', 'jpeg', 'webp'] as const;
export type ImageOutputFormat = (typeof IMAGE_OUTPUT_FORMATS)[number];
export type ImageModeration = 'auto' | 'low';

/** Maximum source images per edit request for GPT Image models. */
export const MAX_EDIT_IMAGES = 16;
