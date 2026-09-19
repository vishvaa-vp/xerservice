//! Real Native macOS CUPS Print Job Control & Safe Cancellation Module
//!
//! Provides controlled cancellation of native print jobs via `/usr/bin/cancel`.
//! Strictly enforces job existence and status verification before and after cancellation.
//! Adheres to the invariant that executing the cancel command does not automatically
//! equal verified cancellation; native CUPS state remains authoritative.

use super::discovery::discover_installed_printers;
use super::errors::CanonicalPrintErrorCode;
use super::status::{query_native_print_job_status, validate_identifier};
use serde::{Deserialize, Serialize};

/// Structured response returned by native print job cancellation operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePrintCancelResponse {
    pub job_id: String,
    pub success: bool,
    pub status: String,
    pub error_code: Option<String>,
    pub message: String,
}

/// Evaluates whether a print job with the given status can enter the cancellation flow.
pub fn is_cancellable_state(status: &str) -> (bool, Option<&'static str>, String) {
    match status {
        "QUEUED" => (true, None, "Job is queued and cancellable.".to_string()),
        "PRINTING" => (
            true,
            None,
            "Job is currently printing; cancellation will be attempted with host CUPS spooler.".to_string(),
        ),
        "COMPLETED" => (
            false,
            Some(CanonicalPrintErrorCode::PrintCancelFailed.as_str()),
            "Job has already completed in host CUPS spooler and can no longer be cancelled.".to_string(),
        ),
        "CANCELLED" => (
            false,
            None,
            "Job is already cancelled in host CUPS spooler.".to_string(),
        ),
        "FAILED" => (
            false,
            Some(CanonicalPrintErrorCode::PrintCancelFailed.as_str()),
            "Job has already failed or aborted in host CUPS spooler.".to_string(),
        ),
        _ => (
            false,
            Some(CanonicalPrintErrorCode::UnknownPrintError.as_str()),
            "Job status is unknown; cannot safely initiate cancellation.".to_string(),
        ),
    }
}

