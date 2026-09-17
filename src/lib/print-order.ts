import { calculatePrice } from './mock-data';
import { selectedPageNumbers, type PrintSettings } from './print-settings';

export interface PrintDocument {
    id: string;
    name: string;
    file?: File;
    pages: number;
    settings: PrintSettings;
    storagePath?: string;
    fileSizeBytes?: number;
    mimeType?: string;
}

export function documentPrintTotals(document: Pick<PrintDocument, 'pages' | 'settings'>, rates?: { bwPerPage?: number; colorPerPage?: number }) {
    const { settings } = document;
    const selected = selectedPageNumbers(document.pages, settings).length;
    const faces = Math.ceil(selected / Math.max(1, settings.pagesPerSheet));
    const sheets = settings.sides === 'single' ? faces : Math.ceil(faces / 2);
    return {
        faces: faces * settings.copies,
        sheets: sheets * settings.copies,
        amount: faces ? calculatePrice(faces, settings.color === 'color', settings.sides, settings.copies, rates) : 0,
    };
}

export function summarizePrintDocuments(documents: PrintDocument[], rates?: { bwPerPage?: number; colorPerPage?: number }) {
    const first = documents[0]?.settings;
    return {
        documents,
        files: documents.flatMap(document => typeof File !== 'undefined' && document.file instanceof File ? [document.file] : []),
        totalFiles: documents.length,
        fileName: documents.length === 1 ? documents[0].name : `${documents.length} files`,
        pages: documents.reduce((sum, document) => sum + document.pages, 0),
        totalEstimatedPages: documents.reduce((sum, document) => sum + documentPrintTotals(document, rates).faces, 0),
        color: first?.color === 'color',
        sides: first?.sides || 'single',
        orientation: first?.orientation || 'portrait',
        copies: documents.length === 1 ? first.copies : 1,
        totalAmount: Math.round(documents.reduce((sum, document) => sum + documentPrintTotals(document, rates).amount, 0) * 100) / 100,
    };
}
