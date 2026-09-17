//! Real Native macOS CUPS Print Job Status & Queue Tracking Module
//!
//! Queries host OS CUPS spooler for active queue status and historical job completion records.
//! Strictly validates printer destinations and job identifiers with zero shell interpolation.
//! Preserves the invariant that absence of information or missing jobs never equals completion,
//! and clearly discloses that CUPS spooler completion is not physical paper verification.

use super::discovery::discover_installed_printers;
use super::errors::CanonicalPrintErrorCode;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

/// In-memory tracking record for jobs submitted via native runtime.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubmittedJobRecord {
    pub job_id: String,
    pub native_job_id: Option<String>,
    pub printer_id: String,
    pub submitted_at: String,
}

static SUBMITTED_JOBS: LazyLock<Mutex<HashMap<String, SubmittedJobRecord>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Registers a submitted job in the local runtime table.
pub fn register_submitted_job(
    job_id: &str,
    native_job_id: Option<&str>,
    printer_id: &str,
    submitted_at: &str,
) {
    if let Ok(mut lock) = SUBMITTED_JOBS.lock() {
        lock.insert(
            job_id.to_string(),
            SubmittedJobRecord {
                job_id: job_id.to_string(),
                native_job_id: native_job_id.map(|s| s.to_string()),
                printer_id: printer_id.to_string(),
                submitted_at: submitted_at.to_string(),
            },
        );
    }
    // Also persist in the unified persistent store
    let record = super::persistence::PrintJobRecord {
        local_job_id: job_id.to_string(),
        xer_service_order_id: None,
        native_job_id: native_job_id.map(|s| s.to_string()),
        printer_id: printer_id.to_string(),
        status: if native_job_id.is_some() { "PRINTING".to_string() } else { "QUEUED".to_string() },
        title: Some(format!("XerService Job {}", job_id)),
        submitted_at: submitted_at.to_string(),
        updated_at: submitted_at.to_string(),
        managed_by_xer_service: true,
        submission_state: if native_job_id.is_some() { "SUBMITTED".to_string() } else { "PENDING_SUBMISSION".to_string() },
        recovery_state: "NOT_APPLICABLE".to_string(),
        last_known_native_status: None,
        retry_count: 0,
        cancellation_requested: false,
        completed_at: None,
        failed_at: None,
        error_code: None,
        error_message: None,
    };
    let _ = super::persistence::upsert_record(record, None);
}

/// Retrieves registered job record if available.
pub fn get_registered_job(job_id: &str) -> Option<SubmittedJobRecord> {
    if let Ok(lock) = SUBMITTED_JOBS.lock() {
        if let Some(r) = lock.get(job_id) {
            return Some(r.clone());
        }
    }
    // Fallback to persisted store
    if let Some(p) = super::persistence::get_record(job_id, None) {
        return Some(SubmittedJobRecord {
            job_id: p.local_job_id,
            native_job_id: p.native_job_id,
            printer_id: p.printer_id,
            submitted_at: p.submitted_at,
        });
    }
    None
}

/// Retrieves registered job record matching either internal job_id or native_job_id.
pub fn get_registered_job_by_any_id(id: &str) -> Option<SubmittedJobRecord> {
    if let Ok(lock) = SUBMITTED_JOBS.lock() {
        let lower = id.to_lowercase();
        for (job_id, record) in lock.iter() {
            if job_id.to_lowercase() == lower {
                return Some(record.clone());
            }
            if let Some(native_id) = &record.native_job_id {
                if native_id.to_lowercase() == lower {
                    return Some(record.clone());
                }
            }
        }
    }
    if let Some(p) = super::persistence::find_by_any_id(id, None) {
        return Some(SubmittedJobRecord {
            job_id: p.local_job_id,
            native_job_id: p.native_job_id,
            printer_id: p.printer_id,
            submitted_at: p.submitted_at,
        });
    }
    None
}

/// Checks whether a job in the queue is managed by XerService.
/// Matches against known submitted jobs registry or XerService title signature.
pub fn is_xer_service_managed(job_id_or_native_id: &str, title: Option<&str>) -> bool {
    if let Some(t) = title {
        if t.to_lowercase().contains("xerservice") {
            return true;
        }
    }
    let lower_target = job_id_or_native_id.to_lowercase();
    if lower_target.contains("xerservice") {
        return true;
    }
    if get_registered_job_by_any_id(job_id_or_native_id).is_some() {
        return true;
    }
    false
}

