/**
 * Authoritative Print Settings & Layout Utilities
 * Re-exported from @packages/types and @packages/shared for backward compatibility.
 */

export type {
    PrintSettings,
    DbPrintSettings,
    ColorMode,
    PrintSides,
    PaperSize,
    PageOrientation,
    PageSelectionMode,
    MarginMode,
    ScaleMode,
} from '@packages/types';

export {
    selectedPageNumbers,
    sheetDimensions,
    pagesOnSide,
    toDbPrintSettings,
    fromDbPrintSettings,
} from '@packages/shared';
