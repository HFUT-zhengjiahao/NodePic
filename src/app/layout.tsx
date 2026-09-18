import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { I18nProvider } from '@/lib/i18n';
import { DEFAULT_LANGUAGE, LANGUAGE_COOKIE, normalizeLanguage } from '@/lib/i18n/config';
import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { cookies } from 'next/headers';

const geistSans = Geist({
    variable: '--font-geist-sans',
    subsets: ['latin']
});

const geistMono = Geist_Mono({
    variable: '--font-geist-mono',
    subsets: ['latin']
});

export const metadata: Metadata = {
    title: 'GPT Image Playground',
    description: "Generate and edit images using OpenAI's GPT Image models.",
    icons: {
        icon: '/favicon.svg'
    }
};

export default async function RootLayout({
    children
}: Readonly<{
    children: React.ReactNode;
}>) {
    // Read the language from the cookie so the server renders the selected language right away
    // (no flash of English before the client hydrates).
    const cookieStore = await cookies();
    const language = normalizeLanguage(cookieStore.get(LANGUAGE_COOKIE)?.value) ?? DEFAULT_LANGUAGE;

    return (
        <html lang={language === 'zh' ? 'zh-CN' : 'en'} suppressHydrationWarning>
            <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
                <ThemeProvider attribute='class' defaultTheme='light' enableSystem={false} disableTransitionOnChange>
                    <I18nProvider initialLanguage={language}>{children}</I18nProvider>
                </ThemeProvider>
            </body>
        </html>
    );
}
