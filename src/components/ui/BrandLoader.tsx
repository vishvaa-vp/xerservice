'use client';

import { useEffect, useState } from 'react';
import styles from './BrandLoader.module.css';

// Tracks whether the initial application boot animation has already played in this runtime session
let globalBootCompleted = false;

export default function BrandLoader({ ready }: { ready: boolean }) {
    // Initial state matches SSR (true) to guarantee hydration consistency
    const [visible, setVisible] = useState(true);
    const [isLeaving, setIsLeaving] = useState(false);

    useEffect(() => {
        let booted = globalBootCompleted;
        try { booted = booted || sessionStorage.getItem('xs_app_booted') === '1'; } catch {}
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (booted || reduced) { setVisible(false); return; }
        const dismiss = () => {
            setIsLeaving(true);
            globalBootCompleted = true;
            try { sessionStorage.setItem('xs_app_booted', '1'); } catch {}
        };
        // Content can load underneath; the brand animation never hides an auth error indefinitely.
        const timer = window.setTimeout(dismiss, ready ? 450 : 1800);
        return () => clearTimeout(timer);
    }, [ready]);
    useEffect(() => {
        if (!isLeaving) return;
        const timer = window.setTimeout(() => setVisible(false), 250);
        return () => clearTimeout(timer);
    }, [isLeaving]);

    useEffect(() => {
        if (!visible) return;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = previousOverflow; };
    }, [visible]);

    if (!visible) return null;

    return (
        <div
            className={`${styles.screen} ${isLeaving ? styles.leaving : ''}`}
            role="status"
            aria-label="Loading XerService"
        >
            <div className={styles.identity} aria-hidden="true">
                <div className={styles.stage}>
                    <div className={styles.registration}>
                        <i /><i /><i /><i />
                    </div>
                    <div className={`${styles.sheet} ${styles.cyanSheet}`} />
                    <div className={`${styles.sheet} ${styles.coralSheet}`} />
                    <div className={`${styles.sheet} ${styles.paper}`}>
                        <div className={styles.printed}>
                            <div className={styles.paperHeader}>
                                <span>XS / PRINT</span><span>01</span>
                            </div>
                            <img
                                src="/logo-black.png"
                                alt=""
                                width={84}
                                height={84}
                                decoding="async"
                                fetchPriority="high"
                            />
                            <div className={styles.paperLines}><i /><i /></div>
                            <div className={styles.paperFooter}>
                                <span className={styles.inks}><i /><i /><i /><i /></span>
                                <span>READY TO PRINT</span>
                            </div>
                        </div>
                        <div className={styles.printHead} />
                    </div>
                </div>

                <div className={styles.wordmarkMask}>
                    <span className={styles.wordmark}>xerservice<span>.</span></span>
                </div>
                <p className={styles.tagline}>Your ideas. In print.</p>
                <div className={styles.activity}>
                    <span className={styles.bar} />
                </div>
                <p className={styles.caption}>Getting things ready</p>
            </div>
        </div>
    );
}
