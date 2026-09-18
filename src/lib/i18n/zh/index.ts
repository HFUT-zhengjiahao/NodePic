import { canvas } from '@/lib/i18n/zh/canvas';
import { common } from '@/lib/i18n/zh/common';
import { dialogs } from '@/lib/i18n/zh/dialogs';
import { editingForm } from '@/lib/i18n/zh/editing-form';
import { generationForm } from '@/lib/i18n/zh/generation-form';
import { historyPanel } from '@/lib/i18n/zh/history-panel';
import { imageOptions } from '@/lib/i18n/zh/image-options';
import { imageOutput } from '@/lib/i18n/zh/image-output';
import { page } from '@/lib/i18n/zh/page';

/**
 * Simplified-Chinese dictionary. Keys are the English source strings used in the components,
 * values are the translations. Missing keys fall back to the English text at runtime.
 */
export const zh: Record<string, string> = {
    ...common,
    ...dialogs,
    ...canvas,
    ...page,
    ...generationForm,
    ...imageOptions,
    ...editingForm,
    ...historyPanel,
    ...imageOutput
};
