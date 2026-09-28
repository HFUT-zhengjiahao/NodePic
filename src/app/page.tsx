'use client';

import { CanvasBoard } from '@/components/canvas/canvas-board';
import { CanvasSidebar } from '@/components/canvas/canvas-sidebar';
import { CanvasTrash } from '@/components/canvas/canvas-trash';
import { ErrorBoundary } from '@/components/error-boundary';
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
import { collectCanvasFilenames, countCanvasReferencesFor, findCanvasReferences } from '@/lib/canvas-refs';
import {
    createCanvasMeta,
    loadCanvasNodes,
    loadCanvasTrash,
    loadRegistry,
    reportStorageWriteFailure,
    saveCanvasNodes,
    saveCanvasTrash,
    saveRegistry,
    setStorageErrorSink,
    type CanvasMeta,
    type TrashedCanvas
} from '@/lib/canvas-store';
import { cancelCanvasRuns, setCanvasRunCompletionSink } from '@/lib/canvas-runs';
import { deleteMasksForCanvas, deleteMasksForFilenames, migrateLegacyMasks } from '@/lib/mask-store';
import { useI18n } from '@/lib/i18n';
import { imageUrl } from '@/lib/image-url';
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

const DEFAULT_CLIENT_SETTINGS: ClientDefaults = {
    model: DEFAULT_GPT_IMAGE_MODEL,
    quality: 'high',
    size: 'auto'
};

