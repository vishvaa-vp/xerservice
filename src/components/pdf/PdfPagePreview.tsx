'use client';

import { useEffect, useRef, useState } from 'react';
import type { PageInfo } from '@/hooks/usePdfAnalyzer';
import { FileText, Loader2, Palette, X } from 'lucide-react';
import styles from './PdfPagePreview.module.css';

interface Props {
    pages: PageInfo[];
    analyzing: boolean;
    pageCount: number;
    colorPageCount: number;
    dominantSize: string;
}

export default function PdfPagePreview({ pages, analyzing, pageCount, colorPageCount, dominantSize }: Props) {
    const [selected, setSelected] = useState<PageInfo | null>(null);
    const dialog = useRef<HTMLDialogElement>(null);
    const thumbnails = pages.filter(page => page.thumbnail);
    useEffect(() => {
        if (selected) dialog.current?.showModal();
        else dialog.current?.close();
    }, [selected]);

    if (!analyzing && pages.length === 0) return null;
    return (
        <div className={styles.root} aria-busy={analyzing}>
            <div className={styles.badges} role="status">
                {analyzing ? <span><Loader2 size={14} className={styles.spinner} /> Checking pages{pageCount ? ` ${pages.length}/${pageCount}` : '...'}</span> : <>
                    <span><FileText size={14} /> {pageCount} {pageCount === 1 ? 'page' : 'pages'} · {dominantSize}</span>
                    <span><Palette size={14} /> {colorPageCount} color</span>
                    <span>{pageCount - colorPageCount} B&amp;W</span>
                </>}
            </div>
            <div className={styles.strip} role="region" aria-label="Document page previews" tabIndex={0}>
                {thumbnails.map(page => (
                    <button type="button" className={styles.page} key={page.pageNumber} aria-label={`Preview page ${page.pageNumber}, ${page.isColor ? 'color' : 'black and white'}`} onClick={() => setSelected(page)}>
                        <img src={page.thumbnail} alt={`Page ${page.pageNumber}`} />
                        <span><i className={page.isColor ? styles.color : styles.bw} /> {page.pageNumber}</span>
                    </button>
                ))}
                {pageCount > 5 && <div className={styles.more}><FileText size={20} /><span>+{pageCount - 5} more</span></div>}
            </div>
            {!analyzing && <p className={styles.caption}>Color detection is an estimate. You can change it in print settings.</p>}
            <dialog ref={dialog} className={styles.dialog} onClose={() => setSelected(null)} onClick={event => { if (event.target === event.currentTarget) setSelected(null); }} aria-label="Page preview">
                <div className={styles.dialogHeader}>
                    <strong>Page {selected?.pageNumber} · {selected?.label}</strong>
                    <button type="button" className="btn btn-ghost" aria-label="Close page preview" onClick={() => setSelected(null)}><X size={20} /></button>
                </div>
                {selected && <img className={styles.large} src={selected.thumbnail} alt={`Page ${selected.pageNumber}`} />}
            </dialog>
        </div>
    );
}
