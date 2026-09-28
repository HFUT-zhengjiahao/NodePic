'use client';

import { Button } from '@/components/ui/button';
import * as React from 'react';

/** Icon-only toolbar button: keeps the bar compact while staying a comfortable tap target. */
export function ToolbarIconButton({
    icon: Icon,
    label,
    onClick,
    disabled = false,
    expanded
}: {
    icon: React.ElementType;
    label: string;
    onClick: () => void;
    disabled?: boolean;
    expanded?: boolean;
}) {
    return (
        <Button
            type='button'
            variant='outline'
            size='sm'
            title={label}
            aria-label={label}
            aria-expanded={expanded}
            disabled={disabled}
            onClick={onClick}
            className='pointer-events-auto h-8 w-8 border-slate-200 bg-white p-0 text-slate-500 shadow-sm hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40'>
            <Icon className='h-4 w-4' />
        </Button>
    );
}
