import { notFound } from 'next/navigation';

export default function WhatsAppCoexistenceLayout({ children }: { children: React.ReactNode }) {
    if (process.env.WHATSAPP_COEXISTENCE_DEV_PAGE_ENABLED !== 'true') {
        notFound();
    }

    return children;
}
