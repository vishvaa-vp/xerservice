'use client';

import { Copy, FileText, Layers, Palette, RotateCw } from 'lucide-react';

type PrintSides = 'single' | 'double' | 'double_long' | 'double_short';
type Orientation = 'portrait' | 'landscape';

interface PrintOutputPreviewProps {
    color?: boolean;
    sides?: PrintSides;
    orientation?: Orientation;
    pagesPerSheet?: number;
    pages?: number;
    copies?: number;
    fileName?: string;
    price?: number;
    compact?: boolean;
    showDetails?: boolean;
}

export default function PrintOutputPreview({
    color = false,
    sides = 'single',
    orientation = 'portrait',
    pagesPerSheet = 1,
    pages = 1,
    copies = 1,
    fileName = 'Document',
    price,
    compact = false,
    showDetails = true,
}: PrintOutputPreviewProps) {
    const safePages = Math.max(1, pages || 1);
    const safeCopies = Math.max(1, copies || 1);
    const safePagesPerSheet = Math.max(1, Math.min(16, pagesPerSheet || 1));
    const isDouble = sides === 'double' || sides === 'double_long' || sides === 'double_short';
    const isShortEdge = sides === 'double_short';
    const columns = Math.ceil(Math.sqrt(safePagesPerSheet));
    const rows = Math.ceil(safePagesPerSheet / columns);
    const outputSheets = Math.max(1, Math.ceil(safePages / (isDouble ? 2 : 1)) * safeCopies);
    const visibleSlots = Array.from({ length: safePagesPerSheet });
    const sideLabel = isDouble ? (isShortEdge ? 'Double side, short edge' : 'Double side, long edge') : 'Single side';
    const outputLabel = `${outputSheets} printed sheet${outputSheets === 1 ? '' : 's'}`;

    return (
        <div className={`print-output-preview ${compact ? 'compact' : ''}`}>
            <div className="print-preview-stage">
                <div className={`print-preview-stack ${orientation} ${isDouble ? 'double' : 'single'} ${isShortEdge ? 'short-edge' : 'long-edge'}`}>
                    <div className="print-preview-sheet shadow-one" />
                    <div className="print-preview-sheet shadow-two" />
                    <div className="print-preview-flipper">
                        <div className="print-preview-face print-preview-front">
                            <div className="print-preview-page-grid" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
                                {visibleSlots.map((_, index) => (
                                    <div key={index} className={`print-preview-mini-page ${color ? 'color' : 'mono'}`}>
                                        <span />
                                        <span />
                                        <span />
                                        <span />
                                    </div>
                                ))}
                            </div>
                            <div className="print-preview-corner">Front</div>
                        </div>
                        <div className="print-preview-face print-preview-back">
                            <div className="print-preview-page-grid" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
                                {visibleSlots.map((_, index) => (
                                    <div key={index} className={`print-preview-mini-page back ${color ? 'color' : 'mono'}`}>
                                        <span />
                                        <span />
                                        <span />
                                    </div>
                                ))}
                            </div>
                            <div className="print-preview-corner">Back</div>
                        </div>
                    </div>
                    {isDouble && <div className="print-preview-hinge">{isShortEdge ? 'Short edge flip' : 'Long edge flip'}</div>}
                </div>
                {isDouble && (
                    <div className={`flip-path ${isShortEdge ? 'short' : 'long'}`}>
                        <RotateCw size={16} />
                    </div>
                )}
            </div>

            {showDetails && (
                <div className="print-preview-details">
                    <div className="print-preview-file">
                        <FileText size={16} />
                        <span>{fileName}</span>
                    </div>
                    <div className="print-preview-chips">
                        <span><Palette size={13} /> {color ? 'Color' : 'B and W'}</span>
                        <span><Layers size={13} /> {sideLabel}</span>
                        <span><Copy size={13} /> {safeCopies} cop{safeCopies === 1 ? 'y' : 'ies'}</span>
                        <span>{outputLabel}</span>
                    </div>
                    {typeof price === 'number' && (
                        <div className="print-preview-price">
                            <span>Estimated total</span>
                            <strong>Rs {price.toFixed(2)}</strong>
                        </div>
                    )}
                </div>
            )}

            <style>{`
                .print-output-preview {
                    width: 100%;
                    border: 1px solid var(--border);
                    border-radius: 18px;
                    background: var(--bg);
                    overflow: hidden;
                }
                .print-preview-stage {
                    min-height: ${compact ? '220px' : '300px'};
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    position: relative;
                    perspective: 1200px;
                    background:
                        linear-gradient(135deg, rgba(84, 189, 206, 0.12), transparent 42%),
                        repeating-linear-gradient(0deg, var(--bg-secondary), var(--bg-secondary) 12px, var(--bg-tertiary) 13px);
                    border-bottom: 1px solid var(--border);
                    overflow: hidden;
                }
                .print-preview-stack {
                    position: relative;
                    width: 150px;
                    height: 198px;
                    transform-style: preserve-3d;
                    transform: rotateX(8deg) rotateZ(-3deg);
                }
                .print-preview-stack.landscape {
                    width: 198px;
                    height: 150px;
                }
                .print-preview-stack.compact {
                    width: 120px;
                    height: 158px;
                }
                .print-preview-sheet,
                .print-preview-flipper,
                .print-preview-face {
                    position: absolute;
                    inset: 0;
                    border-radius: 8px;
                }
                .print-preview-sheet {
                    background: #f8fafc;
                    border: 1px solid rgba(15, 23, 42, 0.12);
                    box-shadow: 0 18px 34px rgba(15, 23, 42, 0.18);
                }
                .shadow-one {
                    transform: translate3d(13px, 13px, -18px);
                    opacity: 0.58;
                }
                .shadow-two {
                    transform: translate3d(7px, 7px, -8px);
                    opacity: 0.78;
                }
                .print-preview-flipper {
                    transform-style: preserve-3d;
                    animation: xerPreviewSettle 3.4s ease-in-out infinite;
                }
                .print-preview-stack.double.long-edge .print-preview-flipper {
                    transform-origin: left center;
                    animation-name: xerPreviewLongFlip;
                }
                .print-preview-stack.double.short-edge .print-preview-flipper {
                    transform-origin: center top;
                    animation-name: xerPreviewShortFlip;
                }
                .print-preview-face {
                    background: #ffffff;
                    border: 1px solid rgba(15, 23, 42, 0.16);
                    backface-visibility: hidden;
                    padding: 12px;
                    box-shadow: 0 24px 44px rgba(15, 23, 42, 0.22);
                }
                .print-preview-back {
                    transform: rotateY(180deg);
                    background: #fffaf5;
                }
                .print-preview-stack.short-edge .print-preview-back {
                    transform: rotateX(180deg);
                }
                .print-preview-page-grid {
                    display: grid;
                    gap: 6px;
                    width: 100%;
                    height: 100%;
                }
                .print-preview-mini-page {
                    min-width: 0;
                    min-height: 0;
                    border-radius: 4px;
                    border: 1px solid rgba(15, 23, 42, 0.08);
                    background: rgba(15, 23, 42, 0.035);
                    padding: 5px;
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                    overflow: hidden;
                }
                .print-preview-mini-page span {
                    height: 4px;
                    border-radius: 999px;
                    background: #cbd5e1;
                    display: block;
                }
                .print-preview-mini-page span:nth-child(1) { width: 88%; }
                .print-preview-mini-page span:nth-child(2) { width: 68%; }
                .print-preview-mini-page span:nth-child(3) { width: 78%; }
                .print-preview-mini-page span:nth-child(4) { width: 48%; }
                .print-preview-mini-page.color span:nth-child(1) { background: #2563eb; }
                .print-preview-mini-page.color span:nth-child(2) { background: #54bdce; }
                .print-preview-mini-page.color span:nth-child(3) { background: #ef4444; }
                .print-preview-mini-page.color span:nth-child(4) { background: #10b981; }
                .print-preview-mini-page.back {
                    background: rgba(84, 189, 206, 0.06);
                }
                .print-preview-corner {
                    position: absolute;
                    right: 8px;
                    bottom: 7px;
                    font-size: 10px;
                    line-height: 1;
                    font-weight: 800;
                    color: rgba(15, 23, 42, 0.38);
                    text-transform: uppercase;
                    letter-spacing: 0;
                }
                .print-preview-hinge {
                    position: absolute;
                    left: -16px;
                    top: 50%;
                    transform: translateY(-50%) rotate(-90deg);
                    z-index: 3;
                    padding: 4px 8px;
                    border-radius: 999px;
                    background: var(--accent);
                    color: var(--accent-fg);
                    font-size: 10px;
                    font-weight: 800;
                    box-shadow: var(--shadow-accent);
                    white-space: nowrap;
                    letter-spacing: 0;
                }
                .print-preview-stack.short-edge .print-preview-hinge {
                    left: 50%;
                    top: -18px;
                    transform: translateX(-50%);
                }
                .flip-path {
                    position: absolute;
                    width: 38px;
                    height: 38px;
                    border-radius: 999px;
                    background: var(--accent);
                    color: var(--accent-fg);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    right: calc(50% - 128px);
                    top: calc(50% - 18px);
                    box-shadow: var(--shadow-accent);
                    animation: xerPreviewPulse 1.7s ease-in-out infinite;
                }
                .flip-path.short {
                    right: calc(50% - 18px);
                    top: calc(50% - 128px);
                }
                .print-preview-details {
                    padding: 18px;
                    display: grid;
                    gap: 14px;
                }
                .print-preview-file {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    min-width: 0;
                    color: var(--fg);
                    font-size: 14px;
                    font-weight: 800;
                }
                .print-preview-file span {
                    min-width: 0;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .print-preview-chips {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                }
                .print-preview-chips span {
                    display: inline-flex;
                    align-items: center;
                    gap: 5px;
                    padding: 7px 10px;
                    border-radius: 999px;
                    background: var(--bg-secondary);
                    border: 1px solid var(--border);
                    color: var(--fg-muted);
                    font-size: 12px;
                    font-weight: 700;
                    letter-spacing: 0;
                }
                .print-preview-price {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                    padding-top: 12px;
                    border-top: 1px solid var(--border);
                    font-size: 13px;
                    color: var(--fg-muted);
                    font-weight: 700;
                }
                .print-preview-price strong {
                    color: var(--accent);
                    font-size: 24px;
                    line-height: 1;
                    letter-spacing: 0;
                }
                @keyframes xerPreviewSettle {
                    0%, 100% { transform: rotateY(0deg) rotateX(0deg); }
                    50% { transform: rotateY(-7deg) rotateX(3deg); }
                }
                @keyframes xerPreviewLongFlip {
                    0%, 18% { transform: rotateY(0deg); }
                    50% { transform: rotateY(-164deg); }
                    82%, 100% { transform: rotateY(0deg); }
                }
                @keyframes xerPreviewShortFlip {
                    0%, 18% { transform: rotateX(0deg); }
                    50% { transform: rotateX(164deg); }
                    82%, 100% { transform: rotateX(0deg); }
                }
                @keyframes xerPreviewPulse {
                    0%, 100% { transform: scale(1); opacity: 0.75; }
                    50% { transform: scale(1.12); opacity: 1; }
                }
                @media (max-width: 560px) {
                    .print-preview-stack {
                        width: 120px;
                        height: 158px;
                    }
                    .print-preview-stack.landscape {
                        width: 158px;
                        height: 120px;
                    }
                    .flip-path {
                        right: calc(50% - 104px);
                    }
                    .flip-path.short {
                        right: calc(50% - 18px);
                        top: calc(50% - 104px);
                    }
                }
            `}</style>
        </div>
    );
}
