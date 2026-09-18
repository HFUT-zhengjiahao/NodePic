import fs from 'fs/promises';
import { changeOutputDir, ensureOutputDir, readServerSettings, writeServerSettings } from '@/lib/server-settings';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

export const dynamic = 'force-dynamic';

type SettingsPatch = {
    outputDir?: string;
    trashRetentionDays?: number;
    /** Only used when outputDir changes: carry the existing pictures into the new folder. */
    moveExisting?: boolean;
};

/** Reports the current settings plus a few facts the UI needs to render the form sensibly. */
export async function GET() {
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
        settings,
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

    try {
        if (typeof body.outputDir === 'string' && body.outputDir.trim()) {
            const result = await changeOutputDir(body.outputDir, body.moveExisting === true);
            const settings = await readServerSettings();
            return NextResponse.json({
                ok: true,
                settings,
                moved: result.moved,
                failed: result.failed,
                resolvedOutputDir: await ensureOutputDir()
            });
        }

        const settings = await writeServerSettings({ trashRetentionDays: body.trashRetentionDays });
        return NextResponse.json({ ok: true, settings, moved: 0, failed: 0 });
    } catch (error) {
        console.error('Could not update the settings:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Could not update the settings.' },
            { status: 500 }
        );
    }
}
