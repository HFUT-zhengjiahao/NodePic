'use client';

import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { Power } from 'lucide-react';
import * as React from 'react';

type ShutdownState = 'idle' | 'stopping' | 'stopped' | 'error';

/**
 * Bottom-left control that stops the local dev server, so closing the browser tab never leaves the
 * service running in the background unnoticed.
 */
export function ShutdownButton() {
    const { t } = useI18n();
    const [state, setState] = React.useState<ShutdownState>('idle');

    const handleShutdown = React.useCallback(async () => {
        if (state === 'stopping') return;
        if (!window.confirm(t('Stop the local server? This page will stop working until you start it again.'))) {
            return;
        }

        setState('stopping');
        try {
            const response = await fetch('/api/shutdown', { method: 'POST' });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            setState('stopped');
        } catch {
            // The server usually dies before the response is fully read, which is the expected outcome.
            setState('stopped');
        }
    }, [state, t]);

    return (
        <div className='flex flex-col items-end gap-2'>
            {state === 'stopped' ? (
                <div className='max-w-[280px] rounded-md border border-slate-200 bg-white/95 px-3 py-2 text-xs leading-relaxed text-slate-700'>
                    {t('Server stopped. You can close this page now.')}
                </div>
            ) : (
                <Button
                    variant='outline'
                    size='sm'
                    onClick={handleShutdown}
                    disabled={state === 'stopping'}
                    title={t('Shut Down Service')}
                    className='border-slate-200 bg-white text-slate-500 shadow-sm hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-60'>
                    <Power className='mr-2 h-4 w-4' />
                    {state === 'stopping' ? t('Stopping…') : t('Shut Down Service')}
                </Button>
            )}
            {state === 'error' && (
                <div className='rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700'>
                    {t('Failed to stop the server.')}
                </div>
            )}
        </div>
    );
}
