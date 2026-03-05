import type { Metadata } from 'next';
import './globals.css';
import { AppProvider } from '@/context/AppContext';
import RootClient from './RootClient';

export const metadata: Metadata = {
    title: 'XerService',
    description: "Tamil Nadu's finest printing network. Stop waiting in line. Upload your documents to any shop in Tamilnadu and get them printed instantly.",
    icons: {
        icon: '/logo-black.png',
        shortcut: '/logo-black.png',
        apple: '/logo-black.png',
    },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body>
                <AppProvider>
                    <RootClient>{children}</RootClient>
                </AppProvider>
            </body>
        </html>
    );
}
