import type { GptImageModel, HistoryGptImageModel } from '@/lib/models';

export type ApiUsage = {
    input_tokens_details?: {
        text_tokens?: number;
        image_tokens?: number;
    };
    output_tokens?: number;
};

export type CostDetails = {
    estimated_cost_usd: number;
    text_input_tokens: number;
    image_input_tokens: number;
    image_output_tokens: number;
};

/** USD per 1M tokens. */
export type ModelRates = {
    textInputPerMillion: number;
    imageInputPerMillion: number;
    imageOutputPerMillion: number;
};

const CURRENT_MODEL_RATES: ModelRates = { textInputPerMillion: 5, imageInputPerMillion: 8, imageOutputPerMillion: 30 };

// Retired models keep their rows so stored history entries still show the cost breakdown they were billed at.
const MODEL_RATES: Record<HistoryGptImageModel, ModelRates> = {
    'gpt-image-2.5-flare': CURRENT_MODEL_RATES,
    'gpt-image-2.5-sunburst': CURRENT_MODEL_RATES,
    'gpt-image-2': CURRENT_MODEL_RATES,
    'gpt-image-1.5': { textInputPerMillion: 5, imageInputPerMillion: 8, imageOutputPerMillion: 32 },
    'gpt-image-1': { textInputPerMillion: 5, imageInputPerMillion: 10, imageOutputPerMillion: 40 },
    'gpt-image-1-mini': { textInputPerMillion: 2, imageInputPerMillion: 2.5, imageOutputPerMillion: 8 }
};

export function getModelRates(model: HistoryGptImageModel): ModelRates {
    return MODEL_RATES[model];
}

export function tokensToUsd(tokens: number, perMillion: number): number {
    return (tokens * perMillion) / 1_000_000;
}

/**
 * Estimates the cost of a GPT image model API call based on token usage.
 * @param usage - The usage object from the OpenAI API response.
 * @param model - The model used.
 * @returns CostDetails object or null if usage data is invalid.
 */
export function calculateApiCost(usage: ApiUsage | undefined | null, model: GptImageModel): CostDetails | null {
    if (!usage || !usage.input_tokens_details || usage.output_tokens === undefined || usage.output_tokens === null) {
        console.warn('Invalid or missing usage data for cost calculation:', usage);
        return null;
    }

    const textInT = usage.input_tokens_details.text_tokens ?? 0;
    const imgInT = usage.input_tokens_details.image_tokens ?? 0;
    const imgOutT = usage.output_tokens ?? 0;

    // Basic validation for token types
    if (typeof textInT !== 'number' || typeof imgInT !== 'number' || typeof imgOutT !== 'number') {
        console.error('Invalid token types in usage data:', usage);
        return null;
    }

    const rates = getModelRates(model);
    const costUSD =
        tokensToUsd(textInT, rates.textInputPerMillion) +
        tokensToUsd(imgInT, rates.imageInputPerMillion) +
        tokensToUsd(imgOutT, rates.imageOutputPerMillion);

    // Round to 4 decimal places
    const costRounded = Math.round(costUSD * 10000) / 10000;

    return {
        estimated_cost_usd: costRounded,
        text_input_tokens: textInT,
        image_input_tokens: imgInT,
        image_output_tokens: imgOutT
    };
}
