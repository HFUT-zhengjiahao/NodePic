'use client';

import { CanvasBoard } from '@/components/canvas/canvas-board';
import { CanvasSidebar } from '@/components/canvas/canvas-sidebar';
import { HistoryGallery } from '@/components/history/history-gallery';
import { LanguageToggle } from '@/components/language-toggle';
import { SettingsButton, type ClientDefaults } from '@/components/settings-button';
import { ShutdownButton } from '@/components/shutdown-button';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog';
import { collectCanvasFilenames, countCanvasReferences, findCanvasReferences } from '@/lib/canvas-refs';
import {
    createCanvasMeta,
    loadCanvasNodes,
    loadRegistry,
    saveCanvasNodes,
    saveRegistry,
    type CanvasMeta
} from '@/lib/canvas-store';
import { useI18n } from '@/lib/i18n';
import { DEFAULT_GPT_IMAGE_MODEL, type GptImageModel, type ImageBackground, type ImageModeration, type ImageOutputFormat, type ImageQuality } from '@/lib/models';
import { History as HistoryIcon, Workflow } from 'lucide-react';
import * as React from 'react';

// ---------------------------------------------------------------------------------------------
// Types shared with the canvas nodes and the history page.
// ---------------------------------------------------------------------------------------------

export type HistoryImage = {
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
    costDetails: { estimated_cost_usd: number } | null;
    output_format?: ImageOutputFormat;
    model?: GptImageModel;
};

const HISTORY_KEY = 'openaiImageHistory';
const VIEW_KEY = 'gptImageWorkspaceView';
const SETTINGS_KEY = 'gptImageSettings';
const SKIP_DELETE_KEY = 'imageGenSkipDeleteConfirm';
const PASSWORD_KEY = 'clientPasswordHash';

const DEFAULT_CLIENT_SETTINGS: ClientDefaults = { model: DEFAULT_GPT_IMAGE_MODEL, quality: 'high', size: 'auto' };