/// Normalized native print job status information aligned with @packages/printing PrintJobStatusInfo.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePrintJobStatusInfo {
    pub job_id: String,
    pub status: String,
    pub printer_id: Option<String>,
    pub updated_at: String,
    pub native_job_id: Option<String>,
    pub error_code: Option<String>,
    pub message: String,
    pub retryable: bool,
}

/// Validates identifiers against path traversal, shell injection, or illegal characters.
pub fn validate_identifier(id: &str) -> Result<(), String> {
    if id.is_empty() {
        return Err("Identifier cannot be empty".to_string());
    }
    if id.len() > 128 {
        return Err("Identifier exceeds maximum length (128 characters)".to_string());
    }
    for c in id.chars() {
        if !c.is_alphanumeric() && c != '-' && c != '_' && c != '.' {
            return Err(format!("Illegal character '{}' in identifier '{}'", c, id));
        }
    }
    Ok(())
}

/// Parsed state from CUPS output.
#[derive(Debug, PartialEq, Eq)]
pub enum CupsJobState {
    Queued(String),
    Printing(String),
    Completed(String),
    Cancelled(String),
    Failed(String),
    NotFound,
}

/// Pure parser for CUPS lpstat / lpq job lines.
pub fn parse_cups_status_output(
    output: &str,
    target_job_id: &str,
    target_native_id: Option<&str>,
) -> CupsJobState {
    let lower_target_job = target_job_id.to_lowercase();
    let lower_native = target_native_id.map(|s| s.to_lowercase());

    // CUPS lpstat -l output groups job entries separated by headers:
    // Header format: "<destination>-<job_num> <user> <size> <date>"
    // Sub-lines: "Status: <status_message>"
    let mut current_matches = false;
    let mut current_status_line = String::new();
    let mut found_job = false;

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // New job entry line starts at column 0 (not indented)
        if !line.starts_with(' ') && !line.starts_with('\t') {
            if current_matches && found_job {
                // Return result of previously matched job
                return normalize_cups_state(&current_status_line);
            }

            // Check if this new job line matches our target
            let first_token = trimmed.split_whitespace().next().unwrap_or("").to_lowercase();
            let matches_native = lower_native.as_ref().map(|n| first_token == *n).unwrap_or(false);
            let matches_job = first_token == lower_target_job || trimmed.to_lowercase().contains(&lower_target_job);

            if matches_native || matches_job {
                current_matches = true;
                found_job = true;
                current_status_line = trimmed.to_string();
            } else {
                current_matches = false;
                current_status_line.clear();
            }
        } else if current_matches {
            // Indented attribute line for currently matched job
            if trimmed.to_lowercase().starts_with("status:") {
                current_status_line = trimmed.to_string();
            } else if current_status_line.is_empty() {
                current_status_line = trimmed.to_string();
            }
        }
    }

    if current_matches && found_job {
        return normalize_cups_state(&current_status_line);
    }

    // Direct fallback: if raw output contains target_job_id or native_id anywhere
    if let Some(native_id) = &lower_native {
        if output.to_lowercase().contains(native_id) {
            return normalize_cups_state(output);
        }
    }
    if output.to_lowercase().contains(&lower_target_job) {
        return normalize_cups_state(output);
    }

    CupsJobState::NotFound
}

fn normalize_cups_state(status_text: &str) -> CupsJobState {
    let lower = status_text.to_lowercase();

    if lower.contains("processing") || lower.contains("printing") || lower.contains("sending data") {
        CupsJobState::Printing(format!("CUPS job is currently processing/printing: {}", status_text))
    } else if lower.contains("job-canceled") || lower.contains("canceled") || lower.contains("cancelled") {
        CupsJobState::Cancelled(format!("CUPS reports job was cancelled: {}", status_text))
    } else if lower.contains("job-aborted") || lower.contains("aborted") || lower.contains("job-stopped") || lower.contains("failed") {
        CupsJobState::Failed(format!("CUPS reports job failed or was aborted: {}", status_text))
    } else if lower.contains("job-completed") || lower.contains("completed") {
        CupsJobState::Completed("CUPS reports job completed (spooler output finished; no physical paper verification available).".to_string())
    } else if lower.contains("pending") || lower.contains("held") || lower.contains("queued") || !status_text.is_empty() {
        CupsJobState::Queued(format!("CUPS job is queued in spooler: {}", status_text))
    } else {
        CupsJobState::NotFound
    }
}

