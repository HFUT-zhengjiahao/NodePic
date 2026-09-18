'use client';

import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useI18n } from '@/lib/i18n';
import { GPT_IMAGE_MODELS, type GptImageModel, type ImageQuality } from '@/lib/models';
import type { SizePreset } from '@/lib/size-utils';
import { FolderOpen, Settings as SettingsIcon } from 'lucide-react';
import * as React from 'react';

export type ClientDefaults = {
    model: GptImageModel;
    quality: ImageQuality;
    size: SizePreset;
};

const SIZE_CHOICES: SizePreset[] = ['auto', 'square', 'landscape', 'portrait'];

type ServerSettingsState = {
    outputDir: string;
    trashRetentionDays: number;
    resolvedOutputDir: string;
    fileCount: number;
    totalBytes: number;
};

const QUALITY_CHOICES: ImageQuality[] = ['auto', 'low', 'medium', 'high'];

/** Gear button that lives in the bottom-left corner of the canvas. */
export function SettingsButton({
    defaults,
    onDefaultsChange,
    onNotify,
    passwordHash,
    onPasswordChange
}: {
    defaults: ClientDefaults;
    onDefaultsChange: (next: ClientDefaults) => void;
    onNotify: (text: string, tone?: 'info' | 'success' | 'error') => void;
    passwordHash?: string | null;
    onPasswordChange?: (hash: string | null) => void;
}) {
    const { t } = useI18n();
    const [open, setOpen] = React.useState(false);
    const [server, setServer] = React.useState<ServerSettingsState | null>(null);
    const [draftDir, setDraftDir] = React.useState('');
    const [retentionDraft, setRetentionDraft] = React.useState('30');
    const [moveExisting, setMoveExisting] = React.useState(true);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const load = React.useCallback(async () => {
        try {
            // The endpoint reports absolute paths, so it is gated like the write routes are.
            const query = passwordHash ? `?passwordHash=${encodeURIComponent(passwordHash)}` : '';
            const response = await fetch(`/api/settings${query}`, { cache: 'no-store' });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`);
            setServer({
                outputDir: payload.settings.outputDir,
                trashRetentionDays: payload.settings.trashRetentionDays,
                resolvedOutputDir: payload.resolvedOutputDir,
                fileCount: payload.fileCount,
                totalBytes: payload.totalBytes
            });
            setDraftDir(payload.settings.outputDir);
            setRetentionDraft(String(payload.settings.trashRetentionDays));
            setError(null);
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
    }, []);



    const saveDirectory = React.useCallback(async () => {
        if (!draftDir.trim() || draftDir.trim() === server?.outputDir) return;
        setBusy(true);
        try {
            const response = await fetch('/api/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    outputDir: draftDir.trim(),
                    moveExisting,
                    ...(passwordHash ? { passwordHash } : {})
                })
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`);
            onNotify(
                t('Pictures now live in {dir} ({moved} moved).', {
                    dir: payload.settings.outputDir,
                    moved: payload.moved
                }),
                'success'
            );
            await load();
        } catch (saveError) {
            const message = saveError instanceof Error ? saveError.message : String(saveError);
            setError(message);
            onNotify(message, 'error');
        } finally {
            setBusy(false);
        }
    }, [draftDir, load, moveExisting, onNotify, passwordHash, server?.outputDir, t]);

    const saveRetention = React.useCallback(async () => {
        const value = Number(retentionDraft);
        if (!Number.isFinite(value) || value < 1 || value > 3650 || value === server?.trashRetentionDays) return;
        setBusy(true);
        try {
            const response = await fetch('/api/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    trashRetentionDays: Math.floor(value),
                    ...(passwordHash ? { passwordHash } : {})
                })
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`);
            onNotify(t('Trash retention set to {days} days.', { days: payload.settings.trashRetentionDays }), 'success');
            await load();
        } catch (saveError) {
            const message = saveError instanceof Error ? saveError.message : String(saveError);
            setError(message);
            onNotify(message, 'error');
        } finally {
            setBusy(false);
        }
    }, [load, onNotify, passwordHash, retentionDraft, server?.trashRetentionDays, t]);

    const megabytes = server ? (server.totalBytes / 1024 / 1024).toFixed(1) : '0';
    const [passwordDraft, setPasswordDraft] = React.useState('');
    const [savingPassword, setSavingPassword] = React.useState(false);

    const savePassword = React.useCallback(async () => {
        if (!onPasswordChange) return;
        setSavingPassword(true);
        try {
            if (!passwordDraft.trim()) {
                onPasswordChange(null);
                onNotify(t('Access password cleared.'), 'info');
            } else {
                const data = new TextEncoder().encode(passwordDraft);
                const digest = await crypto.subtle.digest('SHA-256', data);
                const hash = Array.from(new Uint8Array(digest))
                    .map((byte) => byte.toString(16).padStart(2, '0'))
                    .join('');
                onPasswordChange(hash);
                onNotify(t('Access password saved in this browser.'), 'success');
            }
            setPasswordDraft('');
        } finally {
            setSavingPassword(false);
        }
    }, [onNotify, onPasswordChange, passwordDraft, t]);

    return (
        <>
            <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() => {
                    setOpen(true);
                    void load();
                }}
                className='border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-100 hover:text-slate-900'
                title={t('Settings')}>
                <SettingsIcon className='mr-1.5 h-4 w-4' />
                {t('Settings')}
            </Button>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className='max-h-[88vh] overflow-y-auto border-slate-200 bg-white text-slate-900 sm:max-w-[540px]'>
                    <DialogHeader>
                        <DialogTitle className='flex items-center gap-2 text-base'>
                            <SettingsIcon className='h-4 w-4 text-indigo-500' />
                            {t('Settings')}
                        </DialogTitle>
                        <DialogDescription className='text-slate-500'>
                            {t('Where pictures are stored, and what new nodes start with.')}
                        </DialogDescription>
                    </DialogHeader>

                    <section className='space-y-3 border-t border-slate-100 pt-4'>
                        <div className='flex items-center gap-2'>
                            <FolderOpen className='h-4 w-4 text-slate-400' />
                            <h3 className='text-[13px] font-semibold text-slate-800'>{t('Image folder')}</h3>
                        </div>

                        <div className='space-y-1.5'>
                            <Label htmlFor='settings-output-dir' className='text-[12px] text-slate-600'>
                                {t('Folder path (relative paths sit next to the project)')}
                            </Label>
                            <div className='flex gap-2'>
                                <Input
                                    id='settings-output-dir'
                                    value={draftDir}
                                    onChange={(event) => setDraftDir(event.target.value)}
                                    placeholder='generated-images'
                                    className='border-slate-200 bg-white text-[13px]'
                                />
                                <Button
                                    type='button'
                                    size='sm'
                                    disabled={busy || !draftDir.trim() || draftDir.trim() === server?.outputDir}
                                    onClick={saveDirectory}
                                    className='bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-slate-200 disabled:text-slate-400'>
                                    {busy ? t('Saving…') : t('Apply')}
                                </Button>
                            </div>
                        </div>

                        <label className='flex items-center gap-2 text-[12px] text-slate-600'>
                            <input
                                type='checkbox'
                                checked={moveExisting}
                                onChange={(event) => setMoveExisting(event.target.checked)}
                                className='h-3.5 w-3.5 accent-indigo-600'
                            />
                            {t('Move the existing pictures into the new folder')}
                        </label>

                        {server && (
                            <div className='space-y-0.5 rounded-lg bg-slate-50 px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-500'>
                                <p>{server.resolvedOutputDir}</p>
                                <p>
                                    {t('{count} file(s) · {size} MB', { count: server.fileCount, size: megabytes })}
                                </p>
                            </div>
                        )}
                        <p className='text-[11px] text-slate-400'>
                            {t(
                                'Pictures are referenced by file name, so moving the folder keeps every canvas working.'
                            )}
                        </p>

                        <div className='space-y-1.5 pt-1'>
                            <Label htmlFor='settings-retention' className='text-[12px] text-slate-600'>
                                {t('Deleted pictures stay recoverable for (days)')}
                            </Label>
                            <div className='flex gap-2'>
                                <Input
                                    id='settings-retention'
                                    type='number'
                                    min={1}
                                    max={3650}
                                    value={retentionDraft}
                                    onChange={(event) => setRetentionDraft(event.target.value)}
                                    className='w-28 border-slate-200 bg-white text-[13px]'
                                />
                                <Button
                                    type='button'
                                    size='sm'
                                    disabled={busy}
                                    onClick={() => void saveRetention()}
                                    className='bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-slate-200 disabled:text-slate-400'>
                                    {busy ? t('Saving…') : t('Apply')}
                                </Button>
                            </div>
                        </div>
                    </section>

                    <section className='space-y-3 border-t border-slate-100 pt-4'>
                        <h3 className='text-[13px] font-semibold text-slate-800'>{t('New node defaults')}</h3>
                        <div className='grid grid-cols-3 gap-3'>
                            <div className='space-y-1.5'>
                                <Label htmlFor='settings-model' className='text-[12px] text-slate-600'>
                                    {t('Model')}
                                </Label>
                                <select
                                    id='settings-model'
                                    value={defaults.model}
                                    onChange={(event) =>
                                        onDefaultsChange({ ...defaults, model: event.target.value as GptImageModel })
                                    }
                                    className='h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-[13px] text-slate-800'>
                                    {GPT_IMAGE_MODELS.map((model) => (
                                        <option key={model} value={model}>
                                            {model}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className='space-y-1.5'>
                                <Label htmlFor='settings-size' className='text-[12px] text-slate-600'>
                                    {t('Size')}
                                </Label>
                                <select
                                    id='settings-size'
                                    value={defaults.size}
                                    onChange={(event) =>
                                        onDefaultsChange({ ...defaults, size: event.target.value as SizePreset })
                                    }
                                    className='h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-[13px] text-slate-800'>
                                    {SIZE_CHOICES.map((size) => (
                                        <option key={size} value={size}>
                                            {t(size.charAt(0).toUpperCase() + size.slice(1))}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className='space-y-1.5'>
                                <Label htmlFor='settings-quality' className='text-[12px] text-slate-600'>
                                    {t('Quality')}
                                </Label>
                                <select
                                    id='settings-quality'
                                    value={defaults.quality}
                                    onChange={(event) =>
                                        onDefaultsChange({ ...defaults, quality: event.target.value as ImageQuality })
                                    }
                                    className='h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-[13px] text-slate-800'>
                                    {QUALITY_CHOICES.map((quality) => (
                                        <option key={quality} value={quality}>
                                            {t(quality.charAt(0).toUpperCase() + quality.slice(1))}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <p className='text-[11px] text-slate-400'>
                            {t('These apply to nodes you create from now on; existing nodes keep their own settings.')}
                        </p>
                    </section>

                    {onPasswordChange && (
                        <section className='space-y-2 border-t border-slate-100 pt-4'>
                            <h3 className='text-[13px] font-semibold text-slate-800'>{t('Access password')}</h3>
                            <p className='text-[11px] text-slate-400'>
                                {passwordHash
                                    ? t('A password is stored in this browser and sent with every request.')
                                    : t('No password is stored. Only needed when the server sets APP_PASSWORD.')}
                            </p>
                            <div className='flex gap-2'>
                                <Input
                                    type='password'
                                    value={passwordDraft}
                                    onChange={(event) => setPasswordDraft(event.target.value)}
                                    placeholder={t('Server password (leave empty to clear)')}
                                    className='border-slate-200 bg-white text-[13px]'
                                />
                                <Button
                                    type='button'
                                    size='sm'
                                    disabled={savingPassword}
                                    onClick={() => void savePassword()}
                                    className='bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-slate-200 disabled:text-slate-400'>
                                    {savingPassword ? t('Saving…') : t('Save')}
                                </Button>
                            </div>
                        </section>
                    )}

                    {error && (
                        <p className='rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700'>
                            {error}
                        </p>
                    )}

                    <DialogFooter>
                        <Button
                            type='button'
                            variant='outline'
                            size='sm'
                            onClick={() => setOpen(false)}
                            className='border-slate-300 text-slate-600 hover:bg-slate-200 hover:text-slate-900'>
                            {t('Close')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
