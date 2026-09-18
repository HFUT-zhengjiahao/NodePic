'use client';

import { EditingForm, type EditingFormData } from '@/components/editing-form';
import { CanvasBoard } from '@/components/canvas/canvas-board';
import { collectCanvasFilenames, countCanvasReferences, findCanvasReferences, readStoredCanvas } from '@/lib/canvas-refs';
import { GenerationForm, type GenerationFormData } from '@/components/generation-form';
import { HistoryPanel } from '@/components/history-panel';
import { ImageOutput } from '@/components/image-output';
import { LanguageToggle } from '@/components/language-toggle';
import { PasswordDialog } from '@/components/password-dialog';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog';
import { ShutdownButton } from '@/components/shutdown-button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { calculateApiCost, type ApiUsage, type CostDetails } from '@/lib/cost-utils';
import { db, type ImageRecord } from '@/lib/db';
import { useI18n } from '@/lib/i18n';
import {
    DEFAULT_GPT_IMAGE_MODEL,
    MAX_EDIT_IMAGES,
    type HistoryGptImageModel,
    type ImageBackground,
    type ImageModeration,
    type ImageOutputFormat,
    type ImageQuality
} from '@/lib/models';
import { getPresetDimensions } from '@/lib/size-utils';
import { useLiveQuery } from 'dexie-react-hooks';
import { List, Workflow } from 'lucide-react';
import * as React from 'react';

type HistoryImage = {
    filename: string;
};

export type HistoryMetadata = {
    timestamp: number;
    images: HistoryImage[];
    storageModeUsed?: 'fs' | 'indexeddb';
    durationMs: number;
    quality: ImageQuality;
    background: ImageBackground;
    moderation: ImageModeration;
    prompt: string;
    mode: 'generate' | 'edit';
    costDetails: CostDetails | null;
    output_format?: ImageOutputFormat;
    /** Absent on entries written before the field existed; those were all produced by gpt-image-1. */
    model?: HistoryGptImageModel;
};

type DrawnPoint = {
    x: number;
    y: number;
    size: number;
};

const explicitModeClient = process.env.NEXT_PUBLIC_IMAGE_STORAGE_MODE;

const vercelEnvClient = process.env.NEXT_PUBLIC_VERCEL_ENV;
const isOnVercelClient = vercelEnvClient === 'production' || vercelEnvClient === 'preview';

let effectiveStorageModeClient: 'fs' | 'indexeddb';

if (explicitModeClient === 'fs') {
    effectiveStorageModeClient = 'fs';
} else if (explicitModeClient === 'indexeddb') {
    effectiveStorageModeClient = 'indexeddb';
} else if (isOnVercelClient) {
    effectiveStorageModeClient = 'indexeddb';
} else {
    effectiveStorageModeClient = 'fs';
}
console.log(
    `Client Effective Storage Mode: ${effectiveStorageModeClient} (Explicit: ${explicitModeClient || 'unset'}, Vercel Env: ${vercelEnvClient || 'N/A'})`
);

type ApiImageResponseItem = {
    filename: string;
    b64_json?: string;
    output_format: string;
    path?: string;
};

