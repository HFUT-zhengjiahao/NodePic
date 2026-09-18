'use client';

import { CanvasBoard } from '@/components/canvas/canvas-board';
import { CanvasSidebar } from '@/components/canvas/canvas-sidebar';
import { HistoryGallery } from '@/components/history/history-gallery';
import { SettingsButton, type ClientDefaults } from '@/components/settings-button';
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

import * as React from 'react';

// ---------------------------------------------------------------------------------------------
// Types shared with the canvas nodes and the history page.
// ---------------------------------------------------------------------------------------------

export type HistoryImage = {
    filename: string;
};

export type HistoryMetadata = {
    timestamp: number;
    /** Set when the entry was reconstructed from the files on disk rather than from a real run. */
    rebuilt?: boolean;
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
const SIDEBAR_KEY = 'gptImageSidebarCollapsed';

const DEFAULT_CLIENT_SETTINGS: ClientDefaults = { model: DEFAULT_GPT_IMAGE_MODEL, quality: 'high', size: 'auto' };

export default function Home() {
    const { t } = useI18n();

    const [view, setView] = React.useState<'canvas' | 'history'>('canvas');
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
        retentionDays: number;
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
                setIsCanvasListCollapsed(window.localStorage.getItem(SIDEBAR_KEY) === 'true');
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

    /** The rail width is a layout preference, so it survives a reload like the rest of them. */
    const toggleSidebar = React.useCallback(() => {
        setIsCanvasListCollapsed((prev) => {
            const next = !prev;
            try {
                window.localStorage.setItem(SIDEBAR_KEY, String(next));
            } catch (error) {
                console.warn('Could not persist the sidebar state:', error);
            }
            return next;
        });
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

    // Mirrors `canvases` for callbacks that must not re-create themselves on every registry change.
    const activeCanvasIdRef = React.useRef('');
    React.useEffect(() => {
        activeCanvasIdRef.current = activeCanvasId;
    }, [activeCanvasId]);

    const canvasesRef = React.useRef<CanvasMeta[]>([]);
    React.useEffect(() => {
        canvasesRef.current = canvases;
    }, [canvases]);

    const handleCanvasSaved = React.useCallback(() => {
        setCanvasRevision((prev) => prev + 1);
        // Saving a node is an edit, so the sidebar's timestamp has to move with it — it used to show
        // the creation time forever because only renaming touched `updatedAt`.
        const next = canvasesRef.current.map((canvas) =>
            canvas.id === activeCanvasIdRef.current ? { ...canvas, updatedAt: Date.now() } : canvas
        );
        setCanvases(next);
        const registry = loadRegistry();
        saveRegistry({ ...registry, canvases: next, activeId: activeCanvasIdRef.current });
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
                untracked: result.untracked?.length ?? 0,
                retentionDays: result.trashRetentionDays ?? 30
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

    /**
     * Rebuilds history entries for pictures that exist on disk but have no record any more.
     *
     * The name carries the generation timestamp, so a lost entry can be reconstructed with a correct
     * time — and, just as importantly, the file stops looking unreferenced to the cleanup pass.
     */
    const rebuildHistoryFromDisk = React.useCallback(async () => {
        try {
            const response = await fetch('/api/images-list', { cache: 'no-store' });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`);

            const known = new Set(history.flatMap((entry) => entry.images.map((image) => image.filename)));
            const missing = (payload.files as Array<{ filename: string; modifiedAt: number }>).filter(
                (file) => !known.has(file.filename)
            );

            if (missing.length === 0) {
                notify(t('History already covers every picture on disk.'), 'info');
                return;
            }

            const timestampOf = (filename: string, fallback: number) => {
                const match = filename.match(/(?:upload-)?(\d{13})/);
                return match ? Number(match[1]) : fallback;
            };

            const rebuilt: HistoryMetadata[] = missing.map((file) => ({
                timestamp: timestampOf(file.filename, file.modifiedAt),
                images: [{ filename: file.filename }],
                storageModeUsed: 'fs',
                durationMs: 0,
                quality: 'high',
                background: 'auto',
                moderation: 'auto',
                prompt: '',
                mode: file.filename.startsWith('upload-') ? 'generate' : 'generate',
                costDetails: null,
                output_format: (file.filename.split('.').pop() ?? 'png') as HistoryMetadata['output_format'],
                model: undefined,
                rebuilt: true
            }));

            setHistory((prev) => [...rebuilt, ...prev].sort((a, b) => b.timestamp - a.timestamp));
            notify(t('Recovered {count} picture(s) from disk.', { count: rebuilt.length }), 'success');
        } catch (error) {
            console.error('Could not rebuild the history from disk:', error);
            notify(error instanceof Error ? error.message : t('An unexpected error occurred.'), 'error');
        }
    }, [history, notify, t]);

    const sendToCanvas = React.useCallback(
        (filename: string) => {
            setIncomingImages((prev) => ({ filenames: [filename], token: (prev?.token ?? 0) + 1 }));
            selectView('canvas');
        },
        [selectView]
    );

    return (
        <main
            className={`flex min-h-screen flex-col items-center bg-slate-50 py-2 text-slate-900 ${
                // A collapsed rail is only a few icons wide, so the page keeps its generous padding for
                // the expanded list but hands the space back to the board when the rail is folded away.
                isCanvasListCollapsed ? 'px-2 md:px-3' : 'px-4 md:px-8 lg:px-10'
            }`}>
            {/* One layout for both views. The sidebar used to be rendered twice — once inside a flex
                row for the canvas, once as a block above the gallery — which is why the history page
                ended up pushed underneath it. */}
            <div className={`flex w-full max-w-screen-2xl items-start ${isCanvasListCollapsed ? 'gap-2' : 'gap-4'}`}>
                <CanvasSidebar
                    view={view}
                    onViewChange={selectView}
                    canvases={canvases}
                    activeId={activeCanvasId}
                    revision={canvasRevision}
                    collapsed={isCanvasListCollapsed}
                    onToggleCollapsed={toggleSidebar}
                    onSelect={(id) => {
                        handleSelectCanvas(id);
                        selectView('canvas');
                    }}
                    onCreate={handleCreateCanvas}
                    onRename={handleRenameCanvas}
                    onDuplicate={handleDuplicateCanvas}
                    onDelete={handleDeleteCanvas}
                    footer={
                        <SettingsButton
                            defaults={clientSettings}
                            onDefaultsChange={updateClientSettings}
                            onNotify={notify}
                            passwordHash={clientPasswordHash}
                            onPasswordChange={updatePassword}
                            compact={isCanvasListCollapsed}
                        />
                    }
                />

                {/* Hidden rather than unmounted: a running queue and the undo stack must survive a
                    trip to the history page. */}
                <div className={view === 'canvas' ? 'relative min-w-0 flex-1' : 'hidden'}>
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
                </div>

                {view === 'history' && (
                    <div className='min-w-0 flex-1'>
                        <HistoryGallery
                            history={history}
                            getImageSrc={getImageSrc}
                            describeReferenceWarning={describeReferenceWarning}
                            onDelete={executeDelete}
                            onClearHistory={handleClearHistory}
                            onCleanupUnusedImages={handleCleanupUnusedImages}
                            onRebuildFromDisk={rebuildHistoryFromDisk}
                            onSendToCanvas={sendToCanvas}
                            skipConfirm={skipDeleteConfirmation}
                            onSkipConfirmChange={updateSkipDelete}
                        />
                    </div>
                )}
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
                                <li>… {t('and {count} more', { count: (cleanupPreview?.files.length ?? 0) - 5 })}</li>
                            )}
                        </ul>
                        <p className='text-slate-600'>
                            {t('Frees about {size} MB.', {
                                size: ((cleanupPreview?.bytes ?? 0) / 1024 / 1024).toFixed(1)
                            })}
                        </p>
                        <p className='text-slate-500'>
                            {t('Deleted files are moved to the trash folder and kept for {days} days.', {
                                days: cleanupPreview?.retentionDays ?? 30
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
