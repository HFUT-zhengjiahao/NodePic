'use client';

import {
    DEFAULT_LANGUAGE,
    LANGUAGE_COOKIE,
    translate,
    type Language,
    type TranslateVars
} from '@/lib/i18n/config';
import * as React from 'react';

export type { Language, TranslateVars } from '@/lib/i18n/config';

type I18nContextValue = {
    language: Language;
    setLanguage: (language: Language) => void;
    t: (text: string, vars?: TranslateVars) => string;
};

const I18nContext = React.createContext<I18nContextValue | null>(null);

export function I18nProvider({
    initialLanguage = DEFAULT_LANGUAGE,
    children
}: {
    initialLanguage?: Language;
    children: React.ReactNode;
}) {
    const [language, setLanguageState] = React.useState<Language>(initialLanguage);

    const setLanguage = React.useCallback((next: Language) => {
        setLanguageState(next);
        try {
            document.cookie = `${LANGUAGE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
        } catch {
            // Cookies can be unavailable (e.g. hardened privacy settings); in-memory state still applies.
        }
        document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en';
    }, []);

    const t = React.useCallback((text: string, vars?: TranslateVars) => translate(language, text, vars), [language]);

    const value = React.useMemo<I18nContextValue>(() => ({ language, setLanguage, t }), [language, setLanguage, t]);

    return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
    const context = React.useContext(I18nContext);
    if (!context) {
        throw new Error('useI18n must be used inside an <I18nProvider>.');
    }
    return context;
}

/** Convenience hook for components that only need the translate function. */
export function useTranslate(): (text: string, vars?: TranslateVars) => string {
    return useI18n().t;
}
