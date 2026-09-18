'use client';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useI18n } from '@/lib/i18n';

type ModeToggleProps = {
    currentMode: 'generate' | 'edit';
    onModeChange: (mode: 'generate' | 'edit') => void;
};

export function ModeToggle({ currentMode, onModeChange }: ModeToggleProps) {
    const { t } = useI18n();

    return (
        <Tabs
            value={currentMode}
            onValueChange={(value) => onModeChange(value as 'generate' | 'edit')}
            className='w-auto'>
            <TabsList className='grid h-auto grid-cols-2 gap-1 rounded-md border-none bg-transparent p-0'>
                <TabsTrigger
                    value='generate'
                    className={`rounded-md border px-3 py-1 text-sm transition-colors ${
                        currentMode === 'generate'
                            ? 'border-slate-200 bg-white text-indigo-600 shadow-sm'
                            : 'border-dashed border-slate-200 bg-transparent text-slate-500 hover:border-indigo-400 hover:text-slate-700'
                    } `}>
                    {t('Generate')}
                </TabsTrigger>
                <TabsTrigger
                    value='edit'
                    className={`rounded-md border px-3 py-1 text-sm transition-colors ${
                        currentMode === 'edit'
                            ? 'border-slate-200 bg-white text-indigo-600 shadow-sm'
                            : 'border-dashed border-slate-200 bg-transparent text-slate-500 hover:border-indigo-400 hover:text-slate-700'
                    } `}>
                    {t('Edit')}
                </TabsTrigger>
            </TabsList>
        </Tabs>
    );
}
