import type { Metadata } from 'next';
import './globals.css';
import { AppProvider } from '@/context/AppContext';
import RootClient from './RootClient';

const themeScript = `
    (function () {
        var saved;
        try { saved = localStorage.getItem('xer_theme'); } catch (_) {}
        var dark = saved === 'dark' || (saved !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        document.documentElement.classList.toggle('dark', dark);
        document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
        try {
            if (sessionStorage.getItem('xs_app_booted') === '1') {
                document.documentElement.classList.add('xs-app-booted');
            }
        } catch (_) {}
    })();
`;

export const metadata: Metadata = {
    title: {
        default: 'XerService',
        template: '%s | XerService',
    },
    description: 'Print-on-demand made effortless. Upload your documents, customize your print settings, and collect from your preferred local print shop.',
    icons: {
        icon: [
            { url: '/favicon.ico', sizes: 'any' },
        ],
        shortcut: '/favicon.ico',
        apple: '/apple-touch-icon.png',
    },
};

export const viewport = {
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
};


export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <head>
                <script dangerouslySetInnerHTML={{ __html: themeScript }} />
            </head>
            <body>
                <AppProvider>
                    <RootClient>{children}</RootClient>
                </AppProvider>
            </body>
        </html>
    );
}
