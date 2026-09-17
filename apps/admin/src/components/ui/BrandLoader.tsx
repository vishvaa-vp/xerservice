'use client';

import { useEffect, useState, useRef } from 'react';
import styles from './BrandLoader.module.css';

// Tracks whether the initial application boot animation has already played in this runtime session
let globalBootCompleted = false;

export default function BrandLoader({ ready }: { ready: boolean }) {
    // Initial state matches SSR (true) to guarantee hydration consistency
    const [visible, setVisible] = useState(true);
    const [isLeaving, setIsLeaving] = useState(false);
    const mountTimeRef = useRef<number>(Date.now());

    // Immediate check on client mount to bypass loader if session already booted
    useEffect(() => {
        const booted = typeof window !== 'undefined' && (globalBootCompleted || window.sessionStorage?.getItem('xs_app_booted') === '1');
        if (booted) {
            setVisible(false);
        }
    }, []);

    useEffect(() => {
        if (!visible) return;

        if (typeof window === 'undefined') return;

        const booted = window.sessionStorage?.getItem('xs_app_booted') === '1';
        if (globalBootCompleted || booted) {
            setVisible(false);
            return;
        }

        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reducedMotion) {
            setVisible(false);
            globalBootCompleted = true;
            try {
                window.sessionStorage?.setItem('xs_app_booted', '1');
                document.documentElement.classList.add('xs-app-booted');
            } catch {}
            return;
        }

        const elapsed = Date.now() - mountTimeRef.current;
        const minDisplayMs = 1200;
        const maxSafetyDisplayMs = 2800;

        const dismiss = () => {
            setIsLeaving(true);
            const exitTimer = window.setTimeout(() => {
                setVisible(false);
                globalBootCompleted = true;
                try {
                    window.sessionStorage?.setItem('xs_app_booted', '1');
                    document.documentElement.classList.add('xs-app-booted');
                } catch {}
            }, 260);
            return exitTimer;
        };

        let timer: number;
        if (ready) {
            const delay = Math.max(0, minDisplayMs - elapsed);
            timer = window.setTimeout(dismiss, delay);
        } else {
            const delay = Math.max(0, maxSafetyDisplayMs - elapsed);
            timer = window.setTimeout(dismiss, delay);
        }

        return () => {
            window.clearTimeout(timer);
        };
    }, [ready, visible]);

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