/// Executes safe native print job cancellation against macOS CUPS.
pub fn cancel_native_print_job(
    job_id: &str,
    printer_id: Option<&str>,
) -> Result<NativePrintCancelResponse, String> {
    println!(
        "[RUST_IPC_HANDLER] STAGE_D_CANCEL_HANDLER_RECEIVED: job_id={}, printer_id={:?}",
        job_id, printer_id
    );
    println!(
        "[RUST_IPC_HANDLER] STAGE_E_CANCEL_STARTED: Initiating safe native cancellation for job_id={}",
        job_id
    );

    // 1. Validate identifiers against shell metacharacters and traversal
    if let Err(e) = validate_identifier(job_id) {
        println!("[RUST_IPC_HANDLER] STAGE_E_CANCEL_RESULT: Invalid job_id: {}", e);
        return Ok(NativePrintCancelResponse {
            job_id: job_id.to_string(),
            success: false,
            status: "FAILED".to_string(),
            error_code: Some(CanonicalPrintErrorCode::UnknownPrintError.as_str().to_string()),
            message: format!("Invalid job_id: {}", e),
        });
    }

    if let Some(pid) = printer_id {
        if let Err(e) = validate_identifier(pid) {
            println!("[RUST_IPC_HANDLER] STAGE_E_CANCEL_RESULT: Invalid printer_id: {}", e);
            return Ok(NativePrintCancelResponse {
                job_id: job_id.to_string(),
                success: false,
                status: "FAILED".to_string(),
                error_code: Some(CanonicalPrintErrorCode::PrinterNotFound.as_str().to_string()),
                message: format!("Invalid printer_id: {}", e),
            });
        }
    }

    // 2. Validate printer existence if printer_id was supplied
    if let Some(pid) = printer_id {
        let installed = discover_installed_printers()
            .map_err(|e| format!("Failed to query host OS printers: {}", e))?;
        let exists = installed.iter().any(|p| p.printer_id == pid || p.name == pid);
        if !exists {
            println!(
                "[RUST_IPC_HANDLER] STAGE_E_CANCEL_RESULT: Printer '{}' not found among installed printers",
                pid
            );
            return Ok(NativePrintCancelResponse {
                job_id: job_id.to_string(),
                success: false,
                status: "FAILED".to_string(),
                error_code: Some(CanonicalPrintErrorCode::PrinterNotFound.as_str().to_string()),
                message: format!(
                    "Printer '{}' not found among host OS installed printers (Total discovered: {}).",
                    pid,
                    installed.len()
                ),
            });
        }
    }

    // 3. Verify job state in native CUPS spooler BEFORE attempting cancellation
    let pre_status = query_native_print_job_status(job_id, printer_id)?;
    let (cancellable, err_code, reason) = is_cancellable_state(&pre_status.status);

    if !cancellable {
        println!(
            "[RUST_IPC_HANDLER] STAGE_E_CANCEL_RESULT: Job '{}' is not cancellable (status={}, reason={})",
            job_id, pre_status.status, reason
        );
        return Ok(NativePrintCancelResponse {
            job_id: job_id.to_string(),
            success: false,
            status: pre_status.status,
            error_code: err_code.map(|s| s.to_string()),
            message: reason,
        });
    }

    // 4. Execute /usr/bin/cancel with explicit arguments (no shell interpolation)
    let cancel_target = pre_status
        .native_job_id
        .as_deref()
        .unwrap_or(job_id);

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        use std::process::Command;

        let cancel_bin = if std::path::Path::new("/usr/bin/cancel").exists() {
            "/usr/bin/cancel"
        } else {
            "cancel"
        };

        println!(
            "[RUST_IPC_HANDLER] STAGE_E_CUPS_CANCEL: Executing Command::new(\"{}\").arg(\"{}\")",
            cancel_bin, cancel_target
        );

        let output = Command::new(cancel_bin)
            .arg(cancel_target)
            .output()
            .map_err(|e| format!("Failed to execute {}: {}", cancel_bin, e))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        println!(
            "[RUST_IPC_HANDLER] STAGE_E_CUPS_CANCEL: cancel command exit_code={:?}, stdout='{}', stderr='{}'",
            output.status.code(),
            stdout.trim(),
            stderr.trim()
        );
    }

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;

        let target_printer = printer_id.or(pre_status.printer_id.as_deref());
        let ps_cmd = match target_printer {
            Some(p) => {
                let escaped = p.replace('\'', "''");
                format!("Remove-PrintJob -PrinterName '{}' -ID {}", escaped, cancel_target)
            }
            None => format!("Get-PrintJob | Where-Object {{ $_.Id -eq {} -or $_.DocumentName -like '*{}*' }} | Remove-PrintJob", cancel_target, job_id),
        };

        println!(
            "[RUST_IPC_HANDLER] STAGE_E_WIN_CANCEL: Executing powershell -Command \"{}\"",
            ps_cmd
        );

        let _ = Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &ps_cmd])
            .output();
    }

    // 5. Follow-up status query to verify genuine cancellation
    // RULE: Running /usr/bin/cancel successfully does NOT automatically prove the job was cancelled.
    println!(
        "[RUST_IPC_HANDLER] STAGE_E_CANCEL_VERIFICATION: Querying native CUPS status post-cancellation"
    );
    let post_status = query_native_print_job_status(job_id, printer_id)?;

    println!(
        "[RUST_IPC_HANDLER] STAGE_E_CANCEL_RESULT: Post-cancellation verified status='{}'",
        post_status.status
    );

    // Update persistent record with cancellation state (Step 16)
    if let Some(mut rec) = super::persistence::find_by_any_id(job_id, None) {
        rec.cancellation_requested = true;
        if post_status.status == "CANCELLED" {
            rec.status = "CANCELLED".to_string();
            rec.recovery_state = "RECONCILED".to_string();
        }
        rec.updated_at = "2026-09-14T05:00:00.000Z".to_string();
        let _ = super::persistence::upsert_record(rec, None);
    }

    if post_status.status == "CANCELLED" {
        Ok(NativePrintCancelResponse {
            job_id: job_id.to_string(),
            success: true,
            status: "CANCELLED".to_string(),
            error_code: None,
            message: "Job successfully cancelled in host CUPS spooler.".to_string(),
        })
    } else if post_status.status == "COMPLETED" {
        Ok(NativePrintCancelResponse {
            job_id: job_id.to_string(),
            success: false,
            status: "COMPLETED".to_string(),
            error_code: Some(CanonicalPrintErrorCode::PrintCancelFailed.as_str().to_string()),
            message: "Job completed before cancellation could take effect in CUPS.".to_string(),
        })
    } else if post_status.status == "QUEUED" || post_status.status == "PRINTING" {
        Ok(NativePrintCancelResponse {
            job_id: job_id.to_string(),
            success: false,
            status: post_status.status,
            error_code: Some(CanonicalPrintErrorCode::PrintCancelFailed.as_str().to_string()),
            message: "Cancellation was requested, but job remains active in host CUPS spooler.".to_string(),
        })
    } else {
        // Missing from spooler or failed
        Ok(NativePrintCancelResponse {
            job_id: job_id.to_string(),
            success: false,
            status: post_status.status,
            error_code: post_status.error_code,
            message: post_status.message,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_identifier_clean() {
        assert!(validate_identifier("job-123_456").is_ok());
        assert!(validate_identifier("OfficeJet-42").is_ok());
    }

    #[test]
    fn test_validate_identifier_rejects_malformed() {
        assert!(validate_identifier("job; rm -rf /").is_err());
        assert!(validate_identifier("job$(echo hi)").is_err());
        assert!(validate_identifier("job`date`").is_err());
        assert!(validate_identifier("job|whoami").is_err());
        assert!(validate_identifier("").is_err());
    }

    #[test]
    fn test_cancellation_rules_verification() {
        // QUEUED is cancellable
        let (c, err, _) = is_cancellable_state("QUEUED");
        assert!(c);
        assert!(err.is_none());

        // PRINTING is cancellable
        let (c, err, _) = is_cancellable_state("PRINTING");
        assert!(c);
        assert!(err.is_none());

        // COMPLETED is NOT cancellable
        let (c, err, msg) = is_cancellable_state("COMPLETED");
        assert!(!c);
        assert_eq!(err, Some("PRINT_CANCEL_FAILED"));
        assert!(msg.contains("already completed"));

        // CANCELLED is already cancelled
        let (c, err, msg) = is_cancellable_state("CANCELLED");
        assert!(!c);
        assert!(err.is_none());
        assert!(msg.contains("already cancelled"));

        // FAILED is NOT cancellable
        let (c, err, _) = is_cancellable_state("FAILED");
        assert!(!c);
        assert_eq!(err, Some("PRINT_CANCEL_FAILED"));

        // Unknown fails closed
        let (c, err, _) = is_cancellable_state("UNKNOWN");
        assert!(!c);
        assert_eq!(err, Some("UNKNOWN_PRINT_ERROR"));
    }

    #[test]
    fn test_non_existent_job_cancellation_fails_closed() {
        let res = cancel_native_print_job("non-existent-test-job-99999", None);
        assert!(res.is_ok());
        let cancel_res = res.unwrap();
        assert!(!cancel_res.success, "Must not claim success for non-existent job");
        assert_eq!(cancel_res.status, "FAILED");
    }
}
