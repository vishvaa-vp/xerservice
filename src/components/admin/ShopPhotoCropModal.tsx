'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    X,
    ZoomIn,
    ZoomOut,
    RotateCw,
    RefreshCw,
    Check,
    Move,
    Info,
} from 'lucide-react';

interface ShopPhotoCropModalProps {
    open: boolean;
    imageSrc: string | null;
    fileInfo?: { name: string; sizeKb: number } | null;
    onClose: () => void;
    onSave: (croppedDataUrl: string) => void;
}

// 16:9 Landscape Frame Dimensions for the interactive viewport
const FRAME_W = 360;
const FRAME_H = 202.5; // 360 * 9 / 16
const VIEWPORT_W = 380;
const VIEWPORT_H = 222.5;
// High-res export for sharp storefront display across devices
const EXPORT_W = 1280;
const EXPORT_H = 720;

export default function ShopPhotoCropModal({
    open,
    imageSrc,
    fileInfo,
    onClose,
    onSave,
}: ShopPhotoCropModalProps) {
    const [imgNaturalSize, setImgNaturalSize] = useState<{ width: number; height: number } | null>(null);
    const [zoom, setZoom] = useState(1);
    const [rotation, setRotation] = useState(0);
    const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

    const viewportRef = useRef<HTMLDivElement>(null);
    const imageRef = useRef<HTMLImageElement | null>(null);

    useEffect(() => {
        if (open && imageSrc) {
            setZoom(1);
            setRotation(0);
            setOffset({ x: 0, y: 0 });
            setImgNaturalSize(null);

            const img = new Image();
            img.onload = () => {
                setImgNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
            };
            img.src = imageSrc;
            imageRef.current = img;
        }
    }, [open, imageSrc]);

    // Compute base scale to cover the 16:9 frame at 1x zoom
    const getFitScale = useCallback(() => {
        if (!imgNaturalSize) return 1;
        const { width, height } = imgNaturalSize;
        const isSideways = rotation === 90 || rotation === 270;
        const effectiveW = isSideways ? height : width;
        const effectiveH = isSideways ? width : height;
        return Math.max(FRAME_W / effectiveW, FRAME_H / effectiveH);
    }, [imgNaturalSize, rotation]);

    // Offscreen high-res crop to 1280x720
    const generateCroppedImage = useCallback((): string | null => {
        if (!imageRef.current || !imgNaturalSize) return null;

        const canvas = document.createElement('canvas');
        canvas.width = EXPORT_W;
        canvas.height = EXPORT_H;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        const fitScale = getFitScale();
        const scale = EXPORT_W / FRAME_W;

        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, EXPORT_W, EXPORT_H);

        ctx.save();
        ctx.translate(
            EXPORT_W / 2 + offset.x * scale,
            EXPORT_H / 2 + offset.y * scale
        );
        ctx.rotate((rotation * Math.PI) / 180);

        const drawW = imgNaturalSize.width * fitScale * zoom * scale;
        const drawH = imgNaturalSize.height * fitScale * zoom * scale;

        ctx.drawImage(
            imageRef.current,
            -drawW / 2,
            -drawH / 2,
            drawW,
            drawH
        );
        ctx.restore();

        return canvas.toDataURL('image/jpeg', 0.92);
    }, [imgNaturalSize, getFitScale, offset, rotation, zoom]);

    if (!open || !imageSrc) return null;

    // Mouse drag handlers
    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        setIsDragging(true);
        setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDragging) return;
        setOffset({
            x: e.clientX - dragStart.x,
            y: e.clientY - dragStart.y,
        });
    };

    const handleMouseUp = () => setIsDragging(false);

    // Touch drag handlers
    const handleTouchStart = (e: React.TouchEvent) => {
        if (e.touches.length === 1) {
            const touch = e.touches[0];
            setIsDragging(true);
            setDragStart({ x: touch.clientX - offset.x, y: touch.clientY - offset.y });
        }
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (!isDragging || e.touches.length !== 1) return;
        const touch = e.touches[0];
        setOffset({
            x: touch.clientX - dragStart.x,
            y: touch.clientY - dragStart.y,
        });
    };

    const handleTouchEnd = () => setIsDragging(false);

    // Wheel zoom
    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        const delta = e.deltaY * -0.002;
        setZoom(prev => Math.min(3, Math.max(1, Math.round((prev + delta) * 100) / 100)));
    };

    const handleRotate = () => {
        setRotation(prev => (prev + 90) % 360);
        setOffset({ x: 0, y: 0 });
    };

    const handleReset = () => {
        setZoom(1);
        setRotation(0);
        setOffset({ x: 0, y: 0 });
    };

    const handleSave = () => {
        const cropped = generateCroppedImage();
        if (cropped) {
            onSave(cropped);
            onClose();
        }
    };

    const fitScale = getFitScale();
    const naturalRatio = imgNaturalSize ? (imgNaturalSize.width / imgNaturalSize.height).toFixed(2) : '1.78';
    const isExact169 = imgNaturalSize && Math.abs((imgNaturalSize.width / imgNaturalSize.height) - (16 / 9)) < 0.05;

    return (
        <div className="confirm-overlay" role="dialog" aria-modal="true" style={{ zIndex: 1200 }}>
            <div
                className="confirm-card scale-in"
                style={{
                    width: 'min(100%, 520px)',
                    padding: '24px',
                    borderRadius: '24px',
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    boxShadow: '0 24px 60px rgba(0,0,0,0.3)',
                    maxHeight: '94vh',
                    overflowY: 'auto',
                }}
            >
                <button
                    className="confirm-close"
                    onClick={onClose}
                    aria-label="Close modal"
                    style={{ cursor: 'pointer' }}
                >
                    <X size={18} />
                </button>

                {/* Header */}
                <div style={{ marginBottom: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <h2 style={{ fontSize: '19px', fontWeight: '900', margin: 0, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
                            Shop Photo & Framing
                        </h2>
                        <span style={{ fontSize: '11px', fontWeight: '800', background: 'rgba(0, 240, 255, 0.15)', color: 'var(--accent)', padding: '2px 8px', borderRadius: '6px' }}>
                            16:9 Storefront Fit
                        </span>
                    </div>
                    <p style={{ fontSize: '12px', color: 'var(--fg-muted)', margin: '4px 0 0' }}>
                        Position and zoom your photo to fit the customer discovery card perfectly.
                    </p>
                </div>

                {/* Size & Dimension Analyzer Card */}
                {imgNaturalSize && (
                    <div style={{
                        padding: '10px 14px',
                        borderRadius: '12px',
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border)',
                        marginBottom: '16px',
                        fontSize: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '8px',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Info size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                            <div>
                                <span style={{ fontWeight: '700', color: 'var(--fg)' }}>
                                    {imgNaturalSize.width} × {imgNaturalSize.height} px
                                </span>
                                {fileInfo && (
                                    <span style={{ color: 'var(--fg-muted)', marginLeft: '6px' }}>
                                        ({fileInfo.sizeKb} KB)
                                    </span>
                                )}
                                <span style={{ color: 'var(--fg-muted)', marginLeft: '6px' }}>
                                    • Ratio: {naturalRatio}:1
                                </span>
                            </div>
                        </div>

                        <div>
                            {isExact169 ? (
                                <span style={{ fontSize: '11px', fontWeight: '800', color: '#22c55e', background: 'rgba(34, 197, 94, 0.12)', padding: '2px 8px', borderRadius: '6px' }}>
                                    ✓ 16:9 Match
                                </span>
                            ) : (
                                <span style={{ fontSize: '11px', fontWeight: '800', color: '#f59e0b', background: 'rgba(245, 158, 11, 0.12)', padding: '2px 8px', borderRadius: '6px' }}>
                                    Adjusted to 16:9
                                </span>
                            )}
                        </div>
                    </div>
                )}

                {/* Interactive Viewport Area */}
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
                    <div
                        ref={viewportRef}
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={handleMouseUp}
                        onTouchStart={handleTouchStart}
                        onTouchMove={handleTouchMove}
                        onTouchEnd={handleTouchEnd}
                        onWheel={handleWheel}
                        style={{
                            width: `${VIEWPORT_W}px`,
                            height: `${VIEWPORT_H}px`,
                            position: 'relative',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: '#090d16',
                            borderRadius: '16px',
                            overflow: 'hidden',
                            cursor: isDragging ? 'grabbing' : 'grab',
                            userSelect: 'none',
                            touchAction: 'none',
                            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)',
                        }}
                    >
                        {/* The Scaled and Transformed Image */}
                        {imgNaturalSize && (
                            <div
                                style={{
                                    position: 'absolute',
                                    transform: `translate(${offset.x}px, ${offset.y}px) rotate(${rotation}deg)`,
                                    transformOrigin: 'center center',
                                    transition: isDragging ? 'none' : 'transform 0.08s ease-out',
                                }}
                            >
                                <img
                                    src={imageSrc}
                                    alt="Crop target"
                                    draggable={false}
                                    style={{
                                        display: 'block',
                                        width: `${imgNaturalSize.width * fitScale * zoom}px`,
                                        height: `${imgNaturalSize.height * fitScale * zoom}px`,
                                        maxWidth: 'none',
                                        pointerEvents: 'none',
                                    }}
                                />
                            </div>
                        )}

                        {/* Dark Vignette Overlay Outside the 16:9 Frame */}
                        <div
                            style={{
                                position: 'absolute',
                                inset: 0,
                                pointerEvents: 'none',
                                boxShadow: `0 0 0 9999px rgba(0, 0, 0, 0.65)`,
                                width: `${FRAME_W}px`,
                                height: `${FRAME_H}px`,
                                margin: 'auto',
                                borderRadius: '12px',
                            }}
                        />

                        {/* 16:9 Frame Border & Grid */}
                        <div
                            style={{
                                position: 'absolute',
                                width: `${FRAME_W}px`,
                                height: `${FRAME_H}px`,
                                borderRadius: '12px',
                                border: '2px solid var(--accent)',
                                pointerEvents: 'none',
                                boxShadow: '0 0 20px rgba(0, 240, 255, 0.25)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            {/* Rule of thirds grid lines */}
                            <div style={{ position: 'absolute', left: '33.33%', top: 0, bottom: 0, width: '1px', background: 'rgba(255,255,255,0.15)' }} />
                            <div style={{ position: 'absolute', left: '66.66%', top: 0, bottom: 0, width: '1px', background: 'rgba(255,255,255,0.15)' }} />
                            <div style={{ position: 'absolute', top: '33.33%', left: 0, right: 0, height: '1px', background: 'rgba(255,255,255,0.15)' }} />
                            <div style={{ position: 'absolute', top: '66.66%', left: 0, right: 0, height: '1px', background: 'rgba(255,255,255,0.15)' }} />

                            <div style={{
                                position: 'absolute',
                                bottom: '8px',
                                right: '8px',
                                background: 'rgba(0,0,0,0.6)',
                                backdropFilter: 'blur(4px)',
                                color: '#fff',
                                fontSize: '10px',
                                fontWeight: '700',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                            }}>
                                <Move size={10} /> Drag to pan
                            </div>
                        </div>
                    </div>
                </div>

                {/* Controls Bar */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
                    {/* Zoom Slider */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <button
                            type="button"
                            onClick={() => setZoom(prev => Math.max(1, Math.round((prev - 0.1) * 100) / 100))}
                            className="btn btn-ghost btn-sm"
                            style={{ padding: '6px', borderRadius: '8px', color: 'var(--fg-muted)' }}
                            aria-label="Zoom out"
                        >
                            <ZoomOut size={16} />
                        </button>
                        <input
                            type="range"
                            min="1"
                            max="3"
                            step="0.01"
                            value={zoom}
                            onChange={(e) => setZoom(parseFloat(e.target.value))}
                            style={{
                                flex: 1,
                                height: '5px',
                                borderRadius: '4px',
                                accentColor: 'var(--accent)',
                                cursor: 'pointer',
                            }}
                        />
                        <button
                            type="button"
                            onClick={() => setZoom(prev => Math.min(3, Math.round((prev + 0.1) * 100) / 100))}
                            className="btn btn-ghost btn-sm"
                            style={{ padding: '6px', borderRadius: '8px', color: 'var(--fg-muted)' }}
                            aria-label="Zoom in"
                        >
                            <ZoomIn size={16} />
                        </button>
                        <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--fg-muted)', width: '38px', textAlign: 'right' }}>
                            {Math.round(zoom * 100)}%
                        </span>
                    </div>

                    {/* Secondary Actions */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                                type="button"
                                onClick={handleRotate}
                                className="btn btn-outline btn-sm"
                                style={{ fontSize: '11.5px', padding: '5px 10px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '5px' }}
                            >
                                <RotateCw size={13} /> Rotate 90°
                            </button>
                            <button
                                type="button"
                                onClick={handleReset}
                                className="btn btn-ghost btn-sm"
                                style={{ fontSize: '11.5px', padding: '5px 10px', borderRadius: '8px', color: 'var(--fg-muted)', display: 'flex', alignItems: 'center', gap: '5px' }}
                            >
                                <RefreshCw size={13} /> Reset
                            </button>
                        </div>

                        <span style={{ fontSize: '11px', color: 'var(--fg-muted)' }}>
                            Export: 1280 × 720 px
                        </span>
                    </div>
                </div>

                {/* Footer Buttons */}
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', paddingTop: '14px', borderTop: '1px solid var(--border)' }}>
                    <button
                        type="button"
                        onClick={onClose}
                        className="btn btn-ghost"
                        style={{ fontSize: '13px', padding: '8px 16px', borderRadius: '10px' }}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        className="btn"
                        style={{
                            background: 'var(--accent)',
                            color: '#092b31',
                            fontWeight: '800',
                            fontSize: '13px',
                            padding: '8px 20px',
                            borderRadius: '10px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                        }}
                    >
                        <Check size={16} /> Apply 16:9 Fit
                    </button>
                </div>
            </div>
        </div>
    );
}
