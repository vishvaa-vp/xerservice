'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { X, Minus, Plus, FileText, Palette, Layers, Sparkles, Check } from 'lucide-react';
import { selectedPageNumbers, type PrintSettings } from '@/lib/print-settings';
import LivePrintPreview from '@/components/pdf/LivePrintPreview';
import styles from './PrintSettingsModal.module.css';
import { documentPrintTotals } from '@/lib/print-order';

export interface ShopAddonItem {
    id: string;
    shopAddonId?: string;
    addon_id?: string;
    addonId?: string;
    shop_id?: string;
    is_available?: boolean;
    isAvailable?: boolean;
    name?: string;
    description?: string | null;
    imageUrl?: string | null;
    image_url?: string | null;
    price?: number;
    base_price?: number;
    estimatedMinutes?: number;
    minPages?: number;
    maxPages?: number;
    addon?: {
        id: string;
        name: string;
        description: string | null;
        image_url: string | null;
        base_price: number;
        estimated_prep_time_minutes: number;
        min_page_limit: number | null;
        max_page_limit: number | null;
        is_active: boolean;
    };
}

interface Props {
    error?: string;
    file: { file: File; pages: number; settings: PrintSettings };
    hasMultiple: boolean;
    onClose: () => void;
    onSave: (settings: PrintSettings, applyAll: boolean) => void | boolean | Promise<void | boolean>;
    onAddFiles?: () => void;
    shopId?: string;
}

