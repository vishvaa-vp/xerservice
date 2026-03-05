'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import { calculatePrice } from '@/lib/mock-data';
import {
    Upload,
    FileText,
    X,
    Settings,
    Plus,
    Eye,
    Trash2,
    FileImage,
    Settings2,
    CheckCircle,
    ArrowRight,
    Palette,
    Layers
} from 'lucide-react';

const SUPPORTED_TYPES = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/jpeg', 'image/png', 'image/webp'
];

interface FileWithSettings {
    id: string;
    file: File;
    preview?: string;
    pages: number;
    settings: {
        copies: number;
        color: 'bw' | 'color';
        sides: 'single' | 'double_long' | 'double_short';
        paperSize: 'a4' | 'a3' | 'legal';
        orientation: 'portrait' | 'landscape';
        pagesPerSheet: number;
        pageRange: 'all' | 'odd' | 'even' | 'range';
        customRange: string;
        margins: 'default' | 'none' | 'minimum';
        scale: 'default' | 'fit' | 'custom';
        headersFooters: boolean;
        backgroundGraphics: boolean;
    };
}

export default function UploadPage() {
    const [files, setFiles] = useState<FileWithSettings[]>([]);
    const [dragging, setDragging] = useState(false);
    const [error, setError] = useState('');
    const [uploading, setUploading] = useState(false);
    const [editingFileId, setEditingFileId] = useState<string | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const { currentOrder, setCurrentOrder } = useApp();
    const router = useRouter();

    const estimatePages = (f: File): number => {
        if (f.type === 'application/pdf') return Math.max(1, Math.round(f.size / 80000));
        if (f.type.startsWith('image/')) return 1;
        return Math.max(1, Math.round(f.size / 60000));
    };

    const handleFiles = (newDocs: FileList | File[]) => {
        const docs = Array.from(newDocs);
        const validDocs = docs.filter(f => SUPPORTED_TYPES.includes(f.type));

        if (validDocs.length < docs.length) {
            setError('Some files were skipped. Only PDF, Word, PowerPoint and images are supported.');
        }

        const newFiles: FileWithSettings[] = validDocs.map(f => {
            const preview = f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined;
            return {
                id: Math.random().toString(36).substr(2, 9),
                file: f,
                preview,
                pages: estimatePages(f),
                settings: {
                    copies: 1,
                    color: 'bw',
                    sides: 'single',
                    paperSize: 'a4',
                    orientation: 'portrait',
                    pagesPerSheet: 1,
                    pageRange: 'all',
                    customRange: '',
                    margins: 'default',
                    scale: 'default',
                    headersFooters: true,
                    backgroundGraphics: false
                }
            };
        });

        setFiles(prev => [...prev, ...newFiles]);
        if (validDocs.length > 0) setError('');
    };

    const removeFile = (id: string) => {
        setFiles(prev => {
            const filtered = prev.filter(f => f.id !== id);
            // Cleanup previews
            const removed = prev.find(f => f.id === id);
            if (removed?.preview) URL.revokeObjectURL(removed.preview);
            return filtered;
        });
        if (editingFileId === id) setEditingFileId(null);
    };

    const updateFileSettings = (id: string, newSettings: Partial<FileWithSettings['settings']>) => {
        setFiles(prev => prev.map(f => f.id === id ? { ...f, settings: { ...f.settings, ...newSettings } } : f));
    };

    const handleContinue = async () => {
        if (files.length === 0) return;
        setUploading(true);
        const totalRawPages = files.reduce((acc, f) => acc + f.pages, 0);
        const totalEstimatedPages = files.reduce((acc, f) => {
            const printablePages = Math.max(1, Math.ceil(f.pages / Math.max(1, f.settings.pagesPerSheet)));
            return acc + (printablePages * f.settings.copies);
        }, 0);
        const totalAmount = files.reduce((acc, f) => {
            const printablePages = Math.max(1, Math.ceil(f.pages / Math.max(1, f.settings.pagesPerSheet)));
            const isColor = f.settings.color === 'color';
            return acc + calculatePrice(printablePages, isColor, f.settings.sides, f.settings.copies);
        }, 0);

        const firstSettings = files[0]?.settings;

        setCurrentOrder(prev => ({
            ...prev,
            files: files.map(f => f.file),
            totalFiles: files.length,
            fileName: files.length === 1 ? (files[0]?.file.name || '') : `${files.length} files`,
            pages: totalRawPages,
            totalEstimatedPages,
            color: firstSettings?.color === 'color',
            sides: firstSettings?.sides || 'single',
            orientation: firstSettings?.orientation || 'portrait',
            copies: 1,
            totalAmount: Math.round(totalAmount * 100) / 100,
        }));

        await new Promise(r => setTimeout(r, 800));
        router.push('/order/pricing');
    };

    return (
        <div className="page-wrapper">
            <section className="section">
                <div className="container" style={{ maxWidth: '1000px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '48px' }}>
                        <div>
                            <h1 style={{ fontSize: '32px', fontWeight: '900', letterSpacing: '-0.04em', marginBottom: '8px' }}>Upload Documents</h1>
                            <p style={{ fontSize: '15px', color: 'var(--fg-muted)' }}>
                                Printing at: <strong style={{ color: 'var(--accent)' }}>{currentOrder.shopName || 'Tamil Nadu Print Shop'}</strong>
                            </p>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', fontSize: '13px', color: 'var(--fg-muted)', fontWeight: '700' }}>
                            <span style={{ color: 'var(--accent)' }}>Upload</span><span>→</span><span>Payment</span><span>→</span><span>Collect</span>
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: files.length > 0 ? '1fr 380px' : '1fr', gap: '32px', alignItems: 'start' }}>
                        {/* Dropzone & List */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                            <div onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
                                onDrop={e => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files) handleFiles(e.dataTransfer.files); }}
                                onClick={() => fileRef.current?.click()}
                                style={{
                                    border: `2.5px dashed ${dragging ? 'var(--accent)' : 'var(--border-strong)'}`,
                                    borderRadius: '24px',
                                    padding: files.length > 0 ? '40px' : '80px 40px',
                                    textAlign: 'center',
                                    cursor: 'pointer',
                                    background: dragging ? 'var(--accent-muted)' : 'var(--bg-secondary)',
                                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                    boxShadow: dragging ? 'var(--shadow-accent)' : 'none'
                                }}>
                                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
                                    <div style={{ width: '64px', height: '64px', borderRadius: '20px', background: dragging ? 'var(--accent)' : 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow-sm)' }}>
                                        <Plus size={32} color={dragging ? '#fff' : 'var(--accent)'} />
                                    </div>
                                </div>
                                <p style={{ fontSize: '18px', fontWeight: '800', marginBottom: '4px' }}>{files.length > 0 ? 'Add more files' : 'Select your documents'}</p>
                                <p style={{ fontSize: '14px', color: 'var(--fg-muted)' }}>Drag and drop or click to browse</p>
                                <input ref={fileRef} type="file" multiple accept=".pdf,.doc,.docx,.ppt,.pptx,.jpg,.jpeg,.png,.webp"
                                    style={{ display: 'none' }} onChange={e => e.target.files && handleFiles(e.target.files)} />
                            </div>

                            {files.length > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    {files.map(f => (
                                        <div key={f.id} className="card" style={{ padding: '24px', borderRadius: '20px', border: editingFileId === f.id ? '2px solid var(--accent)' : '1px solid var(--border)', transition: 'all 0.3s' }}>
                                            <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                                                <div style={{ width: '60px', height: '80px', background: 'var(--bg-tertiary)', borderRadius: '12px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: '1px solid var(--border)' }}>
                                                    {f.preview ? (
                                                        <img src={f.preview} alt="preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                    ) : (
                                                        <FileText size={24} color="var(--fg-subtle)" />
                                                    )}
                                                </div>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <p style={{ fontSize: '16px', fontWeight: '700', marginBottom: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.file.name}</p>
                                                    <div style={{ display: 'flex', gap: '12px', color: 'var(--fg-muted)', fontSize: '13px', fontWeight: '600' }}>
                                                        <span>{(f.file.size / 1024).toFixed(1)} KB</span>
                                                        <span>•</span>
                                                        <span>{f.pages} pages</span>
                                                        <span className="badge badge-accent" style={{ fontSize: '10px' }}>{f.settings.color === 'bw' ? 'B&W' : 'Color'}</span>
                                                    </div>
                                                </div>
                                                <div style={{ display: 'flex', gap: '10px' }}>
                                                    <button onClick={() => setEditingFileId(editingFileId === f.id ? null : f.id)} className="btn btn-outline" style={{ width: '44px', height: '44px', padding: 0, borderRadius: '12px' }}>
                                                        <Settings2 size={20} />
                                                    </button>
                                                    <button onClick={() => removeFile(f.id)} className="btn btn-ghost" style={{ width: '44px', height: '44px', padding: 0, borderRadius: '12px', color: 'var(--fg-subtle)' }}>
                                                        <Trash2 size={20} />
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Expandable Settings Removed for Modal */}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Order Summary Sidebar */}
                        {files.length > 0 && (
                            <div style={{ position: 'sticky', top: '150px' }}>
                                <div className="card" style={{ padding: '32px', borderRadius: '28px', background: 'var(--fg)', color: 'var(--bg)', boxShadow: 'var(--shadow-lg)' }}>
                                    <h2 style={{ fontSize: '20px', fontWeight: '800', marginBottom: '24px' }}>Order Details</h2>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '32px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', opacity: 0.7, fontSize: '14px' }}>
                                            <span>Total Files</span>
                                            <span>{files.length}</span>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', opacity: 0.7, fontSize: '14px' }}>
                                            <span>Total Pages</span>
                                            <span>{files.reduce((acc, f) => acc + f.pages * f.settings.copies, 0)}</span>
                                        </div>
                                        <div style={{ height: '1px', background: 'rgba(255,255,255,0.1)' }} />
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '18px', fontWeight: '900' }}>
                                            <span>Estimated Price</span>
                                            <span style={{ color: 'var(--accent)' }}>₹{(files.reduce((acc, f) => acc + f.pages * f.settings.copies * (f.settings.color === 'color' ? 7.00 : 2.00), 0)).toFixed(2)}</span>
                                        </div>
                                    </div>

                                    <button onClick={handleContinue} className="btn btn-accent btn-full btn-lg" style={{ height: '60px', borderRadius: '18px', fontSize: '16px', fontWeight: '900' }} disabled={uploading}>
                                        {uploading ? <span className="spinner" /> : <><CheckCircle size={20} /> Confirm & Pay</>}
                                    </button>

                                    <p style={{ fontSize: '12px', opacity: 0.4, textAlign: 'center', marginTop: '16px' }}>Securely handled using TN-encryption</p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </section>

            {editingFileId && files.find(f => f.id === editingFileId) && (
                <PrintSettingsModal
                    file={files.find(f => f.id === editingFileId)!}
                    onClose={() => setEditingFileId(null)}
                    onSave={(newSettings, applyAll) => {
                        if (applyAll) {
                            setFiles(prev => prev.map(f => ({ ...f, settings: { ...f.settings, ...newSettings } })));
                        } else {
                            updateFileSettings(editingFileId, newSettings);
                        }
                        setEditingFileId(null);
                    }}
                    hasMultiple={files.length > 1}
                />
            )}
        </div>
    );
}

function PrintSettingsModal({
    file,
    onClose,
    onSave,
    hasMultiple
}: {
    file: FileWithSettings;
    onClose: () => void;
    onSave: (settings: any, applyAll: boolean) => void;
    hasMultiple: boolean;
}) {
    const [settings, setSettings] = useState(file.settings);
    const [applyToAll, setApplyToAll] = useState(true);

    const update = (s: Partial<typeof settings>) => setSettings(prev => ({ ...prev, ...s }));
    const isDouble = settings.sides !== 'single';
    const previewTransform = settings.sides === 'double_long'
        ? 'rotateY(-18deg) rotateX(6deg)'
        : settings.sides === 'double_short'
            ? 'rotateX(-18deg) rotateY(6deg)'
            : 'scale(1)';
    const previewAnimation = settings.sides === 'double_long'
        ? 'flipLongEdge 2.4s ease-in-out infinite'
        : settings.sides === 'double_short'
            ? 'flipShortEdge 2.4s ease-in-out infinite'
            : 'none';

    return (
        <div className="fade-in" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
            <div style={{ background: 'var(--bg)', borderRadius: '24px', width: '100%', maxWidth: '800px', maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}>

                {/* Header */}
                <div style={{ padding: '24px 32px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 10 }}>
                    <div>
                        <h2 style={{ fontSize: '20px', fontWeight: '800' }}>Print Settings</h2>
                        <p style={{ fontSize: '13px', color: 'var(--fg-muted)', marginTop: '4px' }}>{file.file.name}</p>
                    </div>
                    <button onClick={onClose} className="btn-icon" style={{ background: 'var(--bg-secondary)', border: 'none', width: '36px', height: '36px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                        <X size={20} color="var(--fg-muted)" />
                    </button>
                </div>

                {/* Body */}
                <div style={{ padding: '32px', display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)', gap: '40px' }}>

                    {/* Left: Controls */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        <div>
                            <label className="input-label" style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fg-muted)', marginBottom: '12px', display: 'block' }}>Color Mode</label>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                {[{ label: 'Black & White', val: 'bw', icon: <FileText size={16} /> }, { label: 'Color', val: 'color', icon: <Palette size={16} /> }].map(opt => (
                                    <button key={opt.val} onClick={() => update({ color: opt.val as any })} className="mac-btn"
                                        style={{ padding: '12px', borderRadius: '12px', border: `2px solid ${settings.color === opt.val ? 'var(--accent)' : 'var(--border)'}`, background: settings.color === opt.val ? 'var(--accent)' : 'transparent', color: settings.color === opt.val ? 'white' : 'var(--fg)', fontWeight: '600', fontSize: '13px', cursor: 'pointer', transition: 'all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)', display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center' }}>
                                        {opt.icon} {opt.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <label className="input-label" style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fg-muted)', marginBottom: '12px', display: 'block' }}>Sidedness</label>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: '8px' }}>
                                {([
                                    { label: 'Single', val: 'single', icon: <FileText size={16} /> },
                                    { label: 'Double (Long Edge)', val: 'double_long', icon: <Layers size={16} /> },
                                    { label: 'Double (Short Edge)', val: 'double_short', icon: <Layers size={16} /> },
                                ] as const).map(opt => (
                                    <button key={opt.val} onClick={() => update({ sides: opt.val as any })} className="mac-btn"
                                        style={{ padding: '12px', borderRadius: '12px', border: `2px solid ${settings.sides === opt.val ? 'var(--accent)' : 'var(--border)'}`, background: settings.sides === opt.val ? 'var(--accent)' : 'transparent', color: settings.sides === opt.val ? 'white' : 'var(--fg)', fontWeight: '600', fontSize: '13px', cursor: 'pointer', transition: 'all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)', display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center' }}>
                                        {opt.icon} {opt.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                            <div>
                                <label className="input-label" style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fg-muted)', marginBottom: '12px', display: 'block' }}>Copies</label>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <button onClick={() => update({ copies: Math.max(1, settings.copies - 1) })} className="btn btn-outline btn-sm mac-btn" style={{ width: '40px', height: '40px', padding: 0, borderRadius: '50%' }}>−</button>
                                    <input type="number" min={1} max={100} value={settings.copies} onChange={e => update({ copies: Math.max(1, parseInt(e.target.value) || 1) })}
                                        style={{ width: '60px', textAlign: 'center', padding: '10px 8px', background: 'var(--bg-secondary)', border: '1.5px solid var(--border)', borderRadius: '12px', fontSize: '15px', fontWeight: '600', color: 'var(--fg)', outline: 'none' }} />
                                    <button onClick={() => update({ copies: settings.copies + 1 })} className="btn btn-outline btn-sm mac-btn" style={{ width: '40px', height: '40px', padding: 0, borderRadius: '50%' }}>+</button>
                                </div>
                            </div>
                            <div>
                                <label className="input-label" style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fg-muted)', marginBottom: '12px', display: 'block' }}>Pages Per Sheet</label>
                                <select value={settings.pagesPerSheet} onChange={e => update({ pagesPerSheet: Number(e.target.value) })} className="input" style={{ width: '100%', height: '44px', borderRadius: '12px', padding: '0 12px', border: '1.5px solid var(--border)', fontWeight: '600', fontSize: '14px', background: 'var(--bg-secondary)' }}>
                                    <option value={1}>1 page</option>
                                    <option value={2}>2 pages</option>
                                    <option value={4}>4 pages</option>
                                    <option value={6}>6 pages</option>
                                    <option value={9}>9 pages</option>
                                </select>
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                            <div>
                                <label className="input-label" style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fg-muted)', marginBottom: '12px', display: 'block' }}>Paper Size</label>
                                <select value={settings.paperSize} onChange={e => update({ paperSize: e.target.value as any })} className="input" style={{ width: '100%', height: '44px', borderRadius: '12px', padding: '0 12px', border: '1.5px solid var(--border)', fontWeight: '600', fontSize: '14px', background: 'var(--bg-secondary)' }}>
                                    <option value="a4">A4</option>
                                    <option value="a3">A3</option>
                                    <option value="legal">Legal</option>
                                </select>
                            </div>
                            <div>
                                <label className="input-label" style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fg-muted)', marginBottom: '12px', display: 'block' }}>Margins</label>
                                <select value={settings.margins} onChange={e => update({ margins: e.target.value as any })} className="input" style={{ width: '100%', height: '44px', borderRadius: '12px', padding: '0 12px', border: '1.5px solid var(--border)', fontWeight: '600', fontSize: '14px', background: 'var(--bg-secondary)' }}>
                                    <option value="default">Default</option>
                                    <option value="none">None</option>
                                    <option value="minimum">Minimum</option>
                                </select>
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                            <div>
                                <label className="input-label" style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fg-muted)', marginBottom: '12px', display: 'block' }}>Pages to Print</label>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                                    {(['all', 'odd', 'even', 'range'] as const).map(range => (
                                        <button
                                            key={range}
                                            type="button"
                                            className="mac-btn"
                                            onClick={() => update({ pageRange: range })}
                                            style={{ padding: '8px 4px', borderRadius: '10px', border: `2px solid ${settings.pageRange === range ? 'var(--accent)' : 'var(--border)'}`, background: settings.pageRange === range ? 'var(--accent)' : 'transparent', color: settings.pageRange === range ? 'white' : 'var(--fg)', fontSize: '11px', fontWeight: '700' }}
                                        >
                                            {range.toUpperCase()}
                                        </button>
                                    ))}
                                </div>
                                {settings.pageRange === 'range' && (
                                    <input className="input" placeholder="e.g. 1-3, 7, 10-12" value={settings.customRange} onChange={e => update({ customRange: e.target.value })} style={{ marginTop: '10px' }} />
                                )}
                            </div>
                            <div>
                                <label className="input-label" style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fg-muted)', marginBottom: '12px', display: 'block' }}>Scale</label>
                                <select value={settings.scale} onChange={e => update({ scale: e.target.value as any })} className="input" style={{ width: '100%', height: '44px', borderRadius: '12px', padding: '0 12px', border: '1.5px solid var(--border)', fontWeight: '600', fontSize: '14px', background: 'var(--bg-secondary)', marginBottom: '12px' }}>
                                    <option value="default">Default</option>
                                    <option value="fit">Fit to paper</option>
                                    <option value="custom">Custom</option>
                                </select>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--fg-muted)', marginBottom: '8px' }}>
                                    <input type="checkbox" checked={settings.headersFooters} onChange={e => update({ headersFooters: e.target.checked })} />
                                    Headers and footers
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--fg-muted)' }}>
                                    <input type="checkbox" checked={settings.backgroundGraphics} onChange={e => update({ backgroundGraphics: e.target.checked })} />
                                    Background graphics
                                </label>
                            </div>
                        </div>
                    </div>

                    {/* Right: Live Preview */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        <label className="input-label" style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fg-muted)', marginBottom: '-8px' }}>Orientation & Preview</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                            {([{ label: 'Portrait', val: 'portrait' }, { label: 'Landscape', val: 'landscape' }] as const).map(opt => (
                                <button key={opt.val} onClick={() => update({ orientation: opt.val as any })} className="mac-btn"
                                    style={{ padding: '10px', borderRadius: '10px', border: `2px solid ${settings.orientation === opt.val ? 'var(--accent)' : 'var(--border)'}`, background: settings.orientation === opt.val ? 'var(--accent)' : 'transparent', color: settings.orientation === opt.val ? 'white' : 'var(--fg)', fontWeight: '600', fontSize: '12px', cursor: 'pointer', transition: 'all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)' }}>
                                    {opt.label}
                                </button>
                            ))}
                        </div>

                        <div style={{ flex: 1, minHeight: '260px', background: 'var(--bg-tertiary)', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border)', perspective: '1000px', overflow: 'hidden' }}>
                            <div style={{
                                width: settings.orientation === 'portrait' ? '120px' : '160px',
                                height: settings.orientation === 'portrait' ? '160px' : '120px',
                                background: 'white',
                                border: '1px solid rgba(0,0,0,0.1)',
                                borderRadius: '4px',
                                transition: 'all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
                                display: 'grid',
                                gridTemplateColumns: `repeat(${Math.ceil(Math.sqrt(settings.pagesPerSheet))}, 1fr)`,
                                gridTemplateRows: `repeat(${Math.ceil(settings.pagesPerSheet / Math.ceil(Math.sqrt(settings.pagesPerSheet)))}, 1fr)`,
                                padding: '4px',
                                gap: '4px',
                                boxShadow: isDouble ? '-10px 10px 20px rgba(0,0,0,0.15), inset -2px 0 10px rgba(0,0,0,0.05)' : '0 10px 30px rgba(0,0,0,0.1)',
                                transform: previewTransform,
                                transformStyle: 'preserve-3d',
                                animation: previewAnimation
                            }}>
                                {Array.from({ length: settings.pagesPerSheet }).map((_, i) => (
                                    <div key={i} style={{
                                        border: '1px solid rgba(0,0,0,0.05)',
                                        background: settings.color === 'color' ? 'linear-gradient(135deg, rgba(59,130,246,0.08), rgba(239,68,68,0.08))' : 'rgba(0,0,0,0.03)',
                                        borderRadius: '2px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        padding: '4px',
                                        gap: '3px',
                                        overflow: 'hidden'
                                    }}>
                                        <div style={{ height: '3px', width: '90%', background: settings.color === 'color' ? '#3b82f6' : '#cbd5e1', borderRadius: '2px', transition: 'all 0.4s ease' }} />
                                        <div style={{ height: '2px', width: '70%', background: settings.color === 'color' ? '#f59e0b' : '#e2e8f0', borderRadius: '1px', transition: 'all 0.4s ease' }} />
                                        <div style={{ height: '2px', width: '80%', background: settings.color === 'color' ? '#ef4444' : '#e2e8f0', borderRadius: '1px', transition: 'all 0.4s ease' }} />
                                        <div style={{ height: '2px', width: '50%', background: settings.color === 'color' ? '#10b981' : '#e2e8f0', borderRadius: '1px', transition: 'all 0.4s ease' }} />
                                    </div>
                                ))}
                                {/* Back page representation for double sided */}
                                {isDouble && (
                                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'white', borderRadius: '4px', border: '1px solid rgba(0,0,0,0.1)', transform: 'translateZ(-1px)', boxShadow: '0 0 5px rgba(0,0,0,0.05)' }} />
                                )}
                                {isDouble && (
                                    <div style={{
                                        position: 'absolute',
                                        left: settings.sides === 'double_long' ? '50%' : '8px',
                                        top: settings.sides === 'double_long' ? '8px' : '50%',
                                        width: settings.sides === 'double_long' ? '1px' : 'calc(100% - 16px)',
                                        height: settings.sides === 'double_long' ? 'calc(100% - 16px)' : '1px',
                                        background: 'rgba(232,123,53,0.45)',
                                        transform: settings.sides === 'double_long' ? 'translateX(-0.5px)' : 'translateY(-0.5px)',
                                    }} />
                                )}
                            </div>
                        </div>
                        <p style={{ fontSize: '12px', color: 'var(--fg-muted)', lineHeight: '1.5' }}>
                            {settings.sides === 'double_long' && 'Double-sided (Long Edge): pages flip like a book.'}
                            {settings.sides === 'double_short' && 'Double-sided (Short Edge): pages flip like a notepad.'}
                            {settings.sides === 'single' && 'Single-sided printing preview.'}
                        </p>
                    </div>
                </div>

                {/* Footer */}
                <div style={{ padding: '24px 32px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-secondary)', borderBottomLeftRadius: '24px', borderBottomRightRadius: '24px' }}>
                    {hasMultiple ? (
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                            <input type="checkbox" checked={applyToAll} onChange={e => setApplyToAll(e.target.checked)} style={{ width: '18px', height: '18px', accentColor: 'var(--accent)' }} />
                            <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--fg)' }}>Apply to all documents</span>
                        </label>
                    ) : <div />}
                    <div style={{ display: 'flex', gap: '12px' }}>
                        <button onClick={onClose} className="btn btn-outline mac-btn" style={{ padding: '12px 24px', borderRadius: '12px', fontWeight: '600', fontSize: '14px' }}>Cancel</button>
                        <button onClick={() => onSave(settings, applyToAll)} className="btn btn-accent mac-btn" style={{ padding: '12px 24px', borderRadius: '12px', fontWeight: '800', fontSize: '14px' }}>Apply Settings</button>
                    </div>
                </div>
                <style>{`
                 .mac-btn:active { transform: scale(0.96) !important; }
                 @keyframes flipLongEdge {
                    0%, 100% { transform: rotateY(-18deg) rotateX(6deg); }
                    50% { transform: rotateY(-8deg) rotateX(6deg); }
                 }
                 @keyframes flipShortEdge {
                    0%, 100% { transform: rotateX(-18deg) rotateY(6deg); }
                    50% { transform: rotateX(-8deg) rotateY(6deg); }
                 }
             `}</style>
            </div>
        </div>
    );
}
