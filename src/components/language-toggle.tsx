'use client';

import { useI18n } from '@/lib/i18n';
import type { Language } from '@/lib/i18n/config';
import { Languages } from 'lucide-react';

const OPTIONS: Array<{ value: Language; label: string }> = [
    { value: 'zh', label: '中文' },
    { value: 'en', label: 'EN' }
];

export function LanguageToggle({ className = '' }: { className?: string }) {
    const { language, setLanguage, t } = useI18n();

    return (
        <div
            className={`flex items-center gap-1 rounded-md border border-slate-200 bg-white/80 p-1 ${className}`}
            role='group'
            aria-label={t('Language')}>
            <Languages className='mx-1 h-4 w-4 text-slate-500' aria-hidden='true' />
            {OPTIONS.map((option) => {
                const active = language === option.value;
                return (
                    <button
                        key={option.value}
                        type='button'
                        onClick={() => setLanguage(option.value)}
                        aria-pressed={active}
                        title={t('Switch language')}
                        className={`rounded px-2 py-0.5 text-xs transition-colors ${
                            active ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'
                        }`}>
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}