export default function PrintSettingsModal({ file, hasMultiple, onClose, onSave, error, shopId, onAddFiles }: Props) {
    const [settings, setSettings] = useState<PrintSettings>({
        ...file.settings,
        addonIds: file.settings.addonIds || [],
    });
    const [applyAll, setApplyAll] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState('');
    const [shopAddons, setShopAddons] = useState<ShopAddonItem[]>([]);
    const [addonsLoading, setAddonsLoading] = useState(false);
    const dialog = useRef<HTMLDialogElement>(null);
    const update = (changes: Partial<PrintSettings>) => setSettings(previous => ({ ...previous, ...changes }));

    const selectedPagesList = useMemo(() => selectedPageNumbers(file.pages, settings), [file.pages, settings]);
    const selectionValid = selectedPagesList.length > 0;
    const printablePagesCount = Math.max(1, Math.ceil(selectedPagesList.length / Math.max(1, settings.pagesPerSheet)));

    useEffect(() => {
        const element = dialog.current;
        const overflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        element?.showModal();
        return () => { element?.close(); document.body.style.overflow = overflow; };
    }, []);

    useEffect(() => {
        if (!shopId) return;
        let isMounted = true;
        setAddonsLoading(true);
        fetch(`/api/shops/${shopId}/addons`)
            .then(res => res.ok ? res.json() : Promise.reject(new Error('Failed to load add-ons')))
            .then(data => {
                if (isMounted && Array.isArray(data.addons)) {
                    setShopAddons(data.addons);
                }
            })
            .catch(err => {
                console.warn('[PrintSettingsModal] Could not fetch shop add-ons:', err);
            })
            .finally(() => {
                if (isMounted) setAddonsLoading(false);
            });
        return () => { isMounted = false; };
    }, [shopId]);

    const toggleAddon = (targetId: string) => {
        setSettings(prev => {
            const current = prev.addonIds || [];
            if (current.includes(targetId)) {
                return { ...prev, addonIds: current.filter(id => id !== targetId) };
            } else {
                return { ...prev, addonIds: [...current, targetId] };
            }
        });
    };

    // Calculate total including add-ons
    const printingAmount = documentPrintTotals({ pages: file.pages, settings }).amount;
    const activeSelectedAddons = useMemo(() => {
        const selectedIds = new Set(settings.addonIds || []);
        return shopAddons.filter(sa => selectedIds.has(sa.shopAddonId || sa.id));
    }, [shopAddons, settings.addonIds]);

    const addonsAmount = activeSelectedAddons.reduce((sum, sa) => {
        const price = sa.price ?? sa.base_price ?? sa.addon?.base_price ?? 0;
        return sum + Number(price);
    }, 0);
    const modalTotal = Math.round((printingAmount + addonsAmount) * 100) / 100;

    const persist = async (addFiles: boolean) => {
        if (saving) return;
        setSaving(true);
        setSaveError('');
        try {
            const saved = await onSave(settings, applyAll);
            if (saved !== false && addFiles) onAddFiles?.();
        } catch {
            setSaveError('Your settings could not be saved. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <dialog ref={dialog} className={styles.modal} aria-labelledby="print-settings-title" onCancel={onClose}>
            <header className={styles.header}>
                <div><h2 id="print-settings-title">Print Settings</h2><p title={file.file.name}>{file.file.name}</p></div>
                <button type="button" className={styles.icon} title="Close print settings" aria-label="Close print settings" onClick={onClose}><X size={20} /></button>
            </header>
            <div className={styles.body}>
                <div className={styles.controls}>
                    <fieldset><legend>Color mode</legend><div className={styles.segments}>
                        {([{ label: 'Black & White', value: 'bw', Icon: FileText }, { label: 'Color', value: 'color', Icon: Palette }] as const).map(({ label, value, Icon }) => <button type="button" key={value} aria-pressed={settings.color === value} onClick={() => update({ color: value })}><Icon size={16} />{label}</button>)}
                    </div></fieldset>
                    <fieldset><legend>Sidedness</legend><div className={`${styles.segments} ${styles.sides}`}>
                        {([{ label: 'Single', value: 'single', Icon: FileText }, { label: 'Double (Long Edge)', value: 'double_long', Icon: Layers }, { label: 'Double (Short Edge)', value: 'double_short', Icon: Layers }] as const).map(({ label, value, Icon }) => <button type="button" key={value} aria-pressed={settings.sides === value} onClick={() => update({ sides: value })}><Icon size={16} />{label}</button>)}
                    </div></fieldset>
                    <fieldset><legend>Orientation</legend><div className={styles.segments}>
                        {(['portrait', 'landscape'] as const).map(value => <button type="button" key={value} aria-pressed={settings.orientation === value} onClick={() => update({ orientation: value })}>{value === 'portrait' ? 'Portrait' : 'Landscape'}</button>)}
                    </div></fieldset>
                    <div className={styles.pair}>
                        <label>Copies<div className={styles.stepper}>
                            <button type="button" aria-label="Fewer copies" disabled={settings.copies <= 1} onClick={() => update({ copies: settings.copies - 1 })}><Minus size={16} /></button>
                            <input aria-label="Copies" type="number" min={1} max={100} value={settings.copies} onChange={e => update({ copies: Math.min(100, Math.max(1, Number(e.target.value) || 1)) })} />
                            <button type="button" aria-label="More copies" disabled={settings.copies >= 100} onClick={() => update({ copies: settings.copies + 1 })}><Plus size={16} /></button>
                        </div></label>
                        <label>Pages per side<select aria-label="Pages per side" value={settings.pagesPerSheet} onChange={e => update({ pagesPerSheet: Number(e.target.value) })}>{[1, 2, 4, 6, 9].map(value => <option value={value} key={value}>{value} {value === 1 ? 'page' : 'pages'}</option>)}</select></label>
                    </div>
                    <div className={styles.pair}>
                        <label>Paper size<select aria-label="Paper size" value={settings.paperSize} onChange={e => update({ paperSize: e.target.value as PrintSettings['paperSize'] })}><option value="a4">A4</option><option value="a3">A3</option><option value="legal">Legal</option></select></label>
                        <label>Margins<select aria-label="Margins" value={settings.margins} onChange={e => update({ margins: e.target.value as PrintSettings['margins'] })}><option value="default">Default</option><option value="minimum">Minimum</option><option value="none">None</option></select></label>
                    </div>
                    <fieldset><legend>Pages to print</legend><div className={styles.segments}>
                        {(['all', 'odd', 'even', 'range'] as const).map(value => <button type="button" key={value} aria-pressed={settings.pageRange === value} onClick={() => update({ pageRange: value })}>{value.toUpperCase()}</button>)}
                    </div>
                        {settings.pageRange === 'range' && <input className={styles.range} aria-label="Page range" aria-invalid={!selectionValid} placeholder="e.g. 1-3, 7, 10-12" value={settings.customRange} onChange={e => update({ customRange: e.target.value })} />}
                        {!selectionValid && <p className={styles.error}>Choose pages between 1 and {file.pages}.</p>}
                    </fieldset>
                    <div className={styles.pair}>
                        <label>Scale<select aria-label="Scale" value={settings.scale} onChange={e => update({ scale: e.target.value as PrintSettings['scale'] })}><option value="default">Default</option><option value="fit">Fit to paper</option><option value="custom">Custom</option></select></label>
                        {settings.scale === 'custom' && <label>Scale (%)<input aria-label="Scale (%)" type="number" min={10} max={200} value={settings.customScale ?? 100} onChange={e => update({ customScale: Math.min(200, Math.max(10, Number(e.target.value) || 100)) })} /></label>}
                    </div>
                    <label className={styles.checkbox}><input type="checkbox" checked={settings.headersFooters} onChange={e => update({ headersFooters: e.target.checked })} />Add filename and page numbers</label>

                    {/* Finishing Add-ons Section */}
                    {shopAddons.length > 0 && (
                        <div className={styles.addonsSection}>
                            <legend style={{ fontSize: '13px', fontWeight: '800', color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Sparkles size={15} color="var(--accent)" /> Finishing Add-ons (Per File)
                            </legend>
                            <p style={{ fontSize: '11px', color: 'var(--fg-muted)', margin: '-4px 0 6px 0' }}>
                                Select optional post-print finishing services for this document.
                            </p>
                            <div className={styles.addonsList}>
                                {shopAddons.map(sa => {
                                    const addonId = sa.shopAddonId || sa.id;
                                    const name = sa.name || sa.addon?.name || 'Add-on';
                                    const price = Number(sa.price ?? sa.base_price ?? sa.addon?.base_price ?? 0);
                                    const description = sa.description || sa.addon?.description || '';
                                    const imageUrl = sa.imageUrl || sa.image_url || sa.addon?.image_url;
                                    const isAvailable = (sa.is_available ?? sa.isAvailable ?? true) && (sa.addon?.is_active ?? true);
                                    const min = sa.minPages ?? sa.addon?.min_page_limit;
                                    const max = sa.maxPages ?? sa.addon?.max_page_limit;
                                    const prepTime = sa.estimatedMinutes ?? sa.addon?.estimated_prep_time_minutes ?? 0;
                                    const pageLimitViolated = (min != null && printablePagesCount < min) || (max != null && printablePagesCount > max);
                                    const isSelected = (settings.addonIds || []).includes(addonId);
                                    const isDisabled = !isAvailable || pageLimitViolated;

                                    let limitNote = '';
                                    if (min && max) limitNote = `(${min}-${max} pages)`;
                                    else if (min) limitNote = `(Min ${min} pages)`;
                                    else if (max) limitNote = `(Max ${max} pages)`;

                                    let warningMsg = '';
                                    if (!isAvailable) {
                                        warningMsg = 'Currently unavailable at this shop';
                                    } else if (pageLimitViolated) {
                                        warningMsg = `Document must be between ${min || 1} and ${max || '∞'} pages (current: ${printablePagesCount})`;
                                    }

                                    return (
                                        <div
                                            key={addonId}
                                            className={`${styles.addonCard} ${isSelected ? styles.selected : ''} ${isDisabled ? styles.disabled : ''}`}
                                            onClick={() => {
                                                if (!isDisabled) toggleAddon(addonId);
                                            }}
                                        >
                                            {imageUrl ? (
                                                <img src={imageUrl} alt={name} className={styles.addonThumb} />
                                            ) : (
                                                <div className={styles.addonThumb}>✨</div>
                                            )}
                                            <div className={styles.addonDetails}>
                                                <div className={styles.addonTitleRow}>
                                                    <span className={styles.addonName}>
                                                        {name} {limitNote && <span style={{ fontSize: '11px', color: 'var(--fg-muted)', fontWeight: 'normal' }}>{limitNote}</span>}
                                                    </span>
                                                    <span className={styles.addonPrice}>+₹{price.toFixed(2)}</span>
                                                </div>
                                                <div className={styles.addonSubtext}>
                                                    {description} {prepTime > 0 ? `· +${prepTime} min prep` : ''}
                                                </div>
                                                {warningMsg && <div className={styles.addonWarning}>{warningMsg}</div>}
                                            </div>
                                            <button
                                                type="button"
                                                className={`${styles.addonAddBtn} ${isSelected ? styles.addonAddedBtn : ''}`}
                                                disabled={isDisabled}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (!isDisabled) toggleAddon(addonId);
                                                }}
                                                aria-label={isSelected ? `Remove ${name}` : `Add ${name}`}
                                            >
                                                {isSelected ? (
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                                        <Check size={13} style={{ strokeWidth: 3 }} /> Added
                                                    </span>
                                                ) : (
                                                    '+ Add'
                                                )}
                                            </button>
                                            <input
                                                type="checkbox"
                                                className={styles.addonCheckbox}
                                                checked={isSelected}
                                                disabled={isDisabled}
                                                onChange={() => {
                                                    if (!isDisabled) toggleAddon(addonId);
                                                }}
                                                onClick={e => e.stopPropagation()}
                                                style={{ display: 'none' }}
                                                aria-hidden="true"
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
                <div className={styles.preview}><LivePrintPreview file={file.file} pageCount={file.pages} settings={settings} /></div>
            </div>
            <footer className={styles.footer}>
                <strong className="mobile-only mobile-settings-price" aria-live="polite">{selectedPagesList.length} selected pages · Final price at review</strong>
                {(error || saveError) && <p role="alert">{error || saveError}</p>}
                {hasMultiple ? <label className={styles.checkbox}><input type="checkbox" checked={applyAll} onChange={e => setApplyAll(e.target.checked)} />Apply print settings to all documents</label> : <span />}
                <div className={styles.actions}>
                    <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
                    {onAddFiles && <button type="button" className="btn btn-outline" disabled={!selectionValid || saving} onClick={() => persist(true)}><Plus size={16} /> Save & add PDF</button>}
                    <button type="button" className="btn btn-accent" disabled={!selectionValid || saving} onClick={() => persist(false)}>{saving ? 'Saving…' : 'Apply Settings'}</button>
                </div>
            </footer>
        </dialog>
    );
}
