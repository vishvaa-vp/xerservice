//! Native Printing Subsystem
//!
//! Exposes OS-level printer discovery, capability detection, and job submission for Tauri IPC.

pub mod capabilities;
pub mod control;
pub mod discovery;
pub mod errors;
pub mod persistence;
pub mod queue;
pub mod status;
pub mod submission;

pub use capabilities::{
    detect_printer_capabilities, NormalizedPrinter, PlatformPrintingCapabilitiesResponse,
    PrinterCapabilities,
};
pub use control::{cancel_native_print_job, is_cancellable_state, NativePrintCancelResponse};
pub use discovery::discover_installed_printers;
pub use errors::{CanonicalPrintErrorCode, NativePrintAdapterError};
pub use persistence::{
    find_by_any_id, find_by_native_job_id, find_by_order_id, get_all_records, get_record,
    recover_all_jobs, upsert_record, PrintJobRecord,
};
pub use queue::{get_native_print_queue, PrintQueueItem};
pub use status::{
    query_native_print_job_status, register_submitted_job, NativePrintJobStatusInfo,
};
pub use submission::{
    generate_deterministic_test_document, submit_native_print_job, NativePrintJobResponse,
    PrintJobSubmissionRequest,
};

/// Query platform printing capabilities for the current OS.
pub fn get_platform_capabilities() -> PlatformPrintingCapabilitiesResponse {
    let platform = std::env::consts::OS;
    let is_supported = platform == "macos" || platform == "linux" || platform == "windows";

    PlatformPrintingCapabilitiesResponse {
        supports_silent_printing: false,
        supports_job_cancellation: is_supported,
        supports_status_polling: is_supported,
        platform: if is_supported {
            platform.to_string()
        } else {
            "unsupported".to_string()
        },
        native_adapter_status: if is_supported {
            "DISCOVERY_AND_CAPABILITIES_READY".to_string()
        } else {
            "UNSUPPORTED_PLATFORM".to_string()
        },
        message: match platform {
            "macos" => "Native macOS CUPS printer discovery, capabilities, and print submission active.".to_string(),
            "linux" => "Native Linux CUPS printer discovery, capabilities, and print submission active.".to_string(),
            "windows" => "Native Windows Spooler printer discovery, capabilities, and print submission active.".to_string(),
            _ => format!("Platform '{}' is not supported by native printer adapter yet.", platform),
        },
    }
}

/// Enumerate native printers detected from the operating system.
pub fn list_native_printers() -> Result<Vec<NormalizedPrinter>, String> {
    discover_installed_printers().map_err(|e| format!("{}: {}", e.canonical_code(), e))
}
