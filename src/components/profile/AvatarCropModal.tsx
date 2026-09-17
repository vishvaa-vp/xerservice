'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    X,
    ZoomIn,
    ZoomOut,
    RotateCw,
    RefreshCw,
    Check,
    Square,
    Circle,
    Move,
} from 'lucide-react';

interface AvatarCropModalProps {
    open: boolean;
    imageSrc: string | null;
    onClose: () => void;
    onSave: (croppedDataUrl: string) => void;
}

const FRAME_SIZE = 260; // Size of the crop frame in pixels
const VIEWPORT_SIZE = 320; // Size of the interactive viewport box
const EXPORT_SIZE = 400; // Resolution of the exported square avatar

export default function AvatarCropModal({
    open,
    imageSrc,
    onClose,
    onSave,
}: AvatarCropModalProps) {
    const [imgNaturalSize, setImgNaturalSize] = useState<{ width: number; height: number } | null>(null);
    const [zoom, setZoom] = useState(1);
    const [rotation, setRotation] = useState(0);
    const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
    const [frameShape, setFrameShape] = useState<'squircle' | 'circle'>('squircle');
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);

    const viewportRef = useRef<HTMLDivElement>(null);
    const imageRef = useRef<HTMLImageElement | null>(null);

    // Reset parameters when a new image is loaded
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

    // Calculate base fit scale so image covers the frame at minimum zoom
    const getFitScale = useCallback(() => {
        if (!imgNaturalSize) return 1;
        const { width, height } = imgNaturalSize;
        // Swap dimensions if rotated 90 or 270 deg
        const isSideways = rotation === 90 || rotation === 270;
        const effectiveW = isSideways ? height : width;
        const effectiveH = isSideways ? width : height;
        return Math.max(FRAME_SIZE / effectiveW, FRAME_SIZE / effectiveH);
    }, [imgNaturalSize, rotation]);

    // Generate offscreen canvas crop
    const generateCroppedImage = useCallback((): string | null => {
        if (!imageRef.current || !imgNaturalSize) return null;

        const canvas = document.createElement('canvas');
        canvas.width = EXPORT_SIZE;
        canvas.height = EXPORT_SIZE;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        const fitScale = getFitScale();
        const scale = EXPORT_SIZE / FRAME_SIZE;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, EXPORT_SIZE, EXPORT_SIZE);

        ctx.save();
        // Translate to canvas center plus offset (scaled to canvas coordinates)
        ctx.translate(
            EXPORT_SIZE / 2 + offset.x * scale,
            EXPORT_SIZE / 2 + offset.y * scale
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

    // Update live preview when user adjusts frame
    useEffect(() => {
        if (!open || !imgNaturalSize) return;
        const timer = setTimeout(() => {
            const url = generateCroppedImage();
            if (url) setPreviewUrl(url);
        }, 80);
        return () => clearTimeout(timer);
    }, [open, imgNaturalSize, zoom, rotation, offset, generateCroppedImage]);

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

    const handleMouseUp = () => {
        setIsDragging(false);
    };

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

    const handleTouchEnd = () => {
        setIsDragging(false);
    };

    // Wheel zoom
    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        const delta = e.deltaY * -0.002;
        setZoom(prev => Math.min(3, Math.max(1, Math.round((prev + delta) * 100) / 100)));
    };

    const handleRotate = () => {
        setRotation(prev => (prev + 90) % 360);
        setOffset({ x: 0, y: 0 }); // Center on rotate
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
    const frameRadius = frameShape === 'circle' ? '50%' : '32px';

    return (
        <div className="confirm-overlay" role="dialog" aria-modal="true" style={{ zIndex: 1200 }}>
            <div
                className="confirm-card scale-in"
                style={{
                    width: 'min(100%, 460px)',
                    padding: '28px',
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

                <div style={{ marginBottom: '18px' }}>
                    <h2 style={{ fontSize: '20px', fontWeight: '900', margin: 0, letterSpacing: '-0.02em' }}>
                        Set Profile Frame
                    </h2>
                    <p style={{ fontSize: '13px', color: 'var(--fg-muted)', margin: '4px 0 0' }}>
                        Drag to position and zoom to fit your picture into the frame
                    </p>
                </div>

                {/* Interactive Viewport Area */}
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '18px' }}>
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
                            width: `${VIEWPORT_SIZE}px`,
                            height: `${VIEWPORT_SIZE}px`,
                            position: 'relative',
                            overflow: 'hidden',
                            borderRadius: '20px',
                            background: '#0a0a10',
                            cursor: isDragging ? 'grabbing' : 'grab',
                            userSelect: 'none',
                            touchAction: 'none',
                            border: '1px solid var(--border)',
                        }}
                    >
                        {/* The Image inside the viewport */}
                        {imgNaturalSize && (
                            <img
                                src={imageSrc}
                                alt="Crop target"
                                draggable={false}
                                style={{
                                    position: 'absolute',
                                    top: '50%',
                                    left: '50%',
                                    transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) rotate(${rotation}deg) scale(${fitScale * zoom})`,
                                    transformOrigin: 'center center',
                                    maxWidth: 'none',
                                    maxHeight: 'none',
                                    pointerEvents: 'none',
                                    userSelect: 'none',
                                }}
                            />
                        )}

                        {/* Darkened Mask & Crop Frame Outline */}
                        <div
                            style={{
                                position: 'absolute',
                                top: `${(VIEWPORT_SIZE - FRAME_SIZE) / 2}px`,
                                left: `${(VIEWPORT_SIZE - FRAME_SIZE) / 2}px`,
                                width: `${FRAME_SIZE}px`,
                                height: `${FRAME_SIZE}px`,
                                borderRadius: frameRadius,
                                boxShadow: '0 0 0 9999px rgba(10, 10, 18, 0.65)',
                                border: '2.5px solid var(--accent)',
                                pointerEvents: 'none',
                                transition: 'border-radius 0.2s ease',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            {/* Subtle crosshair center mark */}
                            <div style={{ width: '10px', height: '1px', background: 'rgba(255,255,255,0.4)', position: 'absolute' }} />
                            <div style={{ width: '1px', height: '10px', background: 'rgba(255,255,255,0.4)', position: 'absolute' }} />
                        </div>

                        {/* Hint Badge */}
                        <div
                            style={{
                                position: 'absolute',
                                bottom: '10px',
                                left: '50%',
                                transform: 'translateX(-50%)',
                                background: 'rgba(0,0,0,0.6)',
                                backdropFilter: 'blur(6px)',
                                color: '#fff',
                                padding: '4px 10px',
                                borderRadius: '100px',
                                fontSize: '11px',
                                fontWeight: '700',
                                pointerEvents: 'none',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '5px',
                            }}
                        >
                            <Move size={12} /> Drag to adjust
                        </div>
                    </div>
                </div>

                {/* Zoom Controls */}
                <div style={{ marginBottom: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: '700', color: 'var(--fg-muted)', marginBottom: '8px' }}>
                        <span>Zoom</span>
                        <span>{Math.round(zoom * 100)}%</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <button
                            type="button"
                            onClick={() => setZoom(prev => Math.max(1, Math.round((prev - 0.1) * 10) / 10))}
                            className="btn btn-outline"
                            style={{ padding: '6px 10px', height: 'auto', minHeight: 'unset' }}
                            aria-label="Zoom out"
                        >
                            <ZoomOut size={15} />
                        </button>

                        <input
                            type="range"
                            min="1"
                            max="3"
                            step="0.02"
                            value={zoom}
                            onChange={(e) => setZoom(parseFloat(e.target.value))}
                            style={{
                                flex: 1,
                                accentColor: 'var(--accent)',
                                cursor: 'pointer',
                            }}
                        />

                        <button
                            type="button"
                            onClick={() => setZoom(prev => Math.min(3, Math.round((prev + 0.1) * 10) / 10))}
                            className="btn btn-outline"
                            style={{ padding: '6px 10px', height: 'auto', minHeight: 'unset' }}
                            aria-label="Zoom in"
                        >
                            <ZoomIn size={15} />
                        </button>
                    </div>
                </div>

                {/* Tool buttons: Rotate, Reset, Frame Shape & Live Preview */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginBottom: '22px' }}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                            type="button"
                            onClick={handleRotate}
                            className="btn btn-outline btn-sm"
                            title="Rotate 90 degrees"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}
                        >
                            <RotateCw size={13} /> Rotate
                        </button>
                        <button
                            type="button"
                            onClick={handleReset}
                            className="btn btn-outline btn-sm"
                            title="Reset position and zoom"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}
                        >
                            <RefreshCw size={13} /> Reset
                        </button>
                        <button
                            type="button"
                            onClick={() => setFrameShape(prev => prev === 'squircle' ? 'circle' : 'squircle')}
                            className="btn btn-outline btn-sm"
                            title="Switch frame shape"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}
                        >
                            {frameShape === 'squircle' ? <Circle size={13} /> : <Square size={13} />}
                            {frameShape === 'squircle' ? 'Circle' : 'Square'}
                        </button>
                    </div>

                    {/* Live Preview Avatar */}
                    {previewUrl && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--fg-muted)' }}>Preview:</span>
                            <div
                                style={{
                                    width: '38px',
                                    height: '38px',
                                    borderRadius: frameRadius,
                                    overflow: 'hidden',
                                    border: '1.5px solid var(--border)',
                                    boxShadow: 'var(--shadow-sm)',
                                    flexShrink: 0,
                                }}
                            >
                                <img src={previewUrl} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            </div>
                        </div>
                    )}
                </div>

                {/* Modal Footer Actions */}
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                        type="button"
                        onClick={onClose}
                        className="btn btn-outline"
                        style={{ flex: 1 }}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        className="btn btn-accent"
                        style={{
                            flex: 2,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                            fontWeight: '800',
                        }}
                    >
                        <Check size={16} /> Set Profile Picture
                    </button>
                </div>
            </div>
        </div>
    );
}
