import type { ApiUsage, CostDetails } from '@/lib/cost-utils';
import {
    DEFAULT_GPT_IMAGE_MODEL,
    type GptImageModel,
    type ImageBackground,
    type ImageModeration,
    type ImageOutputFormat,
    type ImageQuality
} from '@/lib/models';
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

export type CanvasTaskStatus = 'idle' | 'queued' | 'running' | 'error';

/** Everything a canvas node knows. Kept JSON-serialisable so it can be persisted. */
export type CanvasTaskKind = 'generate' | 'edit' | 'image';

export type CanvasTaskData = {
    /** `image` nodes simply hold a picture the user picked from their machine. */
    kind: CanvasTaskKind;
    prompt: string;
    params: CanvasTaskParams;
    /** Source images for edit nodes (filenames the server can serve back). */
    sourceFilenames: string[];
    /** Display-only: name of the mask that was applied when the node last ran. */
    maskFileName: string | null;
    /** Set when a referenced source image is gone from disk (e.g. deleted from the history). */
    sourceMissing?: boolean;
    /** Set when every image this node produced is gone from disk. */
    resultMissing?: boolean;
    images: CanvasTaskImage[];
    /** Which of `images` the node is showing — also what "derive" and "connect" act on. */
    viewIndex?: number;
    status: CanvasTaskStatus;
    error: string | null;
    durationMs: number | null;
    usage: ApiUsage | null;
    costDetails: CostDetails | null;
    createdAt: number;
};

/**
 * How many source pictures one canvas edit node may collect.
 *
 * The model accepts up to 16 source images (OpenAI images.edit documentation), and PackyAPI was
 * measured forwarding 4 of them without complaint, so 16 is the default. Override it when a
 * particular endpoint validates more strictly than the model does:
 *
 *   NEXT_PUBLIC_MAX_EDIT_SOURCES=1
 */
function readMaxEditSources(): number {
    const raw = Number(process.env.NEXT_PUBLIC_MAX_EDIT_SOURCES);
    if (!Number.isFinite(raw) || raw < 1) return 16;
    return Math.min(Math.floor(raw), 16);
}

export const MAX_EDIT_SOURCES = readMaxEditSources();

export const DEFAULT_TASK_PARAMS: CanvasTaskParams = {
    model: DEFAULT_GPT_IMAGE_MODEL,
    n: 1,
    // Matches the list view's default: let the model pick, instead of forcing a 2048x2048 render.
    size: 'auto',
    customWidth: 1024,
    customHeight: 1024,
    quality: 'high',
    background: 'auto',
    outputFormat: 'png',
    compression: 80,
    moderation: 'auto'
};

export function createTaskData(kind: CanvasTaskKind, overrides: Partial<CanvasTaskData> = {}): CanvasTaskData {
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
