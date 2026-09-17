'use client';
import { useEffect, useState } from 'react';

export function notify(message: string) {
    window.dispatchEvent(new CustomEvent('xer-feedback', { detail: message }));
}

export default function Feedback() {
    const [message, setMessage] = useState('');
    const [offline, setOffline] = useState(false);
    useEffect(() => {
        const receive = (event: Event) => setMessage((event as CustomEvent<string>).detail);
        const network = () => setOffline(!navigator.onLine);
        network();
        window.addEventListener('xer-feedback', receive);
        window.addEventListener('online', network);
        window.addEventListener('offline', network);
        return () => { window.removeEventListener('xer-feedback', receive); window.removeEventListener('online', network); window.removeEventListener('offline', network); };
    }, []);
    return <div className="feedback-stack">
        {offline && <div className="feedback-message" role="status">You’re offline. Reconnect to save changes and check order updates.</div>}
        {message && <div className="feedback-message" role="status"><span>{message}</span><button aria-label="Dismiss message" onClick={() => setMessage('')}>×</button></div>}
    </div>;
}