export default function Home() {
    const { t } = useI18n();
    /**
     * The restore effect must run exactly once, so it cannot depend on `t` — but it names the first
     * canvas, and that name has to follow the language. A ref keeps both true.
     */
    const tRef = React.useRef(t);
    React.useEffect(() => {
        tRef.current = t;
    }, [t]);

    const [view, setView] = React.useState<'canvas' | 'history' | 'trash'>('canvas');
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
    /**
     * Pending destructive action, shown in an in-app dialog instead of window.confirm.
     *
     * One dialog serves every case — trashing a canvas, removing one from the bin for good, emptying
     * the bin — because they differ only in wording and in what `run` does.
     */
    const [pendingConfirm, setPendingConfirm] = React.useState<{
        title: string;
        body: string;
        confirmLabel: string;
        run: () => void;
    } | null>(null);
    /** Canvas recycle bin, newest deletion first. */
    const [canvasTrash, setCanvasTrash] = React.useState<TrashedCanvas[]>([]);
    /** Flips once the stored history has been read, so nothing is written before that. */
    const [historyReady, setHistoryReady] = React.useState(false);
    /** Browser storage has been read, so `clientPasswordHash` holds its final value. */
    const [storageRestored, setStorageRestored] = React.useState(false);
    /**
     * Flips once the list has actually been changed by the user.
     *
     * "Never persist an empty list" protects against writing the initial empty array over a stored
     * history, but it also meant deleting the last entry by hand was never saved — everything came
     * back on reload. Tracking real mutations lets both cases through.
     */
    const historyMutated = React.useRef(false);


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
                if (storedView === 'history' || storedView === 'canvas' || storedView === 'trash') setView(storedView);

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

                const registry = loadRegistry(tRef.current('Canvas {index}', { index: 1 }));
                setCanvases(registry.canvases);
                setActiveCanvasId(registry.activeId);
                setCanvasTrash(loadCanvasTrash());
                setStorageRestored(true);
                // Masks used to be keyed by node id; they are addressed by source picture now, and the
                // registry above is what maps the old rows onto theirs. Runs once — afterwards the
                // legacy store is empty.
                void migrateLegacyMasks();
            } catch (error) {
                console.error('Could not restore the workspace state:', error);
            }
        });
    }, []);

    /**
     * Hands the server the password hash once, out of band.
     *
     * GET requests (`<img src>`, the settings panel) cannot carry a body, so they authenticate from
     * an httpOnly cookie instead. Without this the hash would have to ride in the URL, where it ends
     * up in browser history and access logs.
     */
    React.useEffect(() => {
        if (!storageRestored) return;
        void fetch('/api/auth-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ passwordHash: clientPasswordHash })
        }).catch((error) => console.warn('Could not establish the auth cookie:', error));
    }, [clientPasswordHash, storageRestored]);

    /**
     * Storage that silently stopped working is worse than storage that says so.
     *
     * The canvas writes through lib/canvas-store, which reports failures here. Nothing is dropped to
     * make room: the app has no business deleting the user's work, so it says what happened and lets
     * them decide (export, then delete old canvases for good).
     */
    React.useEffect(() => {
        setStorageErrorSink((kind) => {
            // One translator call per message, each with its literal as the direct argument: the i18n
            // checker only reads literals passed straight to the translator, so a string buried in a
            // ternary would be invisible to it and ship untranslated.
            const text =
                kind === 'quota'
                    ? tRef.current(
                          'The browser’s storage is full — the last change was not saved. Export anything you need, then delete old canvases for good.'
                      )
                    : tRef.current('The browser refused to save — the last change may be lost when you reload.');
            setToast({ text, tone: 'error' });
        });
        return () => setStorageErrorSink(null);
    }, []);

    React.useEffect(() => {
        // Writing before the stored history has been read would replace it with the initial empty
        // array — the exact way this list was wiped once already.
        if (!historyReady) return;
        if (history.length === 0 && !historyMutated.current) return;
        try {
            window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
        } catch (error) {
            reportStorageWriteFailure(error, HISTORY_KEY);
        }
    }, [history, historyReady]);

    const selectView = React.useCallback((next: 'canvas' | 'history' | 'trash') => {
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

    /**
     * Moves a canvas into the recycle bin instead of erasing it.
     *
     * The board leaves the sidebar, but its nodes travel to the bin whole, so "delete" is reversible
     * and the pictures the canvas was holding never become unreferenced files nobody can reach.
     */
    const moveCanvasToTrash = React.useCallback(
        (target: CanvasMeta) => {
            const nodes = loadCanvasNodes(target.id);
            const nextTrash = [
                { meta: target, nodes, deletedAt: Date.now() },
                ...canvasTrash.filter((entry) => entry.meta.id !== target.id)
            ];
            setCanvasTrash(nextTrash);
            saveCanvasTrash(nextTrash);
            const remaining = canvases.filter((canvas) => canvas.id !== target.id);
            // `remaining[0]` is the fallback only while a canvas is left; the sidebar keeps one
            // canvas undeletable, but relying on that from here would turn a UI rule into a crash.
            persistRegistry(remaining, target.id === activeCanvasId ? (remaining[0]?.id ?? '') : activeCanvasId);
            notify(t('Moved “{name}” to the recycle bin.', { name: target.name }), 'info');
            // Two things are deliberately left alone here:
            //  * the masks in IndexedDB — a restore has to bring the painted mask back, and they are
            //    keyed by node id, which survives the trip (they are dropped when the canvas is);
            //  * the `gptImageCanvas:<id>` node list — the board of a just-deleted canvas still writes
            //    it back while it unmounts, and a second copy of a canvas that can still be restored
            //    costs a few kilobytes. It is removed together with the bin entry.
        },
        [activeCanvasId, canvases, canvasTrash, notify, persistRegistry, t]
    );

    /**
     * Asks in the app's own dialog rather than window.confirm.
     *
     * A native confirm is not what the rest of the workspace uses, it cannot be styled or translated
     * consistently, and on a page this wide it lands in a corner of the screen far from the sidebar
     * row the user just clicked.
     */
    const handleDeleteCanvas = React.useCallback(
        (id: string) => {
            if (canvases.length <= 1) return;
            const target = canvases.find((canvas) => canvas.id === id);
            if (!target) return;
            setPendingConfirm({
                title: t('Delete canvas'),
                body: t('Move “{name}” to the recycle bin? Its pictures stay on disk, and you can restore it later.', {
                    name: target.name
                }),
                confirmLabel: t('Move to the recycle bin'),
                run: () => moveCanvasToTrash(target)
            });
        },
        [canvases, moveCanvasToTrash, t]
    );

    const restoreCanvas = React.useCallback(
        (id: string) => {
            const entry = canvasTrash.find((item) => item.meta.id === id);
            if (!entry) return;

            // The node list in storage is usually a little newer than the snapshot in the bin: the
            // board keeps writing it until it unmounts, which happens after the canvas left the
            // registry. Prefer whichever copy actually holds more nodes.
            const stored = loadCanvasNodes(entry.meta.id);
            const nodes = stored.length >= entry.nodes.length ? stored : entry.nodes;
            saveCanvasNodes(entry.meta.id, nodes);

            const nextTrash = canvasTrash.filter((item) => item.meta.id !== id);
            setCanvasTrash(nextTrash);
            saveCanvasTrash(nextTrash);
            persistRegistry([...canvases, { ...entry.meta, updatedAt: Date.now() }], entry.meta.id);
            selectView('canvas');
            notify(t('Restored “{name}”.', { name: entry.meta.name }), 'success');
        },
        [canvases, canvasTrash, notify, persistRegistry, selectView, t]
    );

    /**
     * Pictures that only the given bin entries still need.
     *
     * A canvas' pictures are not necessarily its own: every generated file also has a history entry,
     * and another board (or another bin entry) may use the same picture as a source. Only files that
     * nothing else points at may follow the canvas out — the rest would break boards that are still
     * in use. The history entries of the doomed files go with them, so the gallery never ends up
     * listing records whose picture no longer exists.
     */
    const filesToErase = React.useCallback(
        (entries: TrashedCanvas[]) => {
            const doomed = new Set<string>();
            for (const entry of entries) collectCanvasFilenames({ nodes: entry.nodes }).forEach((name) => doomed.add(name));
            if (doomed.size === 0) return [] as string[];

            const doomedIds = new Set(entries.map((entry) => entry.meta.id));
            for (const canvas of canvases) {
                if (doomedIds.has(canvas.id)) continue;
                collectCanvasFilenames({ nodes: loadCanvasNodes(canvas.id) }).forEach((name) => doomed.delete(name));
            }
            for (const entry of canvasTrash) {
                if (doomedIds.has(entry.meta.id)) continue;
                collectCanvasFilenames({ nodes: entry.nodes }).forEach((name) => doomed.delete(name));
            }
            return Array.from(doomed);
        },
        [canvases, canvasTrash]
    );

    /** Removes bin entries for good: their exclusive pictures leave the disk, nothing else does. */
    const eraseCanvases = React.useCallback(
        async (entries: TrashedCanvas[]) => {
            if (entries.length === 0) return;
            const filenames = filesToErase(entries);
            const gone = new Set<string>();
            let freedBytes = 0;

            try {
                if (filenames.length > 0) {
                    const payload: { filenames: string[]; permanent: boolean; passwordHash?: string } = {
                        filenames,
                        permanent: true
                    };
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
                    freedBytes = Number(result.freedBytes) || 0;
                    for (const item of (result.results ?? []) as Array<{ filename: string; success: boolean }>) {
                        if (item.success) gone.add(item.filename);
                    }
                }

                if (gone.size > 0) {
                    const stale = history.filter((item) => item.images.every((image) => gone.has(image.filename)));
                    if (stale.length > 0) {
                        const stamps = new Set(stale.map((item) => item.timestamp));
                        historyMutated.current = true;
                        setHistory((prev) => prev.filter((item) => !stamps.has(item.timestamp)));
                    }
                }

                const doomedIds = new Set(entries.map((entry) => entry.meta.id));
                const erasedIds = Array.from(doomedIds);

                // Masks are addressed by canvas + source picture, so each canvas takes its own with it
                // and the pictures that just left the disk take theirs — node ids are not involved.
                erasedIds.forEach((id) => void deleteMasksForCanvas(id));
                if (gone.size > 0) {
                    void deleteMasksForFilenames(Array.from(gone));
                }

                // A run still in flight for a canvas that is being erased would write its storage key
                // back and land on a board that no longer exists. Queued work is dropped before it is
                // ever sent, so it is never billed.
                erasedIds.forEach((id) => cancelCanvasRuns(id));

                const nextTrash = canvasTrash.filter((entry) => !doomedIds.has(entry.meta.id));
                setCanvasTrash(nextTrash);
                saveCanvasTrash(nextTrash);
                for (const id of doomedIds) {
                    try {
                        window.localStorage.removeItem(`gptImageCanvas:${id}`);
                    } catch (error) {
                        console.warn('Could not drop the canvas storage:', error);
                    }
                }

                notify(
                    gone.size > 0
                        ? t(
                              'Removed {count} canvas(es) for good and deleted {files} picture file(s) from disk, freeing {size} MB.',
                              {
                                  count: entries.length,
                                  files: gone.size,
                                  size: (freedBytes / 1024 / 1024).toFixed(1)
                              }
                          )
                        : t('Removed {count} canvas(es) for good. Their pictures are still used elsewhere, so no file was deleted.', {
                              count: entries.length
                          }),
                    'success'
                );
            } catch (error) {
                console.error('Permanent canvas deletion failed:', error);
                notify(error instanceof Error ? error.message : t('An unexpected error occurred during deletion.'), 'error');
            }
        },
        [canvasTrash, clientPasswordHash, filesToErase, history, notify, t]
    );

    const askDeleteForever = React.useCallback(
        (id: string) => {
            const entry = canvasTrash.find((item) => item.meta.id === id);
            if (!entry) return;
            const doomed = filesToErase([entry]);
            setPendingConfirm({
                title: t('Delete canvas for good'),
                body:
                    doomed.length > 0
                        ? t(
                              'Delete “{name}” for good? {count} picture file(s) that only this canvas uses will be removed from the disk, together with their history entries. This cannot be undone.',
                              { name: entry.meta.name, count: doomed.length }
                          )
                        : t(
                              'Delete “{name}” for good? Its pictures are still used by another canvas, so only the canvas itself is removed.',
                              { name: entry.meta.name }
                          ),
                confirmLabel: t('Delete for good'),
                run: () => void eraseCanvases([entry])
            });
        },
        [canvasTrash, eraseCanvases, filesToErase, t]
    );

    const askEmptyTrash = React.useCallback(() => {
        if (canvasTrash.length === 0) return;
        const doomed = filesToErase(canvasTrash);
        setPendingConfirm({
            title: t('Empty the recycle bin'),
            body:
                doomed.length > 0
                    ? t(
                          'Empty the recycle bin? {count} canvas(es) will be removed for good, along with {files} picture file(s) only they use. This cannot be undone.',
                          { count: canvasTrash.length, files: doomed.length }
                      )
                    : t('Empty the recycle bin? {count} canvas(es) will be removed for good.', {
                          count: canvasTrash.length
                      }),
            confirmLabel: t('Empty the recycle bin'),
            run: () => void eraseCanvases(canvasTrash)
        });
    }, [canvasTrash, eraseCanvases, filesToErase, t]);

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
        // The default name is passed in because this runs long after the restore above: a registry
        // created here (first save with no stored list) would otherwise be named in English.
        const registry = loadRegistry(tRef.current('Canvas {index}', { index: 1 }));
        saveRegistry({ ...registry, canvases: next, activeId: activeCanvasIdRef.current });
    }, []);

    // --- history --------------------------------------------------------------------------------
    const getImageSrc = React.useCallback((filename: string) => imageUrl(filename), []);

    const handleCanvasTaskComplete = React.useCallback((entry: HistoryMetadata) => {
        setHistory((prev) => [entry, ...prev]);
    }, []);

    /**
     * The run manager, not the board, reports finished tasks.
     *
     * Switching canvas remounts the board, so a run that finishes while the user is elsewhere has no
     * board to report to — and its history entry used to be lost with it. The runner survives that,
     * so it owns the reporting and the page just supplies the sink.
     */
    React.useEffect(() => {
        setCanvasRunCompletionSink(handleCanvasTaskComplete);
        return () => setCanvasRunCompletionSink(null);
    }, [handleCanvasTaskComplete]);

    const describeReferenceWarning = React.useCallback(
        (item: HistoryMetadata): string | null => {
            const referenced = findCanvasReferences(item.images.map((image) => image.filename));
            if (referenced.length === 0) return null;
            const counts = countCanvasReferencesFor(referenced);
            const nodeCount = referenced.reduce((total, filename) => total + (counts.get(filename) ?? 0), 0);
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
                historyMutated.current = true;
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

    const clearHistoryNow = React.useCallback(() => {
        historyMutated.current = true;
        setHistory([]);
        try {
            window.localStorage.removeItem(HISTORY_KEY);
        } catch (error) {
            console.warn('Could not clear the stored history:', error);
        }
        notify(t('History cleared.'), 'info');
    }, [notify, t]);

    /**
     * Clearing the history is destructive and used to be the one place still asking with a native
     * `window.confirm` — a dialog the browser owns, that blocks the whole tab, and that none of the
     * other destructive actions in this app use any more.
     */
    const handleClearHistory = React.useCallback(() => {
        if (history.length === 0) {
            notify(t('The history is already empty.'), 'info');
            return;
        }
        setPendingConfirm({
            title: t('Clear history'),
            body: t(
                'Clear the entire image history? This only removes the records — the picture files stay on disk.'
            ),
            confirmLabel: t('Clear history'),
            run: clearHistoryNow
        });
    }, [clearHistoryNow, history.length, notify, t]);

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
                mode: 'generate',
                costDetails: null,
                // Extension, not the API's own vocabulary: `jpg` is not a valid output_format.
                output_format: (file.filename.split('.').pop() ?? 'png').toLowerCase().replace(/^jpg$/, 'jpeg') as HistoryMetadata['output_format'],
                model: undefined,
                rebuilt: true
            }));

            historyMutated.current = true;
            setHistory((prev) => [...rebuilt, ...prev].sort((a, b) => b.timestamp - a.timestamp));
            notify(t('Recovered {count} picture(s) from disk.', { count: rebuilt.length }), 'success');
        } catch (error) {
            console.error('Could not rebuild the history from disk:', error);
            notify(error instanceof Error ? error.message : t('An unexpected error occurred.'), 'error');
        }
    }, [history, notify, t]);

    /**
     * Takes a whole entry, not one picture.
     *
     * It used to be called once per image, and React's batching kept only the last `setState`, so a
     * four-image entry arrived as a single node while the toast still said "added 4".
     */
    const sendToCanvas = React.useCallback(
        (filenames: string[]) => {
            if (filenames.length === 0) return;
            setIncomingImages((prev) => ({ filenames, token: (prev?.token ?? 0) + 1 }));
            selectView('canvas');
        },
        [selectView]
    );

    return (
        <main
            className={`flex min-h-screen flex-col items-center bg-slate-50 py-2 text-slate-900 ${
                // A collapsed rail is only a few icons wide, so the page keeps its generous padding for
                // the expanded list but hands the space back to the board when the rail is folded away.
                isCanvasListCollapsed ? 'px-2 md:px-3' : 'px-3 md:px-4'
            }`}>
            {/* One layout for both views. The sidebar used to be rendered twice — once inside a flex
                row for the canvas, once as a block above the gallery — which is why the history page
                ended up pushed underneath it. */}
            <div className={`flex w-full max-w-screen-2xl items-start ${isCanvasListCollapsed ? 'gap-2' : 'gap-3'}`}>
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
                    trashCount={canvasTrash.length}
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
                        <ErrorBoundary title={t('This view failed to render.')} retryLabel={t('Try again')}>
                        <CanvasBoard
                            key={activeCanvasId}
                            canvasId={activeCanvasId}
                            nodeDefaults={clientSettings}
                            onSaved={handleCanvasSaved}
                            incomingImages={incomingImages}
                            onIncomingImagesHandled={() => setIncomingImages(null)}
                            onNotify={notify}
                            passwordHash={clientPasswordHash}
                            active={view === 'canvas'}
                        />
                        </ErrorBoundary>
                    ) : null}
                </div>

                {view === 'history' && (
                    <div className='min-w-0 flex-1'>
                        <ErrorBoundary title={t('This view failed to render.')} retryLabel={t('Try again')}>
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
                        </ErrorBoundary>
                    </div>
                )}

                {view === 'trash' && (
                    <div className='min-w-0 flex-1'>
                        <ErrorBoundary title={t('This view failed to render.')} retryLabel={t('Try again')}>
                            <CanvasTrash
                                entries={canvasTrash}
                                onRestore={restoreCanvas}
                                onDeleteForever={askDeleteForever}
                                onEmpty={askEmptyTrash}
                            />
                        </ErrorBoundary>
                    </div>
                )}
            </div>

            <Dialog open={!!pendingConfirm} onOpenChange={(open) => !open && setPendingConfirm(null)}>
                <DialogContent className='border-slate-200 bg-white text-slate-900 sm:max-w-[460px]'>
                    <DialogHeader>
                        <DialogTitle className='text-base'>{pendingConfirm?.title}</DialogTitle>
                        <DialogDescription className='pt-1 leading-relaxed text-slate-600'>
                            {pendingConfirm?.body}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className='gap-2 sm:justify-end'>
                        <Button
                            type='button'
                            variant='outline'
                            size='sm'
                            onClick={() => setPendingConfirm(null)}
                            className='border-slate-300 text-slate-600 hover:bg-slate-200 hover:text-slate-900'>
                            {t('Cancel')}
                        </Button>
                        <Button
                            type='button'
                            size='sm'
                            onClick={() => {
                                const action = pendingConfirm?.run;
                                setPendingConfirm(null);
                                action?.();
                            }}
                            className='bg-red-600 text-white hover:bg-red-500'>
                            {pendingConfirm?.confirmLabel ?? t('Confirm')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

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
