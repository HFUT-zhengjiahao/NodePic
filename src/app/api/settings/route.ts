import { checkPassword, readAuthCookie } from '@/lib/api-auth';
import { changeOutputDir, effectiveApiKey, ensureOutputDir, readServerSettings, writeServerSettings, type ServerSettings } from '@/lib/server-settings';
import fs from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

export const dynamic = 'force-dynamic';

type SettingsPatch = {
    outputDir?: string;
    trashRetentionDays?: number;
    /** Only used when outputDir changes: carry the existing pictures into the new folder. */
    moveExisting?: boolean;
    /** The provider key the user pasted into the panel; an empty string clears it. */
    openaiApiKey?: string;
    /** Endpoint that key belongs to (a relay such as PackyAPI, or empty for the official API). */
    openaiBaseUrl?: string;
    /** Required whenever APP_PASSWORD is configured. */
    passwordHash?: string;
};

/**
 * The settings the browser is allowed to see.
 *
 * The key itself never travels back: the panel only needs to know whether one is configured, and the
 * last few characters so a saved key can be recognised.
 */
function forClient(settings: ServerSettings) {
    const key = effectiveApiKey(settings);
    return {
        outputDir: settings.outputDir,
        trashRetentionDays: settings.trashRetentionDays,
        openaiBaseUrl: settings.openaiBaseUrl,
        apiKeyConfigured: Boolean(key),
        apiKeyHint: key ? `…${key.slice(-4)}` : '',
        /** True when the key comes from .env.local rather than the panel, so the panel can say so. */
        apiKeyFromEnv: !settings.openaiApiKey.trim() && Boolean(process.env.OPENAI_API_KEY?.trim())
    };
}

/** Reports the current settings plus a few facts the UI needs to render the form sensibly. */
export async function GET(request: NextRequest) {
    // The endpoint exposes absolute paths and writability, so it is gated like the write routes.
    // It used to read the password hash from the query string, which put a credential into browser
    // history and access logs; the auth cookie carries it instead.
    const authFailure = checkPassword(readAuthCookie(request));
    if (authFailure) {
        return NextResponse.json({ error: authFailure.error }, { status: authFailure.status });
    }

    const settings = await readServerSettings();
    let fileCount = 0;
    let totalBytes = 0;
    let absoluteDir = '';
    let writable = false;

    try {
        absoluteDir = await ensureOutputDir();
        writable = true;
        for (const entry of await fs.readdir(absoluteDir)) {
            if (entry === '.trash' || entry === 'index.json') continue;
            try {
                const stat = await fs.stat(path.join(absoluteDir, entry));
                if (!stat.isFile()) continue;
                fileCount += 1;
                totalBytes += stat.size;
            } catch {
                // A file that vanished mid-scan simply is not counted.
            }
        }
    } catch (error) {
        console.warn('Could not inspect the output directory:', error);
    }

    return NextResponse.json({
        ok: true,
        settings: forClient(settings),
        resolvedOutputDir: absoluteDir,
        writable,
        fileCount,
        totalBytes,
        defaults: { outputDir: 'generated-images', trashRetentionDays: 30 }
    });
}

export async function PUT(request: NextRequest) {
    let body: SettingsPatch;
    try {
        body = (await request.json()) as SettingsPatch;
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }

    const authFailure = checkPassword(body.passwordHash);
    if (authFailure) {
        return NextResponse.json({ error: authFailure.error }, { status: authFailure.status });
    }

    try {
        if (typeof body.outputDir === 'string' && body.outputDir.trim()) {
            const result = await changeOutputDir(body.outputDir, body.moveExisting === true);
            const settings = await readServerSettings();
            return NextResponse.json({
                ok: true,
                settings: forClient(settings),
                moved: result.moved,
                failed: result.failed,
                resolvedOutputDir: await ensureOutputDir()
            });
        }

        // The key and its endpoint are saved together: one panel, one Apply.
        if (typeof body.openaiApiKey === 'string' || typeof body.openaiBaseUrl === 'string') {
            const settings = await writeServerSettings({
                ...(typeof body.openaiApiKey === 'string' ? { openaiApiKey: body.openaiApiKey } : {}),
                ...(typeof body.openaiBaseUrl === 'string' ? { openaiBaseUrl: body.openaiBaseUrl } : {})
            });
            return NextResponse.json({ ok: true, settings: forClient(settings), moved: 0, failed: 0 });
        }

        const settings = await writeServerSettings({ trashRetentionDays: body.trashRetentionDays });
        return NextResponse.json({ ok: true, settings: forClient(settings), moved: 0, failed: 0 });
    } catch (error) {
        console.error('Could not update the settings:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Could not update the settings.' },
            { status: 500 }
        );
    }
}
