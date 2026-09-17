//! Native Printing Errors and Canonical Mappings
//!
//! Maps OS and CUPS error states into canonical @packages/printing error codes.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CanonicalPrintErrorCode {
    PrinterNotFound,
    PrinterOffline,
    PrinterBusy,
    UnsupportedPaperSize,
    UnsupportedColorMode,
    UnsupportedDuplex,
    InvalidDocument,
    PrintSubmissionFailed,
    PrintCancelFailed,
    PrintTimeout,
    UnknownPrintError,
}

impl CanonicalPrintErrorCode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::PrinterNotFound => "PRINTER_NOT_FOUND",
            Self::PrinterOffline => "PRINTER_OFFLINE",
            Self::PrinterBusy => "PRINTER_BUSY",
            Self::UnsupportedPaperSize => "UNSUPPORTED_PAPER_SIZE",
            Self::UnsupportedColorMode => "UNSUPPORTED_COLOR_MODE",
            Self::UnsupportedDuplex => "UNSUPPORTED_DUPLEX",
            Self::InvalidDocument => "INVALID_DOCUMENT",
            Self::PrintSubmissionFailed => "PRINT_SUBMISSION_FAILED",
            Self::PrintCancelFailed => "PRINT_CANCEL_FAILED",
            Self::PrintTimeout => "PRINT_TIMEOUT",
            Self::UnknownPrintError => "UNKNOWN_PRINT_ERROR",
        }
    }
}

#[derive(Debug, Clone)]
pub enum NativePrintAdapterError {
    OsCommandFailed(String),
    ParseError(String),
    UnsupportedPlatform(String),
    PrinterNotFound(String),
}

impl std::fmt::Display for NativePrintAdapterError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::OsCommandFailed(msg) => write!(f, "OS printing command failed: {}", msg),
            Self::ParseError(msg) => write!(f, "Failed to parse printer output: {}", msg),
            Self::UnsupportedPlatform(msg) => write!(f, "Unsupported platform: {}", msg),
            Self::PrinterNotFound(msg) => write!(f, "Printer not found: {}", msg),
        }
    }
}

impl std::error::Error for NativePrintAdapterError {}

impl NativePrintAdapterError {
    pub fn canonical_code(&self) -> &'static str {
        match self {
            Self::PrinterNotFound(_) => CanonicalPrintErrorCode::PrinterNotFound.as_str(),
            Self::OsCommandFailed(_) => CanonicalPrintErrorCode::PrintSubmissionFailed.as_str(),
            Self::ParseError(_) => CanonicalPrintErrorCode::UnknownPrintError.as_str(),
            Self::UnsupportedPlatform(_) => CanonicalPrintErrorCode::UnknownPrintError.as_str(),
        }
    }
}
