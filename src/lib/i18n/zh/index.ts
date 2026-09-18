import { canvas } from '@/lib/i18n/zh/canvas';
import { common } from '@/lib/i18n/zh/common';

/**
 * Simplified-Chinese dictionary. Keys are the English source strings used in the components,
 * values are the translations. Missing keys fall back to the English text at runtime.
 */
export const zh: Record<string, string> = {
    ...common,
    ...canvas
};
