import type { ApiUsage, CostDetails } from '@/lib/cost-utils';
import type { GptImageModel, ImageBackground, ImageModeration, ImageOutputFormat, ImageQuality } from '@/lib/models';
import type { SizePreset } from '@/lib/size-utils';

/** A finished image belonging to a node, as served by /api/image/<filename>. */
export type CanvasTaskImage = {
    filename: string;
    path: string;
};

export type CanvasTaskParams = {
    model: GptImageModel;
    n: number;
    size: SizePreset;
    customWidth: number;
    customHeight: number;
    quality: ImageQuality;
    background: ImageBackground;
    outputFormat: ImageOutputFormat;
    compression: number;
    moderation: ImageModeration;
};

export type CanvasTaskStatus = 'idle' | 'running' | 'error';

/** Everything a canvas node knows. Kept JSON-serialisable so it can be persisted. */
export type CanvasTaskData = {
    kind: 'generate' | 'edit';
    prompt: string;
    params: CanvasTaskParams;
    /** Source images for edit nodes (filenames the server can serve back). */
    sourceFilenames: string[];
    /** Display-only: name of the mask that was applied when the node last ran. */
    maskFileName: string | null;
    images: CanvasTaskImage[];
    status: CanvasTaskStatus;
    error: string | null;
    durationMs: number | null;
    usage: ApiUsage | null;
    costDetails: CostDetails | null;
    createdAt: number;
};

export const DEFAULT_TASK_PARAMS: CanvasTaskParams = {
    model: 'gpt-image-2.5-flare',
    n: 1,
    size: 'square',
    customWidth: 1024,
    customHeight: 1024,
    quality: 'medium',
    background: 'auto',
    outputFormat: 'png',
    compression: 80,
    moderation: 'auto'
};

export function createTaskData(kind: 'generate' | 'edit', overrides: Partial<CanvasTaskData> = {}): CanvasTaskData {
    return {
        kind,
        prompt: '',
        params: { ...DEFAULT_TASK_PARAMS },
        sourceFilenames: [],
        maskFileName: null,
        images: [],
        status: 'idle',
        error: null,
        durationMs: null,
        usage: null,
        costDetails: null,
        createdAt: Date.now(),
        ...overrides
    };
}