/// Queries host OS CUPS subsystem for real-time status of a print job.
pub fn query_native_print_job_status(
    job_id: &str,
    printer_id: Option<&str>,
) -> Result<NativePrintJobStatusInfo, String> {
    let now = "2026-09-14T03:30:00.000Z".to_string();

    println!(
        "[RUST_IPC_HANDLER] STAGE_D_STATUS_HANDLER_RECEIVED: job_id={}, printer_id={:?}",
        job_id, printer_id
    );

    // 1. Input validation
    if let Err(e) = validate_identifier(job_id) {
        return Ok(NativePrintJobStatusInfo {
            job_id: job_id.to_string(),
            status: "FAILED".to_string(),
            printer_id: printer_id.map(|s| s.to_string()),
            updated_at: now,
            native_job_id: None,
            error_code: Some(CanonicalPrintErrorCode::UnknownPrintError.as_str().to_string()),
            message: format!("Invalid job_id: {}", e),
            retryable: false,
        });
    }

    if let Some(pid) = printer_id {
        if let Err(e) = validate_identifier(pid) {
            return Ok(NativePrintJobStatusInfo {
                job_id: job_id.to_string(),
                status: "FAILED".to_string(),
                printer_id: Some(pid.to_string()),
                updated_at: now,
                native_job_id: None,
                error_code: Some(CanonicalPrintErrorCode::PrinterNotFound.as_str().to_string()),
                message: format!("Invalid printer_id: {}", e),
                retryable: false,
            });
        }
    }

    // 2. Resolve known registration details if previously submitted
    let registered = get_registered_job(job_id);
    let resolved_native_id = registered.as_ref().and_then(|r| r.native_job_id.clone());
    let effective_printer_id = printer_id
        .map(|s| s.to_string())
        .or_else(|| registered.as_ref().map(|r| r.printer_id.clone()));

    // 3. Validate target printer if specified
    if let Some(target_printer) = &effective_printer_id {
        let installed = discover_installed_printers()
            .map_err(|e| format!("Failed to query host OS printers: {}", e))?;
        let exists = installed
            .iter()
            .any(|p| p.printer_id == *target_printer || p.name == *target_printer);

        if !exists {
            println!(
                "[RUST_IPC_HANDLER] STAGE_E_CUPS_STATUS_RESULT: Printer '{}' does not exist on host",
                target_printer
            );
            println!(
                "[RUST_IPC_HANDLER] STAGE_E_STATUS_NORMALIZED: status=FAILED, error_code=PRINTER_NOT_FOUND"
            );
            return Ok(NativePrintJobStatusInfo {
                job_id: job_id.to_string(),
                status: "FAILED".to_string(),
                printer_id: Some(target_printer.clone()),
                updated_at: now,
                native_job_id: resolved_native_id,
                error_code: Some(CanonicalPrintErrorCode::PrinterNotFound.as_str().to_string()),
                message: format!(
                    "Printer '{}' not found among host OS installed printers (Total discovered: {}).",
                    target_printer,
                    installed.len()
                ),
                retryable: false,
            });
        }
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;

        // 4. Query active / queued / printing jobs via /usr/bin/lpstat -l -W not-completed
        println!(
            "[RUST_IPC_HANDLER] STAGE_E_CUPS_STATUS_QUERY: Command: /usr/bin/lpstat -l -W not-completed"
        );
        let mut active_cmd = Command::new("/usr/bin/lpstat");
        active_cmd.arg("-l").arg("-W").arg("not-completed");
        if let Some(p) = &effective_printer_id {
            active_cmd.arg("-o").arg(p);
        }

        let active_out = active_cmd.output();
        if let Ok(out) = active_out {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let state = parse_cups_status_output(&stdout, job_id, resolved_native_id.as_deref());
            println!(
                "[RUST_IPC_HANDLER] STAGE_E_CUPS_STATUS_RESULT: Active queue check: {:?}",
                state
            );

            match state {
                CupsJobState::Printing(msg) => {
                    println!("[RUST_IPC_HANDLER] STAGE_E_STATUS_NORMALIZED: status=PRINTING");
                    return Ok(NativePrintJobStatusInfo {
                        job_id: job_id.to_string(),
                        status: "PRINTING".to_string(),
                        printer_id: effective_printer_id,
                        updated_at: now,
                        native_job_id: resolved_native_id,
                        error_code: None,
                        message: msg,
                        retryable: false,
                    });
                }
                CupsJobState::Queued(msg) => {
                    println!("[RUST_IPC_HANDLER] STAGE_E_STATUS_NORMALIZED: status=QUEUED");
                    return Ok(NativePrintJobStatusInfo {
                        job_id: job_id.to_string(),
                        status: "QUEUED".to_string(),
                        printer_id: effective_printer_id,
                        updated_at: now,
                        native_job_id: resolved_native_id,
                        error_code: None,
                        message: msg,
                        retryable: false,
                    });
                }
                _ => {}
            }
        }

        // 5. Query completed / finished jobs via /usr/bin/lpstat -l -W completed
        println!(
            "[RUST_IPC_HANDLER] STAGE_E_CUPS_STATUS_QUERY: Command: /usr/bin/lpstat -l -W completed"
        );
        let mut completed_cmd = Command::new("/usr/bin/lpstat");
        completed_cmd.arg("-l").arg("-W").arg("completed");
        if let Some(p) = &effective_printer_id {
            completed_cmd.arg("-o").arg(p);
        }

        let completed_out = completed_cmd.output();
        if let Ok(out) = completed_out {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let state = parse_cups_status_output(&stdout, job_id, resolved_native_id.as_deref());
            println!(
                "[RUST_IPC_HANDLER] STAGE_E_CUPS_STATUS_RESULT: Completed history check: {:?}",
                state
            );

            match state {
                CupsJobState::Completed(msg) => {
                    println!("[RUST_IPC_HANDLER] STAGE_E_STATUS_NORMALIZED: status=COMPLETED");
                    return Ok(NativePrintJobStatusInfo {
                        job_id: job_id.to_string(),
                        status: "COMPLETED".to_string(),
                        printer_id: effective_printer_id,
                        updated_at: now,
                        native_job_id: resolved_native_id,
                        error_code: None,
                        message: msg,
                        retryable: false,
                    });
                }
                CupsJobState::Cancelled(msg) => {
                    println!("[RUST_IPC_HANDLER] STAGE_E_STATUS_NORMALIZED: status=CANCELLED");
                    return Ok(NativePrintJobStatusInfo {
                        job_id: job_id.to_string(),
                        status: "CANCELLED".to_string(),
                        printer_id: effective_printer_id,
                        updated_at: now,
                        native_job_id: resolved_native_id,
                        error_code: None,
                        message: msg,
                        retryable: false,
                    });
                }
                CupsJobState::Failed(msg) => {
                    println!("[RUST_IPC_HANDLER] STAGE_E_STATUS_NORMALIZED: status=FAILED");
                    return Ok(NativePrintJobStatusInfo {
                        job_id: job_id.to_string(),
                        status: "FAILED".to_string(),
                        printer_id: effective_printer_id,
                        updated_at: now,
                        native_job_id: resolved_native_id,
                        error_code: Some(CanonicalPrintErrorCode::PrintSubmissionFailed.as_str().to_string()),
                        message: msg,
                        retryable: false,
                    });
                }
                _ => {
                    // Fallback for macOS CUPS where `lpstat -l -W completed` has an empty Status: line
                    // but the job ID is confirmed present in the completed spooler history.
                    let lower_out = stdout.to_lowercase();
                    let target_matched = resolved_native_id
                        .as_ref()
                        .map(|nid| lower_out.contains(&nid.to_lowercase()))
                        .unwrap_or(false)
                        || lower_out.contains(&job_id.to_lowercase());

                    if target_matched {
                        println!("[RUST_IPC_HANDLER] STAGE_E_STATUS_NORMALIZED: status=COMPLETED (from macOS completed history)");
                        return Ok(NativePrintJobStatusInfo {
                            job_id: job_id.to_string(),
                            status: "COMPLETED".to_string(),
                            printer_id: effective_printer_id,
                            updated_at: now,
                            native_job_id: resolved_native_id,
                            error_code: None,
                            message: "CUPS reports job completed (spooler output finished; no physical paper verification available).".to_string(),
                            retryable: false,
                        });
                    }
                }
            }
        }
    }

    // 6. STRICT INVARIANT: Job not found in CUPS active queue or completion history.
    // MUST NOT FABRICATE "COMPLETED".
    println!(
        "[RUST_IPC_HANDLER] STAGE_E_CUPS_STATUS_RESULT: Job '{}' not found in active or completed CUPS queue",
        job_id
    );
    println!(
        "[RUST_IPC_HANDLER] STAGE_E_STATUS_NORMALIZED: status=FAILED, error_code=UNKNOWN_PRINT_ERROR (Job not in spooler)"
    );

    Ok(NativePrintJobStatusInfo {
        job_id: job_id.to_string(),
        status: "FAILED".to_string(),
        printer_id: effective_printer_id,
        updated_at: now,
        native_job_id: resolved_native_id,
        error_code: Some(CanonicalPrintErrorCode::UnknownPrintError.as_str().to_string()),
        message: format!(
            "Job '{}' was not found in host CUPS active queue or completion history.",
            job_id
        ),
        retryable: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_identifier_clean() {
        assert!(validate_identifier("job-123_test.pdf").is_ok());
        assert!(validate_identifier("Canon-TS6400").is_ok());
        assert!(validate_identifier("printer-1").is_ok());
    }

    #[test]
    fn test_validate_identifier_rejects_shell_injection() {
        assert!(validate_identifier("job; rm -rf /").is_err());
        assert!(validate_identifier("job$(whoami)").is_err());
        assert!(validate_identifier("job`id`").is_err());
        assert!(validate_identifier("job|cat").is_err());
        assert!(validate_identifier("").is_err());
    }

    #[test]
    fn test_cups_active_processing_maps_to_printing() {
        let sample = "\
OfficeJet-42 root 10240 Mon Sep 14 03:00:00 2026\n\
\tStatus: processing since Mon Sep 14 03:00:01 2026\n";
        let state = parse_cups_status_output(sample, "job-xyz", Some("OfficeJet-42"));
        match state {
            CupsJobState::Printing(msg) => assert!(msg.contains("processing")),
            other => panic!("Expected Printing, got {:?}", other),
        }
    }

    #[test]
    fn test_cups_active_pending_maps_to_queued() {
        let sample = "\
OfficeJet-42 root 10240 Mon Sep 14 03:00:00 2026\n\
\tStatus: pending since Mon Sep 14 03:00:01 2026\n";
        let state = parse_cups_status_output(sample, "job-xyz", Some("OfficeJet-42"));
        match state {
            CupsJobState::Queued(msg) => assert!(msg.contains("pending")),
            other => panic!("Expected Queued, got {:?}", other),
        }
    }

    #[test]
    fn test_cups_completed_maps_to_completed_with_physical_advisory() {
        let sample = "\
OfficeJet-42 root 10240 Mon Sep 14 03:00:00 2026\n\
\tStatus: job-completed at Mon Sep 14 03:01:00 2026\n";
        let state = parse_cups_status_output(sample, "job-xyz", Some("OfficeJet-42"));
        match state {
            CupsJobState::Completed(msg) => {
                assert!(msg.contains("CUPS reports job completed"));
                assert!(msg.contains("no physical paper verification available"));
            }
            other => panic!("Expected Completed, got {:?}", other),
        }
    }

    #[test]
    fn test_cups_cancelled_maps_to_cancelled() {
        let sample = "\
OfficeJet-42 root 10240 Mon Sep 14 03:00:00 2026\n\
\tStatus: job-canceled by user\n";
        let state = parse_cups_status_output(sample, "job-xyz", Some("OfficeJet-42"));
        match state {
            CupsJobState::Cancelled(msg) => assert!(msg.contains("cancelled") || msg.contains("canceled")),
            other => panic!("Expected Cancelled, got {:?}", other),
        }
    }

    #[test]
    fn test_cups_aborted_maps_to_failed() {
        let sample = "\
OfficeJet-42 root 10240 Mon Sep 14 03:00:00 2026\n\
\tStatus: job-aborted by filter error\n";
        let state = parse_cups_status_output(sample, "job-xyz", Some("OfficeJet-42"));
        match state {
            CupsJobState::Failed(msg) => assert!(msg.contains("aborted") || msg.contains("failed")),
            other => panic!("Expected Failed, got {:?}", other),
        }
    }

    #[test]
    fn test_missing_job_returns_not_found_never_completed() {
        let sample = "\
OfficeJet-99 root 512 Mon Sep 14 03:00:00 2026\n\
\tStatus: job-completed\n";
        let state = parse_cups_status_output(sample, "other-job-123", Some("OfficeJet-42"));
        assert_eq!(state, CupsJobState::NotFound);
    }
}