export default function Home() {
    const { t } = useI18n();

    const [view, setView] = React.useState<'canvas' | 'history'>('canvas');
    const [canvasMounted, setCanvasMounted] = React.useState(true);
    const [history, setHistory] = React.useState<HistoryMetadata[]>([]);
    const [skipDeleteConfirmation, setSkipDeleteConfirmation] = React.useState(false);
    const [canvases, setCanvases] = React.useState<CanvasMeta[]>([]);
    const [activeCanvasId, setActiveCanvasId] = React.useState('');
    const [canvasRevision, setCanvasRevision] = React.useState(0);
    const [isCanvasListCollapsed, setIsCanvasListCollapsed] = React.useState(false);
    const [incomingImages, setIncomingImages] = React.useState<{ filenames: string[]; token: number } | null>(null);
    const [clientSettings, setClientSettings] = React.useState<ClientDefaults>(DEFAULT_CLIENT_SETTINGS);
    const [clientPasswordHash, setClientPasswordHash] = React.useState<string | null>(null);
    const [toast, setToast] = React.useState<{ text: string; tone: 'info' | 'success' | 'error' } | null>(null);
    const [cleanupPreview, setCleanupPreview] = React.useState<{
        files: string[];
        bytes: number;
        skippedRecent: number;
        untracked: number;
    } | null>(null);
    const [isCleaningUp, setIsCleaningUp] = React.useState(false);
    /** Flips once the stored history has been read, so nothing is written before that. */
    const [historyReady, setHistoryReady] = React.useState(false);
    /** Only an explicit "clear history" may persist an empty list. */
    const explicitHistoryClear = React.useRef(false);


    const notify = React.useCallback((text: string, tone: 'info' | 'success' | 'error' = 'info') => {
        setToast({ text, tone });
    }, []);

    React.useEffect(() => {
        if (!toast) return;
        const timer = window.setTimeout(() => setToast(null), 4500);
        return () => window.clearTimeout(timer);
    }, [toast]);

    // Browser storage is only readable after mount, so the restore step is deferred.
    React.useEffect(() => {
        queueMicrotask(() => {
            try {
                const storedHistory = window.localStorage.getItem(HISTORY_KEY);
                if (storedHistory) {
                    const parsed = JSON.parse(storedHistory) as HistoryMetadata[];
                    if (Array.isArray(parsed) && parsed.length > 0) setHistory(parsed);
                }
                setHistoryReady(true);

                const storedView = window.localStorage.getItem(VIEW_KEY);
                if (storedView === 'history' || storedView === 'canvas') setView(storedView);

                const storedSettings = window.localStorage.getItem(SETTINGS_KEY);
                if (storedSettings) {
                    const parsed = JSON.parse(storedSettings) as Partial<ClientDefaults>;
                    setClientSettings({
                        model: parsed.model ?? DEFAULT_CLIENT_SETTINGS.model,
                        quality: parsed.quality ?? DEFAULT_CLIENT_SETTINGS.quality,
                        size: parsed.size ?? DEFAULT_CLIENT_SETTINGS.size
                    });
                }

                setSkipDeleteConfirmation(window.localStorage.getItem(SKIP_DELETE_KEY) === 'true');
                setClientPasswordHash(window.localStorage.getItem(PASSWORD_KEY));

                const registry = loadRegistry();
                setCanvases(registry.canvases);
                setActiveCanvasId(registry.activeId);
            } catch (error) {
                console.error('Could not restore the workspace state:', error);
            }
        });
    }, []);

    React.useEffect(() => {
        // Writing before the stored history has been read would replace it with the initial empty
        // array — the exact way this list was wiped once already.
        if (!historyReady) return;
        if (history.length === 0 && !explicitHistoryClear.current) return;
        try {
            window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
        } catch (error) {
            console.error('Could not persist the history:', error);
        }
    }, [history, historyReady]);

    const selectView = React.useCallback((next: 'canvas' | 'history') => {
        setView(next);
        if (next === 'canvas') setCanvasMounted(true);
        try {
            window.localStorage.setItem(VIEW_KEY, next);
        } catch (error) {
            console.warn('Could not persist the view:', error);
        }
    }, []);

    const updateClientSettings = React.useCallback((next: ClientDefaults) => {
        setClientSettings(next);
        try {
            window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
        } catch (error) {
            console.warn('Could not persist the settings:', error);
        }
    }, []);

    const updatePassword = React.useCallback((hash: string | null) => {
        setClientPasswordHash(hash);
        try {
            if (hash) window.localStorage.setItem(PASSWORD_KEY, hash);
            else window.localStorage.removeItem(PASSWORD_KEY);
        } catch (error) {
            console.warn('Could not persist the password hash:', error);
        }
    }, []);

    const updateSkipDelete = React.useCallback((skip: boolean) => {
        setSkipDeleteConfirmation(skip);
        try {
            window.localStorage.setItem(SKIP_DELETE_KEY, String(skip));
        } catch (error) {
            console.warn('Could not persist the delete preference:', error);
        }
    }, []);

    // --- canvas registry ------------------------------------------------------------------------
    const persistRegistry = React.useCallback((next: CanvasMeta[], activeId: string) => {
        setCanvases(next);
        setActiveCanvasId(activeId);
        saveRegistry({ version: 1, activeId, canvases: next });
    }, []);

    const handleSelectCanvas = React.useCallback(
        (id: string) => {
            if (id === activeCanvasId) return;
            persistRegistry(canvases, id);
        },
        [activeCanvasId, canvases, persistRegistry]
    );

    const handleCreateCanvas = React.useCallback(() => {
        const meta = createCanvasMeta(t('Canvas {index}', { index: canvases.length + 1 }));
        persistRegistry([...canvases, meta], meta.id);
        notify(t('Created “{name}”.', { name: meta.name }), 'success');
    }, [canvases, notify, persistRegistry, t]);

    const handleRenameCanvas = React.useCallback(
        (id: string, name: string) => {
            persistRegistry(
                canvases.map((canvas) => (canvas.id === id ? { ...canvas, name, updatedAt: Date.now() } : canvas)),
                activeCanvasId
            );
        },
        [activeCanvasId, canvases, persistRegistry]
    );

    const handleDuplicateCanvas = React.useCallback(
        (id: string) => {
            const source = canvases.find((canvas) => canvas.id === id);
            if (!source) return;
            const meta = createCanvasMeta(`${source.name} ${t('copy')}`);
            saveCanvasNodes(meta.id, loadCanvasNodes(id));
            persistRegistry([...canvases, meta], meta.id);
            notify(t('Duplicated “{name}”.', { name: source.name }), 'success');
        },
        [canvases, notify, persistRegistry, t]
    );

    const handleDeleteCanvas = React.useCallback(
        (id: string) => {
            if (canvases.length <= 1) return;
            const target = canvases.find((canvas) => canvas.id === id);
            if (!target) return;
            if (!window.confirm(t('Delete the canvas “{name}”? Its pictures stay on disk.', { name: target.name }))) {
                return;
            }
            try {
                window.localStorage.removeItem(`gptImageCanvas:${id}`);
            } catch (error) {
                console.warn('Could not drop the canvas storage:', error);
            }
            const remaining = canvases.filter((canvas) => canvas.id !== id);
            persistRegistry(remaining, id === activeCanvasId ? remaining[0].id : activeCanvasId);
            notify(t('Deleted “{name}”.', { name: target.name }), 'info');
        },
        [activeCanvasId, canvases, notify, persistRegistry, t]
    );

    const handleCanvasSaved = React.useCallback(() => {
        setCanvasRevision((prev) => prev + 1);
    }, []);

    // --- history --------------------------------------------------------------------------------
    const getImageSrc = React.useCallback((filename: string) => `/api/image/${encodeURIComponent(filename)}`, []);

    const handleCanvasTaskComplete = React.useCallback((entry: HistoryMetadata) => {
        setHistory((prev) => [entry, ...prev]);
    }, []);

    const describeReferenceWarning = React.useCallback(
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

    const executeDelete = React.useCallback(
        async (item: HistoryMetadata) => {
            const filenames = item.images.map((image) => image.filename);
            try {
                const payload: { filenames: string[]; passwordHash?: string } = { filenames };
                if (clientPasswordHash) payload.passwordHash = clientPasswordHash;
                const response = await fetch('/api/image-delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await response.json();
                if (!response.ok) {
                    throw new Error(
                        result.error || t('API deletion failed with status {status}', { status: response.status })
                    );
                }
                setHistory((prev) => prev.filter((entry) => entry.timestamp !== item.timestamp));
                notify(t('Moved {count} file(s) to the trash.', { count: filenames.length }), 'info');
            } catch (error) {
                console.error('Deletion failed:', error);
                notify(
                    error instanceof Error ? error.message : t('An unexpected error occurred during deletion.'),
                    'error'
                );
            }
        },
        [clientPasswordHash, notify, t]
    );

    const handleClearHistory = React.useCallback(() => {
        if (
            !window.confirm(
                t(
                    'Are you sure you want to clear the entire image history? This only removes the records — the picture files stay on disk.'
                )
            )
        ) {
            return;
        }
        explicitHistoryClear.current = true;
        setHistory([]);
        try {
            window.localStorage.removeItem(HISTORY_KEY);
        } catch (error) {
            console.warn('Could not clear the stored history:', error);
        }
        notify(t('History cleared.'), 'info');
    }, [notify, t]);

    // --- disk cleanup ---------------------------------------------------------------------------
    const collectKeepList = React.useCallback((): string[] => {
        const keep = collectCanvasFilenames();
        history.forEach((entry) => entry.images.forEach((image) => keep.add(image.filename)));
        return Array.from(keep);
    }, [history]);

    const cleanupPayload = React.useCallback(
        () => ({
            keep: collectKeepList(),
            ...(clientPasswordHash ? { passwordHash: clientPasswordHash } : {})
        }),
        [clientPasswordHash, collectKeepList]
    );

    const handleCleanupUnusedImages = React.useCallback(async () => {
        try {
            const response = await fetch('/api/images-cleanup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...cleanupPayload(), dryRun: true })
            });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || t('Cleanup failed with status {status}', { status: response.status }));
            }
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
            console.error('Cleanup preview failed:', error);
            notify(error instanceof Error ? error.message : t('An unexpected error occurred.'), 'error');
        }
    }, [cleanupPayload, notify, t]);

    const confirmCleanup = React.useCallback(async () => {
        setIsCleaningUp(true);
        try {
            const response = await fetch('/api/images-cleanup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cleanupPayload())
            });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || t('Cleanup failed with status {status}', { status: response.status }));
            }
            notify(
                t('Deleted {count} file(s), freeing {size} MB.', {
                    count: result.deleted,
                    size: ((result.freedBytes ?? 0) / 1024 / 1024).toFixed(1)
                }),
                'success'
            );
            setCleanupPreview(null);
        } catch (error) {
            console.error('Cleanup failed:', error);
            notify(error instanceof Error ? error.message : t('An unexpected error occurred.'), 'error');
        } finally {
            setIsCleaningUp(false);
        }
    }, [cleanupPayload, notify, t]);

    const sendToCanvas = React.useCallback(
        (filename: string) => {
            setIncomingImages((prev) => ({ filenames: [filename], token: (prev?.token ?? 0) + 1 }));
            selectView('canvas');
        },
        [selectView]
    );

    return (
        <main className='flex min-h-screen flex-col items-center bg-slate-50 px-4 py-4 text-slate-900 md:px-8 lg:px-10'>
            <div className='mb-3 flex w-full max-w-screen-2xl items-start justify-between gap-3'>
                <div className='flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm'>
                    <button
                        type='button'
                        onClick={() => selectView('canvas')}
                        aria-pressed={view === 'canvas'}
                        className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] transition-colors ${
                            view === 'canvas'
                                ? 'bg-indigo-50 text-indigo-600'
                                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                        }`}>
                        <Workflow className='h-3.5 w-3.5' />
                        {t('Canvas')}
                    </button>
                    <button
                        type='button'
                        onClick={() => selectView('history')}
                        aria-pressed={view === 'history'}
                        className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] transition-colors ${
                            view === 'history'
                                ? 'bg-indigo-50 text-indigo-600'
                                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                        }`}>
                        <HistoryIcon className='h-3.5 w-3.5' />
                        {t('History')}
                    </button>
                </div>
                <div className='flex items-start gap-3'>
                    <ShutdownButton />
                    <LanguageToggle />
                </div>
            </div>

            {canvasMounted && (
                <div className={view === 'canvas' ? 'flex w-full max-w-screen-2xl gap-4' : 'hidden'}>
                    <CanvasSidebar
                        canvases={canvases}
                        activeId={activeCanvasId}
                        revision={canvasRevision}
                        collapsed={isCanvasListCollapsed}
                        onToggleCollapsed={() => setIsCanvasListCollapsed((prev) => !prev)}
                        onSelect={handleSelectCanvas}
                        onCreate={handleCreateCanvas}
                        onRename={handleRenameCanvas}
                        onDuplicate={handleDuplicateCanvas}
                        onDelete={handleDeleteCanvas}
                    />
                    <div className='relative min-w-0 flex-1'>
                        {activeCanvasId ? (
                            <CanvasBoard
                                key={activeCanvasId}
                                canvasId={activeCanvasId}
                                nodeDefaults={clientSettings}
                                onSaved={handleCanvasSaved}
                                incomingImages={incomingImages}
                                onIncomingImagesHandled={() => setIncomingImages(null)}
                                onTaskComplete={handleCanvasTaskComplete}
                                onNotify={notify}
                                passwordHash={clientPasswordHash}
                            />
                        ) : null}
                        <div className='absolute bottom-4 left-4 z-20'>
                            <SettingsButton
                                defaults={clientSettings}
                                onDefaultsChange={updateClientSettings}
                                onNotify={notify}
                                passwordHash={clientPasswordHash}
                                onPasswordChange={updatePassword}
                            />
                        </div>
                    </div>
                </div>
            )}

            {view === 'history' && (
                <HistoryGallery
                    history={history}
                    getImageSrc={getImageSrc}
                    describeReferenceWarning={describeReferenceWarning}
                    onDelete={executeDelete}
                    onClearHistory={handleClearHistory}
                    onCleanupUnusedImages={handleCleanupUnusedImages}
                    onSendToCanvas={sendToCanvas}
                    skipConfirm={skipDeleteConfirmation}
                    onSkipConfirmChange={updateSkipDelete}
                />
            )}

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
                                <li>… {t('and {count} more', { count: (cleanupPreview?.files.length ?? 0) - 5 })}</li>
                            )}
                        </ul>
                        <p className='text-slate-600'>
                            {t('Frees about {size} MB.', {
                                size: ((cleanupPreview?.bytes ?? 0) / 1024 / 1024).toFixed(1)
                            })}
                        </p>
                        <p className='text-slate-500'>
                            {t('Deleted files are moved to the trash folder and kept for {days} days.', { days: 30 })}
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
                            onClick={confirmCleanup}
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
        </main>
    );
}
