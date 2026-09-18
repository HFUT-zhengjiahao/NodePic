import type { CanvasTaskParams, CanvasTaskImage } from '@/lib/canvas-types';
import type { ApiUsage } from '@/lib/cost-utils';
import { getPresetDimensions } from '@/lib/size-utils';

export type RunCanvasTaskInput = {
    kind: 'generate' | 'edit';
    prompt: string;
    params: CanvasTaskParams;
    /** Filenames of the source images (edit mode) — fetched back from /api/image/<filename>. */
    sourceFilenames?: string[];
    maskFile?: File | null;
    passwordHash?: string | null;
};

export type RunCanvasTaskResult = {
    images: CanvasTaskImage[];
    usage: ApiUsage | null;
};

function buildSize(params: CanvasTaskParams): string {
    if (params.size === 'custom') {
        return `${params.customWidth}x${params.customHeight}`;
    }
    return getPresetDimensions(params.size) ?? 'auto';
}

async function fetchAsFile(filename: string): Promise<File> {
    const response = await fetch(`/api/image/${encodeURIComponent(filename)}`);
    if (!response.ok) {
        throw new Error(`Failed to load source image ${filename} (HTTP ${response.status}).`);
    }
    const blob = await response.blob();
    return new File([blob], filename, { type: blob.type || 'image/png' });
}

/**
 * Sends one generation/editing request to the existing /api/images endpoint.
 * Shared by the canvas nodes; the classic form keeps its own streaming-aware path.
 */
export async function runCanvasTask(input: RunCanvasTaskInput): Promise<RunCanvasTaskResult> {
    const { kind, prompt, params, sourceFilenames = [], maskFile, passwordHash } = input;

    const formData = new FormData();
    if (passwordHash) {
        formData.append('passwordHash', passwordHash);
    }
    formData.append('mode', kind);
    formData.append('model', params.model);
    formData.append('prompt', prompt);
    formData.append('n', String(params.n));
    formData.append('size', buildSize(params));
    formData.append('quality', params.quality);
    formData.append('output_format', params.outputFormat);
    formData.append('background', params.background);
    formData.append('moderation', params.moderation);
    if (
        (params.outputFormat === 'jpeg' || params.outputFormat === 'webp') &&
        Number.isFinite(params.compression)
    ) {
        formData.append('output_compression', String(params.compression));
    }

    if (kind === 'edit') {
        const files = await Promise.all(sourceFilenames.map(fetchAsFile));
        files.forEach((file, index) => formData.append(`image_${index}`, file, file.name));
        if (maskFile) {
            formData.append('mask', maskFile, maskFile.name);
        }
    }

    const response = await fetch('/api/images', { method: 'POST', body: formData });
    const result = await response.json().catch(() => null);

    if (!response.ok) {
        throw new Error(result?.error || `API request failed with status ${response.status}`);
    }
    if (!result?.images?.length) {
        throw new Error('API response did not contain valid image data.');
    }

    return {
        images: result.images.map((image: { filename: string }) => ({
            filename: image.filename,
            path: `/api/image/${image.filename}`
        })),
        usage: result.usage ?? null
    };
}