export default function HomePage() {
    const { t } = useI18n();
    const [mode, setMode] = React.useState<'generate' | 'edit'>('generate');
    const [isPasswordRequiredByBackend, setIsPasswordRequiredByBackend] = React.useState<boolean | null>(null);
    const [clientPasswordHash, setClientPasswordHash] = React.useState<string | null>(null);
    const [isLoading, setIsLoading] = React.useState(false);
    const [generationStartTime, setGenerationStartTime] = React.useState<number | null>(null);
    const [isSendingToEdit, setIsSendingToEdit] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [latestImageBatch, setLatestImageBatch] = React.useState<{ path: string; filename: string }[] | null>(null);
    const [imageOutputView, setImageOutputView] = React.useState<'grid' | number>('grid');
    const [history, setHistory] = React.useState<HistoryMetadata[]>([]);
    const [isInitialLoad, setIsInitialLoad] = React.useState(true);
    const blobUrlCacheRef = React.useRef<Map<string, string>>(new Map());
    const [isPasswordDialogOpen, setIsPasswordDialogOpen] = React.useState(false);
    const [passwordDialogContext, setPasswordDialogContext] = React.useState<'initial' | 'retry'>('initial');
    const [lastApiCallArgs, setLastApiCallArgs] = React.useState<[GenerationFormData | EditingFormData] | null>(null);
    const [skipDeleteConfirmation, setSkipDeleteConfirmation] = React.useState<boolean>(false);
    const [itemToDeleteConfirm, setItemToDeleteConfirm] = React.useState<HistoryMetadata | null>(null);
    const [dialogCheckboxStateSkipConfirm, setDialogCheckboxStateSkipConfirm] = React.useState<boolean>(false);
    // Canvas is the primary workspace; the classic form lives behind the "List" switch.
    const [viewMode, setViewMode] = React.useState<'canvas' | 'list'>('canvas');
    const [deleteReferenceWarning, setDeleteReferenceWarning] = React.useState<string | null>(null);
    const [toast, setToast] = React.useState<{ text: string; tone: 'info' | 'success' | 'error' } | null>(null);
    const [cleanupPreview, setCleanupPreview] = React.useState<{
        files: string[];
        bytes: number;
        skippedRecent: number;
        untracked: number;
    } | null>(null);
    const [isCleaningUp, setIsCleaningUp] = React.useState(false);
    const [canvasMounted, setCanvasMounted] = React.useState(false);

    /** Switching views is a user action: persist the choice and keep the canvas mounted once opened. */
    const selectViewMode = React.useCallback((next: 'canvas' | 'list') => {
        setViewMode(next);
        if (next === 'canvas') {
            setCanvasMounted(true);
        }
        try {
            window.localStorage.setItem('gptImageViewMode', next);
        } catch (error) {
            console.warn('Could not persist the view mode:', error);
        }
    }, []);

    React.useEffect(() => {
        // Deferred so restoring the preference never cascades a render inside the effect body.
        queueMicrotask(() => {
            let stored: string | null = null;
            try {
                stored = window.localStorage.getItem('gptImageViewMode');
            } catch (error) {
                console.warn('Could not read the stored view mode:', error);
            }
            if (stored === 'list' || stored === 'canvas') {
                setViewMode(stored);
                if (stored === 'canvas') {
                    setCanvasMounted(true);
                }
            }
        });
    }, []);

    const notify = React.useCallback((text: string, tone: 'info' | 'success' | 'error' = 'info') => {
        setToast({ text, tone });
    }, []);

    React.useEffect(() => {
        if (!toast) return;
        const timer = window.setTimeout(() => setToast(null), 4500);
        return () => window.clearTimeout(timer);
    }, [toast]);

    /** Lets canvas nodes contribute to the same history the list view shows. */
    const handleCanvasTaskComplete = React.useCallback((entry: HistoryMetadata) => {
        setHistory((prev) => [entry, ...prev]);
    }, []);

    const allDbImages = useLiveQuery<ImageRecord[] | undefined>(() => db.images.toArray(), []);

    const [editImageFiles, setEditImageFiles] = React.useState<File[]>([]);
    const [editSourceImagePreviewUrls, setEditSourceImagePreviewUrls] = React.useState<string[]>([]);
    const [editPrompt, setEditPrompt] = React.useState('');
    const [editN, setEditN] = React.useState([1]);
    const [editSize, setEditSize] = React.useState<EditingFormData['size']>('auto');
    const [editCustomWidth, setEditCustomWidth] = React.useState<number>(1024);
    const [editCustomHeight, setEditCustomHeight] = React.useState<number>(1024);
    const [editQuality, setEditQuality] = React.useState<EditingFormData['quality']>('auto');
    const [editOutputFormat, setEditOutputFormat] = React.useState<EditingFormData['output_format']>('png');
    const [editCompression, setEditCompression] = React.useState([100]);
    const [editBackground, setEditBackground] = React.useState<EditingFormData['background']>('auto');
    const [editModeration, setEditModeration] = React.useState<EditingFormData['moderation']>('auto');
    const [editBrushSize, setEditBrushSize] = React.useState([20]);
    const [editShowMaskEditor, setEditShowMaskEditor] = React.useState(false);
    const [editGeneratedMaskFile, setEditGeneratedMaskFile] = React.useState<File | null>(null);
    const [editIsMaskSaved, setEditIsMaskSaved] = React.useState(false);
    const [editOriginalImageSize, setEditOriginalImageSize] = React.useState<{ width: number; height: number } | null>(
        null
    );
    const [editDrawnPoints, setEditDrawnPoints] = React.useState<DrawnPoint[]>([]);
    const [editMaskPreviewUrl, setEditMaskPreviewUrl] = React.useState<string | null>(null);

    const [genModel, setGenModel] = React.useState<GenerationFormData['model']>(DEFAULT_GPT_IMAGE_MODEL);
    const [genPrompt, setGenPrompt] = React.useState('');
    const [genN, setGenN] = React.useState([1]);
    const [genSize, setGenSize] = React.useState<GenerationFormData['size']>('auto');
    const [genCustomWidth, setGenCustomWidth] = React.useState<number>(1024);
    const [genCustomHeight, setGenCustomHeight] = React.useState<number>(1024);
    const [genQuality, setGenQuality] = React.useState<GenerationFormData['quality']>('auto');
    const [genOutputFormat, setGenOutputFormat] = React.useState<GenerationFormData['output_format']>('png');
    const [genCompression, setGenCompression] = React.useState([100]);
    const [genBackground, setGenBackground] = React.useState<GenerationFormData['background']>('auto');
    const [genModeration, setGenModeration] = React.useState<GenerationFormData['moderation']>('auto');

    const [editModel, setEditModel] = React.useState<EditingFormData['model']>(DEFAULT_GPT_IMAGE_MODEL);

    // Streaming state (shared between generate and edit modes)
    const [enableStreaming, setEnableStreaming] = React.useState(false);
    const [partialImages, setPartialImages] = React.useState<1 | 2 | 3>(2);
    // Streaming preview images (base64 data URLs for partial images during streaming)
    const [streamingPreviewImages, setStreamingPreviewImages] = React.useState<Map<number, string>>(new Map());

    const getImageSrc = React.useCallback(
        (filename: string): string | undefined => {
            const cached = blobUrlCacheRef.current.get(filename);
            if (cached) return cached;

            const record = allDbImages?.find((img) => img.filename === filename);
            if (record?.blob) {
                const url = URL.createObjectURL(record.blob);
                blobUrlCacheRef.current.set(filename, url);
                return url;
            }

            return undefined;
        },
        [allDbImages]
    );

    React.useEffect(() => {
        const cache = blobUrlCacheRef.current;
        return () => {
            cache.forEach((url) => URL.revokeObjectURL(url));
            cache.clear();
        };
    }, []);

    React.useEffect(() => {
        return () => {
            editSourceImagePreviewUrls.forEach((url) => URL.revokeObjectURL(url));
        };
    }, [editSourceImagePreviewUrls]);

    React.useEffect(() => {
        let cancelled = false;

        queueMicrotask(() => {
            if (cancelled) return;

            try {
                const storedHistory = localStorage.getItem('openaiImageHistory');
                if (storedHistory) {
                    const parsedHistory: HistoryMetadata[] = JSON.parse(storedHistory);
                    if (Array.isArray(parsedHistory)) {
                        setHistory(parsedHistory);
                    } else {
                        console.warn('Invalid history data found in localStorage.');
                        localStorage.removeItem('openaiImageHistory');
                    }
                }
            } catch (e) {
                console.error('Failed to load or parse history from localStorage:', e);
                localStorage.removeItem('openaiImageHistory');
            }
            setIsInitialLoad(false);
        });

        return () => {
            cancelled = true;
        };
    }, []);

    React.useEffect(() => {
        const fetchAuthStatus = async () => {
            try {
                const response = await fetch('/api/auth-status');
                if (!response.ok) {
                    throw new Error('Failed to fetch auth status');
                }
                const data = await response.json();
                setIsPasswordRequiredByBackend(data.passwordRequired);
            } catch (error) {
                console.error('Error fetching auth status:', error);
                setIsPasswordRequiredByBackend(false);
            }
        };

        fetchAuthStatus();

        let cancelled = false;
        queueMicrotask(() => {
            if (cancelled) return;

            const storedHash = localStorage.getItem('clientPasswordHash');
            if (storedHash) {
                setClientPasswordHash(storedHash);
            }
        });

        return () => {
            cancelled = true;
        };
    }, []);

    React.useEffect(() => {
        if (!isInitialLoad) {
            try {
                localStorage.setItem('openaiImageHistory', JSON.stringify(history));
            } catch (e) {
                console.error('Failed to save history to localStorage:', e);
            }
        }
    }, [history, isInitialLoad]);

    React.useEffect(() => {
        return () => {
            editSourceImagePreviewUrls.forEach((url) => URL.revokeObjectURL(url));
        };
    }, [editSourceImagePreviewUrls]);

    React.useEffect(() => {
        let cancelled = false;

        queueMicrotask(() => {
            if (cancelled) return;

            const storedPref = localStorage.getItem('imageGenSkipDeleteConfirm');
            if (storedPref === 'true') {
                setSkipDeleteConfirmation(true);
            } else if (storedPref === 'false') {
                setSkipDeleteConfirmation(false);
            }
        });

        return () => {
            cancelled = true;
        };
    }, []);

    React.useEffect(() => {
        localStorage.setItem('imageGenSkipDeleteConfirm', String(skipDeleteConfirmation));
    }, [skipDeleteConfirmation]);

    React.useEffect(() => {
        const handlePaste = (event: ClipboardEvent) => {
            if (mode !== 'edit' || !event.clipboardData) {
                return;
            }

            if (editImageFiles.length >= MAX_EDIT_IMAGES) {
                notify(t('Cannot paste: Maximum of {count} images reached.', { count: MAX_EDIT_IMAGES }), 'info');
                return;
            }

            const items = event.clipboardData.items;
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image') !== -1) {
                    const file = items[i].getAsFile();
                    if (file) {
                        event.preventDefault();

                        const previewUrl = URL.createObjectURL(file);

                        setEditImageFiles((prevFiles) => [...prevFiles, file]);
                        setEditSourceImagePreviewUrls((prevUrls) => [...prevUrls, previewUrl]);

                        break;
                    }
                }
            }
        };

        window.addEventListener('paste', handlePaste);

        return () => {
            window.removeEventListener('paste', handlePaste);
        };
    }, [mode, editImageFiles.length, notify, t]);

    async function sha256Client(text: string): Promise<string> {
        const encoder = new TextEncoder();
        const data = encoder.encode(text);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
        return hashHex;
    }

    const handleSavePassword = async (password: string) => {
        if (!password.trim()) {
            setError('Password cannot be empty.');
            return;
        }
        try {
            const hash = await sha256Client(password);
            localStorage.setItem('clientPasswordHash', hash);
            setClientPasswordHash(hash);
            setError(null);
            setIsPasswordDialogOpen(false);
            if (passwordDialogContext === 'retry' && lastApiCallArgs) {
                await handleApiCall(...lastApiCallArgs);
            }
        } catch (e) {
            console.error('Error hashing password:', e);
            setError('Failed to save password due to a hashing error.');
        }
    };

    const handleOpenPasswordDialog = () => {
        setPasswordDialogContext('initial');
        setIsPasswordDialogOpen(true);
    };

    const getMimeTypeFromFormat = (format: string): string => {
        if (format === 'jpeg') return 'image/jpeg';
        if (format === 'webp') return 'image/webp';

        return 'image/png';
    };

    // Shared tail for streamed and non-streamed responses: persist blobs (indexeddb mode), show the batch, record history.
    const processApiImages = async (
        images: ApiImageResponseItem[],
        usage: ApiUsage | undefined,
        durationMs: number
    ) => {
        const isGenerate = mode === 'generate';
        const currentModel = isGenerate ? genModel : editModel;
        const newHistoryEntry: HistoryMetadata = {
            timestamp: Date.now(),
            images: images.map((img) => ({ filename: img.filename })),
            storageModeUsed: effectiveStorageModeClient,
            durationMs,
            quality: isGenerate ? genQuality : editQuality,
            background: isGenerate ? genBackground : editBackground,
            moderation: isGenerate ? genModeration : editModeration,
            output_format: isGenerate ? genOutputFormat : editOutputFormat,
            prompt: isGenerate ? genPrompt : editPrompt,
            mode,
            costDetails: calculateApiCost(usage, currentModel),
            model: currentModel
        };

        let newImageBatchPromises: Promise<{ path: string; filename: string } | null>[];
        if (effectiveStorageModeClient === 'indexeddb') {
            newImageBatchPromises = images.map(async (img) => {
                if (!img.b64_json) {
                    console.warn(`Image ${img.filename} missing b64_json in indexeddb mode.`);
                    return null;
                }
                try {
                    const byteCharacters = atob(img.b64_json);
                    const byteNumbers = new Array(byteCharacters.length);
                    for (let i = 0; i < byteCharacters.length; i++) {
                        byteNumbers[i] = byteCharacters.charCodeAt(i);
                    }
                    const byteArray = new Uint8Array(byteNumbers);

                    const actualMimeType = getMimeTypeFromFormat(img.output_format);
                    const blob = new Blob([byteArray], { type: actualMimeType });

                    await db.images.put({ filename: img.filename, blob });

                    const blobUrl = URL.createObjectURL(blob);
                    blobUrlCacheRef.current.set(img.filename, blobUrl);

                    return { filename: img.filename, path: blobUrl };
                } catch (dbError) {
                    console.error(`Error saving blob ${img.filename} to IndexedDB:`, dbError);
                    setError(`Failed to save image ${img.filename} to local database.`);
                    return null;
                }
            });
        } else {
            newImageBatchPromises = images
                .filter((img) => !!img.path)
                .map((img) => Promise.resolve({ path: img.path!, filename: img.filename }));
        }

        const processedImages = (await Promise.all(newImageBatchPromises)).filter(Boolean) as {
            path: string;
            filename: string;
        }[];

        setLatestImageBatch(processedImages);
        setImageOutputView(processedImages.length > 1 ? 'grid' : 0);
        setStreamingPreviewImages(new Map());
        setHistory((prevHistory) => [newHistoryEntry, ...prevHistory]);
    };

    const handleApiCall = async (formData: GenerationFormData | EditingFormData) => {
        const startTime = Date.now();
        let durationMs = 0;

        setIsLoading(true);
        setGenerationStartTime(startTime);
        setError(null);
        setLatestImageBatch(null);
        setImageOutputView('grid');
        setStreamingPreviewImages(new Map());

        const apiFormData = new FormData();
        if (isPasswordRequiredByBackend && clientPasswordHash) {
            apiFormData.append('passwordHash', clientPasswordHash);
        } else if (isPasswordRequiredByBackend && !clientPasswordHash) {
            setError('Password is required. Please configure the password by clicking the lock icon.');
            setPasswordDialogContext('initial');
            setIsPasswordDialogOpen(true);
            setIsLoading(false);
            return;
        }
        apiFormData.append('mode', mode);

        // Add streaming parameters if enabled
        if (enableStreaming) {
            apiFormData.append('stream', 'true');
            apiFormData.append('partial_images', partialImages.toString());
        }

        if (mode === 'generate') {
            const genData = formData as GenerationFormData;
            apiFormData.append('model', genModel);
            apiFormData.append('prompt', genPrompt);
            apiFormData.append('n', genN[0].toString());
            const genSizeToSend =
                genSize === 'custom'
                    ? `${genCustomWidth}x${genCustomHeight}`
                    : (getPresetDimensions(genSize) ?? genSize);
            apiFormData.append('size', genSizeToSend);
            apiFormData.append('quality', genQuality);
            apiFormData.append('output_format', genOutputFormat);
            if (
                (genOutputFormat === 'jpeg' || genOutputFormat === 'webp') &&
                genData.output_compression !== undefined
            ) {
                apiFormData.append('output_compression', genData.output_compression.toString());
            }
            apiFormData.append('background', genBackground);
            apiFormData.append('moderation', genModeration);
        } else {
            const editData = formData as EditingFormData;
            apiFormData.append('model', editModel);
            apiFormData.append('prompt', editPrompt);
            apiFormData.append('n', editN[0].toString());
            const editSizeToSend =
                editSize === 'custom'
                    ? `${editCustomWidth}x${editCustomHeight}`
                    : (getPresetDimensions(editSize) ?? editSize);
            apiFormData.append('size', editSizeToSend);
            apiFormData.append('quality', editQuality);
            apiFormData.append('output_format', editOutputFormat);
            if (
                (editOutputFormat === 'jpeg' || editOutputFormat === 'webp') &&
                editData.output_compression !== undefined
            ) {
                apiFormData.append('output_compression', editData.output_compression.toString());
            }
            apiFormData.append('background', editBackground);
            apiFormData.append('moderation', editModeration);

            editImageFiles.forEach((file, index) => {
                apiFormData.append(`image_${index}`, file, file.name);
            });
            if (editGeneratedMaskFile) {
                apiFormData.append('mask', editGeneratedMaskFile, editGeneratedMaskFile.name);
            }
        }

        try {
            const response = await fetch('/api/images', {
                method: 'POST',
                body: apiFormData
            });

            // Check if response is SSE (streaming)
            const contentType = response.headers.get('content-type');
            if (contentType?.includes('text/event-stream')) {
                if (!response.body) {
                    throw new Error('Response body is null');
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });

                    // Process complete SSE events
                    const lines = buffer.split('\n\n');
                    buffer = lines.pop() || ''; // Keep incomplete event in buffer

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const jsonStr = line.slice(6);
                            try {
                                const event = JSON.parse(jsonStr);

                                if (event.type === 'partial_image') {
                                    // Update streaming preview with partial image
                                    const imageIndex = event.index ?? 0;
                                    const mimeType = getMimeTypeFromFormat(
                                        mode === 'generate' ? genOutputFormat : editOutputFormat
                                    );
                                    const dataUrl = `data:${mimeType};base64,${event.b64_json}`;
                                    setStreamingPreviewImages((prev) => {
                                        const newMap = new Map(prev);
                                        newMap.set(imageIndex, dataUrl);
                                        return newMap;
                                    });
                                } else if (event.type === 'error') {
                                    throw new Error(event.error || 'Streaming error occurred');
                                } else if (event.type === 'done') {
                                    // Finalize with all completed images
                                    durationMs = Date.now() - startTime;

                                    if (event.images && event.images.length > 0) {
                                        await processApiImages(event.images, event.usage, durationMs);
                                    }
                                }
                            } catch (parseError) {
                                console.error('Error parsing SSE event:', parseError);
                            }
                        }
                    }
                }

                return; // Exit early for streaming
            }

            // Non-streaming response handling (original code)
            const result = await response.json();

            if (!response.ok) {
                if (response.status === 401 && isPasswordRequiredByBackend) {
                    setError('Unauthorized: Invalid or missing password. Please try again.');
                    setPasswordDialogContext('retry');
                    setLastApiCallArgs([formData]);
                    setIsPasswordDialogOpen(true);

                    return;
                }
                throw new Error(result.error || `API request failed with status ${response.status}`);
            }

            if (result.images && result.images.length > 0) {
                durationMs = Date.now() - startTime;
                await processApiImages(result.images, result.usage, durationMs);
            } else {
                setLatestImageBatch(null);
                throw new Error('API response did not contain valid image data or filenames.');
            }
        } catch (err: unknown) {
            durationMs = Date.now() - startTime;
            console.error(`API Call Error after ${durationMs}ms:`, err);
            const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred.';
            setError(errorMessage);
            setLatestImageBatch(null);
            setStreamingPreviewImages(new Map());
        } finally {
            if (durationMs === 0) durationMs = Date.now() - startTime;
            setIsLoading(false);
            setGenerationStartTime(null);
        }
    };

    const handleHistorySelect = React.useCallback(
        (item: HistoryMetadata) => {
            const originalStorageMode = item.storageModeUsed || 'fs';

            const selectedBatchPromises = item.images.map(async (imgInfo) => {
                let path: string | undefined;
                if (originalStorageMode === 'indexeddb') {
                    path = getImageSrc(imgInfo.filename);
                } else {
                    path = `/api/image/${imgInfo.filename}`;
                }

                if (path) {
                    return { path, filename: imgInfo.filename };
                } else {
                    console.warn(
                        `Could not get image source for history item: ${imgInfo.filename} (mode: ${originalStorageMode})`
                    );
                    setError(`Image ${imgInfo.filename} could not be loaded.`);
                    return null;
                }
            });

            Promise.all(selectedBatchPromises).then((resolvedBatch) => {
                const validImages = resolvedBatch.filter(Boolean) as { path: string; filename: string }[];

                if (validImages.length !== item.images.length) {
                    setError(
                        'Some images from this history entry could not be loaded (they might have been cleared or are missing).'
                    );
                } else {
                    setError(null);
                }

                setLatestImageBatch(validImages.length > 0 ? validImages : null);
                setImageOutputView(validImages.length > 1 ? 'grid' : 0);
            });
        },
        [getImageSrc]
    );

    const handleClearHistory = React.useCallback(async () => {
        const confirmationMessage =
            effectiveStorageModeClient === 'indexeddb'
                ? t(
                      'Are you sure you want to clear the entire image history? In IndexedDB mode, this will also permanently delete all stored images. This cannot be undone.'
                  )
                : t(
                      'Are you sure you want to clear the entire image history? This only removes the records — use “Clean up orphaned files on disk” afterwards to reclaim space. This cannot be undone.'
                  );

        if (window.confirm(confirmationMessage)) {
            setHistory([]);
            setLatestImageBatch(null);
            setImageOutputView('grid');
            setError(null);

            try {
                localStorage.removeItem('openaiImageHistory');

                if (effectiveStorageModeClient === 'indexeddb') {
                    await db.images.clear();
                    blobUrlCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
                    blobUrlCacheRef.current.clear();
                }
                // Disk files are deliberately left alone here: deleting them from a confirm dialog is
                // how you lose pictures. The explicit "clean up orphaned files" action owns that.
            } catch (e) {
                console.error('Failed during history clearing:', e);
                setError(`Failed to clear history: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
    }, [t]);

    /** Files the browser can still vouch for: canvas nodes plus every history entry. */
    const collectKeepList = React.useCallback((): string[] => {
        const keep = collectCanvasFilenames(readStoredCanvas());
        history.forEach((entry) => entry.images?.forEach((image) => keep.add(image.filename)));
        return Array.from(keep);
    }, [history]);

    const cleanupPayload = React.useCallback(
        () => ({
            keep: collectKeepList(),
            ...(isPasswordRequiredByBackend && clientPasswordHash ? { passwordHash: clientPasswordHash } : {})
        }),
        [clientPasswordHash, collectKeepList, isPasswordRequiredByBackend]
    );

    /** Step 1: ask the server what it would delete, then show it in a dialog. */
    const handleCleanupUnusedImages = React.useCallback(async () => {
        if (effectiveStorageModeClient !== 'fs') {
            notify(t('Disk cleanup is only available in filesystem storage mode.'), 'info');
            return;
        }
        try {
            const response = await fetch('/api/images-cleanup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...cleanupPayload(), dryRun: true })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || `Cleanup failed with status ${response.status}`);

            if (!result.deleted) {
                notify(
                    result.skippedRecent?.length
                        ? t('{count} recent file(s) were kept — try again in a few minutes.', {
                              count: result.skippedRecent.length
                          })
                        : t('Nothing to clean up — every registered image is still referenced.'),
                    'info'
                );
                return;
            }

            setCleanupPreview({
                files: result.deletedFiles ?? [],
                bytes: result.freedBytes ?? 0,
                skippedRecent: result.skippedRecent?.length ?? 0,
                untracked: result.untracked?.length ?? 0
            });
        } catch (error) {
            console.error('Image cleanup preview failed:', error);
            notify(error instanceof Error ? error.message : t('An unexpected error occurred.'), 'error');
        }
    }, [cleanupPayload, notify, t]);

    /** Step 2: the user confirmed the list — actually delete. */
    const confirmCleanupUnusedImages = React.useCallback(async () => {
        setIsCleaningUp(true);
        try {
            const response = await fetch('/api/images-cleanup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cleanupPayload())
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || `Cleanup failed with status ${response.status}`);

            notify(
                t('Deleted {count} file(s), freeing {size} MB.', {
                    count: result.deleted,
                    size: ((result.freedBytes ?? 0) / 1024 / 1024).toFixed(1)
                }),
                'success'
            );
            setCleanupPreview(null);
        } catch (error) {
            console.error('Image cleanup failed:', error);
            notify(error instanceof Error ? error.message : t('An unexpected error occurred.'), 'error');
        } finally {
            setIsCleaningUp(false);
        }
    }, [cleanupPayload, notify, t]);

    const handleSendToEdit = async (filename: string) => {
        if (isSendingToEdit) return;
        setIsSendingToEdit(true);
        setError(null);

        const alreadyExists = editImageFiles.some((file) => file.name === filename);
        if (mode === 'edit' && alreadyExists) {
            setIsSendingToEdit(false);
            return;
        }

        if (mode === 'edit' && editImageFiles.length >= MAX_EDIT_IMAGES) {
            setError(`Cannot add more than ${MAX_EDIT_IMAGES} images to the edit form.`);
            setIsSendingToEdit(false);
            return;
        }

        try {
            let blob: Blob | undefined;
            let mimeType: string = 'image/png';

            if (effectiveStorageModeClient === 'indexeddb') {
                const record = allDbImages?.find((img) => img.filename === filename);
                if (record?.blob) {
                    blob = record.blob;
                    mimeType = blob.type || mimeType;
                } else {
                    throw new Error(`Image ${filename} not found in local database.`);
                }
            } else {
                const response = await fetch(`/api/image/${filename}`);
                if (!response.ok) {
                    throw new Error(`Failed to fetch image: ${response.statusText}`);
                }
                blob = await response.blob();
                mimeType = response.headers.get('Content-Type') || mimeType;
            }

            if (!blob) {
                throw new Error(`Could not retrieve image data for ${filename}.`);
            }

            const newFile = new File([blob], filename, { type: mimeType });
            const newPreviewUrl = URL.createObjectURL(blob);

            editSourceImagePreviewUrls.forEach((url) => URL.revokeObjectURL(url));

            setEditImageFiles([newFile]);
            setEditSourceImagePreviewUrls([newPreviewUrl]);

            if (mode === 'generate') {
                setMode('edit');
            }
        } catch (err: unknown) {
            console.error('Error sending image to edit:', err);
            const errorMessage = err instanceof Error ? err.message : 'Failed to send image to edit form.';
            setError(errorMessage);
        } finally {
            setIsSendingToEdit(false);
        }
    };

    const executeDeleteItem = React.useCallback(
        async (item: HistoryMetadata) => {
            if (!item) return;
            setError(null);

            const { images: imagesInEntry, storageModeUsed, timestamp } = item;
            const filenamesToDelete = imagesInEntry.map((img) => img.filename);

            try {
                if (storageModeUsed === 'indexeddb') {
                    await db.images.where('filename').anyOf(filenamesToDelete).delete();
                    filenamesToDelete.forEach((fn) => {
                        const url = blobUrlCacheRef.current.get(fn);
                        if (url) URL.revokeObjectURL(url);
                        blobUrlCacheRef.current.delete(fn);
                    });
                } else if (storageModeUsed === 'fs') {
                    const apiPayload: { filenames: string[]; passwordHash?: string } = {
                        filenames: filenamesToDelete
                    };
                    if (isPasswordRequiredByBackend && clientPasswordHash) {
                        apiPayload.passwordHash = clientPasswordHash;
                    }

                    const response = await fetch('/api/image-delete', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(apiPayload)
                    });

                    const result = await response.json();
                    if (!response.ok) {
                        throw new Error(result.error || `API deletion failed with status ${response.status}`);
                    }
                }

                setHistory((prevHistory) => prevHistory.filter((h) => h.timestamp !== timestamp));
                setDeleteReferenceWarning(null);
                setItemToDeleteConfirm(null);
                setLatestImageBatch((prev) =>
                    prev && prev.some((img) => filenamesToDelete.includes(img.filename)) ? null : prev
                );
            } catch (e: unknown) {
                console.error('Error during item deletion:', e);
                setError(e instanceof Error ? e.message : 'An unexpected error occurred during deletion.');
            } finally {
                setItemToDeleteConfirm(null);
            }
        },
        [isPasswordRequiredByBackend, clientPasswordHash]
    );

    /** Warns when a history entry still feeds canvas nodes, so the user knows what breaks. */
    const describeCanvasReferences = React.useCallback(
        (item: HistoryMetadata): string | null => {
            const referenced = findCanvasReferences(item.images.map((image) => image.filename));
            if (referenced.length === 0) return null;
            const nodeCount = referenced.reduce((total, filename) => total + countCanvasReferences(filename), 0);
            return t(
                'This entry still feeds {count} canvas node(s). Deleting it leaves those nodes without their source image.',
                { count: nodeCount }
            );
        },
        [t]
    );

    const handleRequestDeleteItem = React.useCallback(
        (item: HistoryMetadata) => {
            // The warning is computed here rather than trusted from the caller, so a referenced file can
            // never slip through the confirmation — not even with "don't ask me again" switched on.
            const referenceWarning = describeCanvasReferences(item);
            if (skipDeleteConfirmation && !referenceWarning) {
                void executeDeleteItem(item);
                return;
            }
            setDialogCheckboxStateSkipConfirm(skipDeleteConfirmation);
            setDeleteReferenceWarning(referenceWarning);
            setItemToDeleteConfirm(item);
        },
        [describeCanvasReferences, skipDeleteConfirmation, executeDeleteItem]
    );

    const handleConfirmDeletion = React.useCallback(() => {
        if (itemToDeleteConfirm) {
            executeDeleteItem(itemToDeleteConfirm);
            setSkipDeleteConfirmation(dialogCheckboxStateSkipConfirm);
        }
    }, [itemToDeleteConfirm, executeDeleteItem, dialogCheckboxStateSkipConfirm]);

    const handleCancelDeletion = React.useCallback(() => {
        setItemToDeleteConfirm(null);
        setDeleteReferenceWarning(null);
    }, []);

    return (
        <main className='flex min-h-screen flex-col items-center bg-slate-50 px-4 py-4 text-slate-900 md:px-8 lg:px-10'>
            <div className='mb-3 flex w-full max-w-screen-2xl items-start justify-between gap-3'>
                <div className='flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm'>
                    <button
                        type='button'
                        onClick={() => selectViewMode('canvas')}
                        aria-pressed={viewMode === 'canvas'}
                        className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] transition-colors ${
                            viewMode === 'canvas'
                                ? 'bg-indigo-50 text-indigo-600'
                                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                        }`}>
                        <Workflow className='h-3.5 w-3.5' />
                        {t('Canvas')}
                    </button>
                    <button
                        type='button'
                        onClick={() => selectViewMode('list')}
                        aria-pressed={viewMode === 'list'}
                        className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] transition-colors ${
                            viewMode === 'list'
                                ? 'bg-indigo-50 text-indigo-600'
                                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                        }`}>
                        <List className='h-3.5 w-3.5' />
                        {t('List')}
                    </button>
                </div>
                <div className='flex items-start gap-3'>
                    <ShutdownButton />
                    <LanguageToggle />
                </div>
            </div>
            <PasswordDialog
                isOpen={isPasswordDialogOpen}
                onOpenChange={setIsPasswordDialogOpen}
                onSave={handleSavePassword}
                title={passwordDialogContext === 'retry' ? t('Password Required') : t('Configure Password')}
                description={
                    passwordDialogContext === 'retry'
                        ? t(
                              'The server requires a password, or the previous one was incorrect. Please enter it to continue.'
                          )
                        : t('Set a password to use for API requests.')
                }
            />
            <div className={viewMode === 'list' ? 'w-full max-w-screen-2xl space-y-5 pt-1' : 'hidden'}>
                <div className='grid grid-cols-1 gap-6 lg:grid-cols-2'>
                    <div className='relative flex h-[70vh] min-h-[600px] flex-col lg:col-span-1'>
                        <div className={mode === 'generate' ? 'block h-full w-full' : 'hidden'}>
                            <GenerationForm
                                onSubmit={handleApiCall}
                                isLoading={isLoading}
                                currentMode={mode}
                                onModeChange={setMode}
                                isPasswordRequiredByBackend={isPasswordRequiredByBackend}
                                clientPasswordHash={clientPasswordHash}
                                onOpenPasswordDialog={handleOpenPasswordDialog}
                                model={genModel}
                                setModel={setGenModel}
                                prompt={genPrompt}
                                setPrompt={setGenPrompt}
                                n={genN}
                                setN={setGenN}
                                size={genSize}
                                setSize={setGenSize}
                                customWidth={genCustomWidth}
                                setCustomWidth={setGenCustomWidth}
                                customHeight={genCustomHeight}
                                setCustomHeight={setGenCustomHeight}
                                quality={genQuality}
                                setQuality={setGenQuality}
                                outputFormat={genOutputFormat}
                                setOutputFormat={setGenOutputFormat}
                                compression={genCompression}
                                setCompression={setGenCompression}
                                background={genBackground}
                                setBackground={setGenBackground}
                                moderation={genModeration}
                                setModeration={setGenModeration}
                                enableStreaming={enableStreaming}
                                setEnableStreaming={setEnableStreaming}
                                partialImages={partialImages}
                                setPartialImages={setPartialImages}
                            />
                        </div>
                        <div className={mode === 'edit' ? 'block h-full w-full' : 'hidden'}>
                            <EditingForm
                                onSubmit={handleApiCall}
                                isLoading={isLoading || isSendingToEdit}
                                currentMode={mode}
                                onModeChange={setMode}
                                isPasswordRequiredByBackend={isPasswordRequiredByBackend}
                                clientPasswordHash={clientPasswordHash}
                                onOpenPasswordDialog={handleOpenPasswordDialog}
                                editModel={editModel}
                                setEditModel={setEditModel}
                                imageFiles={editImageFiles}
                                sourceImagePreviewUrls={editSourceImagePreviewUrls}
                                setImageFiles={setEditImageFiles}
                                setSourceImagePreviewUrls={setEditSourceImagePreviewUrls}
                                maxImages={MAX_EDIT_IMAGES}
                                editPrompt={editPrompt}
                                setEditPrompt={setEditPrompt}
                                editN={editN}
                                setEditN={setEditN}
                                editSize={editSize}
                                setEditSize={setEditSize}
                                editCustomWidth={editCustomWidth}
                                setEditCustomWidth={setEditCustomWidth}
                                editCustomHeight={editCustomHeight}
                                setEditCustomHeight={setEditCustomHeight}
                                editQuality={editQuality}
                                setEditQuality={setEditQuality}
                                editOutputFormat={editOutputFormat}
                                setEditOutputFormat={setEditOutputFormat}
                                editCompression={editCompression}
                                setEditCompression={setEditCompression}
                                editBackground={editBackground}
                                setEditBackground={setEditBackground}
                                editModeration={editModeration}
                                setEditModeration={setEditModeration}
                                editBrushSize={editBrushSize}
                                setEditBrushSize={setEditBrushSize}
                                editShowMaskEditor={editShowMaskEditor}
                                setEditShowMaskEditor={setEditShowMaskEditor}
                                editGeneratedMaskFile={editGeneratedMaskFile}
                                setEditGeneratedMaskFile={setEditGeneratedMaskFile}
                                editIsMaskSaved={editIsMaskSaved}
                                setEditIsMaskSaved={setEditIsMaskSaved}
                                editOriginalImageSize={editOriginalImageSize}
                                setEditOriginalImageSize={setEditOriginalImageSize}
                                editDrawnPoints={editDrawnPoints}
                                setEditDrawnPoints={setEditDrawnPoints}
                                editMaskPreviewUrl={editMaskPreviewUrl}
                                setEditMaskPreviewUrl={setEditMaskPreviewUrl}
                                enableStreaming={enableStreaming}
                                setEnableStreaming={setEnableStreaming}
                                partialImages={partialImages}
                                setPartialImages={setPartialImages}
                            />
                        </div>
                    </div>
                    <div className='flex h-[70vh] min-h-[600px] flex-col lg:col-span-1'>
                        {error && (
                            <Alert variant='destructive' className='mb-4 border-red-200 bg-red-50 text-red-600'>
                                <AlertTitle className='text-red-700'>{t('Error')}</AlertTitle>
                                <AlertDescription>{error}</AlertDescription>
                            </Alert>
                        )}
                        <ImageOutput
                            imageBatch={latestImageBatch}
                            viewMode={imageOutputView}
                            onViewChange={setImageOutputView}
                            isLoading={isLoading || isSendingToEdit}
                            loadingStartTime={generationStartTime}
                            onSendToEdit={handleSendToEdit}
                            currentMode={mode}
                            baseImagePreviewUrl={editSourceImagePreviewUrls[0] || null}
                            streamingPreviewImages={streamingPreviewImages}
                        />
                    </div>
                </div>

                <div className='min-h-[450px]'>
                    <HistoryPanel
                        history={history}
                        onSelectImage={handleHistorySelect}
                        onClearHistory={handleClearHistory}
                        getImageSrc={getImageSrc}
                        onDeleteItemRequest={handleRequestDeleteItem}
                        referenceWarning={deleteReferenceWarning}
                        onCleanupUnusedImages={handleCleanupUnusedImages}
                        cleanupDisabled={effectiveStorageModeClient !== 'fs'}
                        itemPendingDeleteConfirmation={itemToDeleteConfirm}
                        onConfirmDeletion={handleConfirmDeletion}
                        onCancelDeletion={handleCancelDeletion}
                        deletePreferenceDialogValue={dialogCheckboxStateSkipConfirm}
                        onDeletePreferenceDialogChange={setDialogCheckboxStateSkipConfirm}
                    />
                </div>
            </div>

            <Dialog open={!!cleanupPreview} onOpenChange={(open) => !open && setCleanupPreview(null)}>
                <DialogContent className='border-slate-200 bg-white text-slate-900 sm:max-w-[480px]'>
                    <DialogHeader>
                        <DialogTitle className='text-base'>{t('Clean up orphaned files on disk')}</DialogTitle>
                        <DialogDescription className='pt-1 text-slate-600'>
                            {t('These files are registered on the server but nothing references them any more.')}
                        </DialogDescription>
                    </DialogHeader>
                    <div className='space-y-2 text-xs'>
                        <ul className='max-h-40 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] leading-relaxed text-slate-600'>
                            {cleanupPreview?.files.slice(0, 5).map((filename) => (
                                <li key={filename}>{filename}</li>
                            ))}
                            {(cleanupPreview?.files.length ?? 0) > 5 && (
                                <li>
                                    …{' '}
                                    {t('and {count} more', { count: (cleanupPreview?.files.length ?? 0) - 5 })}
                                </li>
                            )}
                        </ul>
                        <p className='text-slate-600'>
                            {t('Frees about {size} MB.', {
                                size: ((cleanupPreview?.bytes ?? 0) / 1024 / 1024).toFixed(1)
                            })}
                        </p>
                        {!!cleanupPreview?.skippedRecent && (
                            <p className='text-amber-600'>
                                {t('{count} recently generated file(s) are skipped for safety.', {
                                    count: cleanupPreview.skippedRecent
                                })}
                            </p>
                        )}
                        {!!cleanupPreview?.untracked && (
                            <p className='text-slate-500'>
                                {t('{count} unregistered file(s) are left untouched.', { count: cleanupPreview.untracked })}
                            </p>
                        )}
                    </div>
                    <DialogFooter className='gap-2 sm:justify-end'>
                        <Button
                            type='button'
                            variant='outline'
                            size='sm'
                            onClick={() => setCleanupPreview(null)}
                            className='border-slate-300 text-slate-600 hover:bg-slate-200 hover:text-slate-900'>
                            {t('Cancel')}
                        </Button>
                        <Button
                            type='button'
                            size='sm'
                            disabled={isCleaningUp}
                            onClick={confirmCleanupUnusedImages}
                            className='bg-red-600 text-white hover:bg-red-500 disabled:opacity-60'>
                            {t('Delete {count} file(s)', { count: cleanupPreview?.files.length ?? 0 })}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {toast && (
                <div
                    role='status'
                    className={`fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-lg border px-4 py-2 text-sm shadow-lg ${
                        toast.tone === 'success'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                            : toast.tone === 'error'
                              ? 'border-red-200 bg-red-50 text-red-700'
                              : 'border-slate-200 bg-white text-slate-700'
                    }`}>
                    {toast.text}
                </div>
            )}

            {canvasMounted && (
                <div className={viewMode === 'canvas' ? 'w-full max-w-screen-2xl' : 'hidden'}>
                    <CanvasBoard
                        onTaskComplete={handleCanvasTaskComplete}
                        onNotify={notify}
                        passwordHash={clientPasswordHash}
                    />
                </div>
            )}
        </main>
    );
}
