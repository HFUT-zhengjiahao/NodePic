import { zh } from '@/lib/i18n/zh';

/**
 * Framework-agnostic i18n core. Kept free of React and of the `'use client'` directive so that
 * server components (e.g. the root layout) can import these helpers directly.
 */

export type Language = 'en' | 'zh';

export const SUPPORTED_LANGUAGES: readonly Language[] = ['zh', 'en'] as const;

/** Cookie used so the server can render the correct language on the very first paint. */
export const LANGUAGE_COOKIE = 'gpt-image-playground-language';

/** Default language for this local instance. */
export const DEFAULT_LANGUAGE: Language = 'zh';

export function normalizeLanguage(value: unknown): Language | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (normalized.startsWith('zh')) return 'zh';
    if (normalized.startsWith('en')) return 'en';
    return null;
}

export type TranslateVars = Record<string, string | number>;

/** Dictionaries keyed by the English source string. English itself needs no entries. */
const DICTIONARIES: Record<'zh', Record<string, string>> = { zh };

export function interpolate(template: string, vars?: TranslateVars): string {
    if (!vars) return template;
    // Both `{name}` and `${name}` are accepted, so strings written in either style resolve correctly.
    return template.replace(/\$\{(\w+)\}|\{(\w+)\}/g, (match, dollarKey: string, plainKey: string) => {
        const key = dollarKey || plainKey;
        return Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match;
    });
}

/** Translates an English source string, falling back to the source text when no entry exists. */
export function translate(language: Language, text: string, vars?: TranslateVars): string {
    const template = language === 'en' ? text : (DICTIONARIES.zh[text] ?? text);
    return interpolate(template, vars);
}
