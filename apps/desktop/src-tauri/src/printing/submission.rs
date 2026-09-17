//! Real Native Print Job Submission Module
//!
//! Submits controlled test documents to host OS CUPS spooler using safe process execution.
//! Strictly enforces printer validation, capability checking, and canonical error mapping.
//! Never constructs shell commands via string concatenation or shell interpreters.

use super::capabilities::NormalizedPrinter;
use super::discovery::discover_installed_printers;
use super::errors::CanonicalPrintErrorCode;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintJobSubmissionRequest {
    pub job_id: String,
    pub order_id: Option<String>,
    pub printer_id: Option<String>,
    pub document_path: Option<String>,
    pub document_fingerprint: Option<String>,
    pub copies: Option<u32>,
    pub color_mode: Option<String>,
    pub paper_size: Option<String>,
    pub duplex_mode: Option<String>,
    pub is_test_job: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePrintJobResponse {
    pub job_id: String,
    pub status: String,
    pub printer_id: String,
    pub submitted_at: String,
    pub native_job_id: Option<String>,
    pub error_code: Option<String>,
    pub message: String,
    pub retryable: bool,
}

/// Generates a deterministic, isolated test document for native printing verification.
/// Strictly does NOT use customer documents, sensitive data, or backend payloads.
pub fn generate_deterministic_test_document(job_id: &str, printer_id: &str) -> Result<PathBuf, String> {
    let temp_dir = std::env::temp_dir();
    let file_name = format!("xerservice_test_print_{}.txt", sanitize_identifier(job_id));
    let file_path = temp_dir.join(file_name);

    let content = format!(
        "============================================================\n\
         XerService Native Print Test\n\
         Step 12\n\
         Test job only\n\
         Job ID: {}\n\
         Target Printer: {}\n\
         Generated: {}\n\
         ============================================================\n",
        job_id,
        printer_id,
        "Step 12 Deterministic Verification"
    );

    let mut file = fs::File::create(&file_path)
        .map_err(|e| format!("Failed to create temporary test print document: {}", e))?;

    file.write_all(content.as_bytes())
        .map_err(|e| format!("Failed to write test print document: {}", e))?;

    Ok(file_path)
}

/// Sanitizes identifiers to prevent path traversal or shell character hazards.
fn sanitize_identifier(input: &str) -> String {
    input
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .collect()
}

/// Submits a native print job through the host OS CUPS subsystem.
pub fn submit_native_print_job(req: PrintJobSubmissionRequest) -> Result<NativePrintJobResponse, String> {
    let now = "2026-09-14T03:30:00.000Z".to_string();
    let job_id = req.job_id.clone();

    println!("[RUST_IPC_HANDLER] STAGE_E_SUBMISSION_STARTED: job_id={}, printer_id={:?}", job_id, req.printer_id);

    // Duplicate submission protection (Step 16 & 17)
    if let Err(e) = super::persistence::check_duplicate_submission(&job_id, req.order_id.as_deref(), None) {
        println!("[RUST_IPC_HANDLER] STAGE_E_SUBMISSION_FAILED: Duplicate check blocked: {}", e);
        return Ok(NativePrintJobResponse {
            job_id,
            status: "FAILED".to_string(),
            printer_id: req.printer_id.unwrap_or_else(|| "unknown".to_string()),
            submitted_at: now,
            native_job_id: None,
            error_code: Some("DUPLICATE_PRINT_BLOCKED".to_string()),
            message: e,
            retryable: false,
        });
    }

    // 1. Validate requested printer name is provided
    let requested_printer_id = match req.printer_id.as_deref() {
        Some(id) if !id.trim().is_empty() && id != "none" => id.trim().to_string(),
        _ => {
            println!("[RUST_IPC_HANDLER] STAGE_E_SUBMISSION_FAILED: No target printer specified or printer not found");
            return Ok(NativePrintJobResponse {
                job_id,
                status: "FAILED".to_string(),
                printer_id: "none".to_string(),
                submitted_at: now,
                native_job_id: None,
                error_code: Some(CanonicalPrintErrorCode::PrinterNotFound.as_str().to_string()),
                message: "Printer not found: No target printer specified or destination does not exist.".to_string(),
                retryable: false,
            });
        }
    };

    // 2. Query host OS installed printers
    let installed_printers = discover_installed_printers()
        .map_err(|e| format!("Failed to query host OS printers: {}", e))?;

    // 3. Security Check: Validate requested printer exists in OS installed printer list
    let target_printer: Option<&NormalizedPrinter> = installed_printers
        .iter()
        .find(|p| p.printer_id == requested_printer_id || p.name == requested_printer_id);

    let target_printer = match target_printer {
        Some(p) => p,
        None => {
            println!(
                "[RUST_IPC_HANDLER] STAGE_E_SUBMISSION_FAILED: Printer '{}' not found in OS installed printer list",
                requested_printer_id
            );
            return Ok(NativePrintJobResponse {
                job_id,
                status: "FAILED".to_string(),
                printer_id: requested_printer_id.clone(),
                submitted_at: now,
                native_job_id: None,
                error_code: Some(CanonicalPrintErrorCode::PrinterNotFound.as_str().to_string()),
                message: format!(
                    "Printer '{}' not found among host OS installed printers (Total discovered: {}).",
                    requested_printer_id,
                    installed_printers.len()
                ),
                retryable: false,
            });
        }
    };

    // 4. Validate printer operational status
    if target_printer.status == "offline" {
        println!("[RUST_IPC_HANDLER] STAGE_E_SUBMISSION_FAILED: Target printer '{}' is offline", target_printer.name);
        return Ok(NativePrintJobResponse {
            job_id,
            status: "FAILED".to_string(),
            printer_id: target_printer.printer_id.clone(),
            submitted_at: now,
            native_job_id: None,
            error_code: Some(CanonicalPrintErrorCode::PrinterOffline.as_str().to_string()),
            message: format!("Target printer '{}' is currently offline.", target_printer.name),
            retryable: true,
        });
    }
    if target_printer.status == "busy" {
        println!("[RUST_IPC_HANDLER] STAGE_E_SUBMISSION_FAILED: Target printer '{}' is busy", target_printer.name);
        return Ok(NativePrintJobResponse {
            job_id,
            status: "FAILED".to_string(),
            printer_id: target_printer.printer_id.clone(),
            submitted_at: now,
            native_job_id: None,
            error_code: Some(CanonicalPrintErrorCode::PrinterBusy.as_str().to_string()),
            message: format!("Target printer '{}' is currently busy processing another job.", target_printer.name),
            retryable: true,
        });
    }

    // 5. Capability validation against discovered printer capabilities
    let copies = req.copies.unwrap_or(1);
    if let Some(max_c) = target_printer.capabilities.max_copies {
        if copies > max_c {
            println!(
                "[RUST_IPC_HANDLER] STAGE_E_SUBMISSION_FAILED: Requested copies ({}) exceeds maximum ({})",
                copies, max_c
            );
            return Ok(NativePrintJobResponse {
                job_id,
                status: "FAILED".to_string(),
                printer_id: target_printer.printer_id.clone(),
                submitted_at: now,
                native_job_id: None,
                error_code: Some(CanonicalPrintErrorCode::PrintSubmissionFailed.as_str().to_string()),
                message: format!(
                    "Requested copies ({}) exceeds printer maximum ({}).",
                    copies, max_c
                ),
                retryable: false,
            });
        }
    }

    if let Some(paper_size) = &req.paper_size {
        if !target_printer.capabilities.supported_paper_sizes.is_empty() {
            let is_supported = target_printer
                .capabilities
                .supported_paper_sizes
                .iter()
                .any(|s| s.eq_ignore_ascii_case(paper_size));
            if !is_supported {
                println!(
                    "[RUST_IPC_HANDLER] STAGE_E_SUBMISSION_FAILED: Paper size '{}' is not supported by printer '{}'",
                    paper_size, target_printer.name
                );
                return Ok(NativePrintJobResponse {
                    job_id,
                    status: "FAILED".to_string(),
                    printer_id: target_printer.printer_id.clone(),
                    submitted_at: now,
                    native_job_id: None,
                    error_code: Some(CanonicalPrintErrorCode::UnsupportedPaperSize.as_str().to_string()),
                    message: format!(
                        "Requested paper size '{}' is not supported by printer '{}'.",
                        paper_size, target_printer.name
                    ),
                    retryable: false,
                });
            }
        }
    }

    if let Some(color_mode) = &req.color_mode {
        if color_mode.eq_ignore_ascii_case("color") {
            match target_printer.capabilities.color_supported {
                Some(false) => {
                    println!(
                        "[RUST_IPC_HANDLER] STAGE_E_SUBMISSION_FAILED: Color printing requested on monochrome printer '{}'",
                        target_printer.name
                    );
                    return Ok(NativePrintJobResponse {
                        job_id,
                        status: "FAILED".to_string(),
                        printer_id: target_printer.printer_id.clone(),
                        submitted_at: now,
                        native_job_id: None,
                        error_code: Some(CanonicalPrintErrorCode::UnsupportedColorMode.as_str().to_string()),
                        message: format!(
                            "Color mode is requested but printer '{}' only supports monochrome output.",
                            target_printer.name
                        ),
                        retryable: false,
                    });
                }
                None => {
                    println!(
                        "[RUST_IPC_HANDLER] STAGE_E_SUBMISSION_FAILED: Color mode requested but color capability is unknown for printer '{}'",
                        target_printer.name
                    );
                    return Ok(NativePrintJobResponse {
                        job_id,
                        status: "FAILED".to_string(),
                        printer_id: target_printer.printer_id.clone(),
                        submitted_at: now,
                        native_job_id: None,
                        error_code: Some(CanonicalPrintErrorCode::UnsupportedColorMode.as_str().to_string()),
                        message: format!(
                            "Color mode is requested but printer '{}' color capability is unknown or unverified.",
                            target_printer.name
                        ),
                        retryable: false,
                    });
                }
                Some(true) => {}
            }
        }
    }

    if let Some(duplex_mode) = &req.duplex_mode {
        let is_duplex = duplex_mode.eq_ignore_ascii_case("double")
            || duplex_mode.eq_ignore_ascii_case("duplex")
            || duplex_mode.eq_ignore_ascii_case("two-sided");
        if is_duplex {
            match target_printer.capabilities.duplex_supported {
                Some(false) => {
                    println!(
                        "[RUST_IPC_HANDLER] STAGE_E_SUBMISSION_FAILED: Duplex requested on simplex-only printer '{}'",
                        target_printer.name
                    );
                    return Ok(NativePrintJobResponse {
                        job_id,
                        status: "FAILED".to_string(),
                        printer_id: target_printer.printer_id.clone(),
                        submitted_at: now,
                        native_job_id: None,
                        error_code: Some(CanonicalPrintErrorCode::UnsupportedDuplex.as_str().to_string()),
                        message: format!(
                            "Two-sided printing requested but printer '{}' does not support duplex output.",
                            target_printer.name
                        ),
                        retryable: false,
                    });
                }
                None => {
                    println!(
                        "[RUST_IPC_HANDLER] STAGE_E_SUBMISSION_FAILED: Duplex requested but duplex capability is unknown for printer '{}'",
                        target_printer.name
                    );
                    return Ok(NativePrintJobResponse {
                        job_id,
                        status: "FAILED".to_string(),
                        printer_id: target_printer.printer_id.clone(),
                        submitted_at: now,
                        native_job_id: None,
                        error_code: Some(CanonicalPrintErrorCode::UnsupportedDuplex.as_str().to_string()),
                        message: format!(
                            "Two-sided printing requested but printer '{}' duplex capability is unknown or unverified.",
                            target_printer.name
                        ),
                        retryable: false,
                    });
                }
                Some(true) => {}
            }
        }
    }

    // 6. Resolve document to print (order document or test document)
    let file_to_print = if let Some(ref doc_path) = req.document_path {
        let p = std::path::PathBuf::from(doc_path);
        let resolved = p.canonicalize().ok();
        let temp_root = std::env::temp_dir().canonicalize().ok();
        let is_authorized_temp_document = resolved.as_ref().zip(temp_root.as_ref()).is_some_and(|(file, root)| {
            file.starts_with(root) &&
                file.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with("xerservice_order_")) &&
                file.is_file()
        });

        if !is_authorized_temp_document {
            return Ok(NativePrintJobResponse {
                job_id,
                status: "FAILED".to_string(),
                printer_id: target_printer.printer_id.clone(),
                submitted_at: now,
                native_job_id: None,
                error_code: Some("INVALID_DOCUMENT".to_string()),
                message: "The selected document is unavailable or outside XerService temporary storage.".to_string(),
                retryable: false,
            });
        }
        resolved.expect("validated canonical document path")
    } else if cfg!(debug_assertions) && req.is_test_job == Some(true) {
        generate_deterministic_test_document(&job_id, &target_printer.name)?
    } else {
        return Ok(NativePrintJobResponse {
            job_id,
            status: "FAILED".to_string(),
            printer_id: target_printer.printer_id.clone(),
            submitted_at: now,
            native_job_id: None,
            error_code: Some("INVALID_DOCUMENT".to_string()),
            message: "A validated XerService document is required for printing.".to_string(),
            retryable: false,
        });
    };

    // 7. Execute real OS print submission via safe CUPS Command execution
    #[cfg(target_os = "macos")]
    {
        println!(
            "[RUST_IPC_HANDLER] STAGE_E_CUPS_SUBMISSION: Submitting print job to CUPS destination '{}' (order_id={:?})",
            target_printer.name, req.order_id
        );

        let mut cmd = Command::new("/usr/bin/lp");
        cmd.arg("-d").arg(&target_printer.name);
        cmd.arg("-c"); // Force copy to CUPS spooler before temp file cleanup

        if copies > 1 {
            cmd.arg("-n").arg(copies.to_string());
        }

        if let Some(size) = &req.paper_size {
            let media_val = match size.to_lowercase().as_str() {
                "a3" => "A3",
                "legal" => "Legal",
                _ => "A4",
            };
            cmd.arg("-o").arg(format!("media={}", media_val));
        }

        if let Some(duplex) = &req.duplex_mode {
            if duplex.eq_ignore_ascii_case("double")
                || duplex.eq_ignore_ascii_case("duplex")
                || duplex.eq_ignore_ascii_case("two-sided")
            {
                cmd.arg("-o").arg("sides=two-sided-long-edge");
            } else {
                cmd.arg("-o").arg("sides=one-sided");
            }
        }

        if let Some(color) = &req.color_mode {
            if color.eq_ignore_ascii_case("bw") || color.eq_ignore_ascii_case("monochrome") {
                cmd.arg("-o").arg("ColorModel=Gray");
            }
        }

        let job_title = if let Some(ref oid) = req.order_id {
            format!("XerService Order [{}] Job [{}]", oid, job_id)
        } else {
            format!("XerService Native Print Test Step 12 [{}]", job_id)
        };
        cmd.arg("-t").arg(&job_title);
        cmd.arg(&file_to_print);

        // Persist print intent BEFORE executing CUPS submission (Step 16 & 17)
        let intent_record = super::persistence::PrintJobRecord {
            local_job_id: job_id.clone(),
            xer_service_order_id: req.order_id.clone(),
            native_job_id: None,
            printer_id: target_printer.name.clone(),
            status: "SUBMITTING".to_string(),
            title: Some(job_title.clone()),
            submitted_at: now.clone(),
            updated_at: now.clone(),
            managed_by_xer_service: true,
            submission_state: "PENDING_SUBMISSION".to_string(),
            recovery_state: "NOT_APPLICABLE".to_string(),
            last_known_native_status: None,
            retry_count: 0,
            cancellation_requested: false,
            completed_at: None,
            failed_at: None,
            error_code: None,
            error_message: None,
        };
        let _ = super::persistence::upsert_record(intent_record, None);

        let output = cmd.output().map_err(|e| {
            println!("[RUST_IPC_HANDLER] STAGE_E_SUBMISSION_FAILED: Failed to execute /usr/bin/lp: {}", e);
            let _ = fs::remove_file(&file_to_print);
            format!("Failed to execute /usr/bin/lp: {}", e)
        })?;

        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

        // Clean up temporary print file after submission
        let _ = fs::remove_file(&file_to_print);

        if output.status.success() {
            // CUPS standard output: "request id is <printer>-<id> (1 file(s))"
            let native_job_id = parse_cups_request_id(&stdout);
            println!(
                "[RUST_IPC_HANDLER] STAGE_E_CUPS_ACCEPTED: Native Spooler Job ID: {:?}",
                native_job_id
            );

            // Register submitted job in runtime tracking table
            super::status::register_submitted_job(
                &job_id,
                native_job_id.as_deref(),
                &target_printer.name,
                &now,
            );

            // Persist confirmed native job mapping (Step 16 & 17)
            let updated_record = super::persistence::PrintJobRecord {
                local_job_id: job_id.clone(),
                xer_service_order_id: req.order_id.clone(),
                native_job_id: native_job_id.clone(),
                printer_id: target_printer.name.clone(),
                status: "PRINTING".to_string(),
                title: Some(job_title.clone()),
                submitted_at: now.clone(),
                updated_at: now.clone(),
                managed_by_xer_service: true,
                submission_state: "SUBMITTED".to_string(),
                recovery_state: "NOT_APPLICABLE".to_string(),
                last_known_native_status: Some("PRINTING".to_string()),
                retry_count: 0,
                cancellation_requested: false,
                completed_at: None,
                failed_at: None,
                error_code: None,
                error_message: None,
            };
            let _ = super::persistence::upsert_record(updated_record, None);

            Ok(NativePrintJobResponse {
                job_id,
                status: "PRINTING".to_string(),
                printer_id: target_printer.printer_id.clone(),
                submitted_at: now,
                native_job_id,
                error_code: None,
                message: format!(
                    "Job spooled successfully to CUPS queue '{}'. OS Output: {}",
                    target_printer.name, stdout
                ),
                retryable: false,
            })
        } else {
            println!(
                "[RUST_IPC_HANDLER] STAGE_E_SUBMISSION_FAILED: CUPS /usr/bin/lp error: stdout='{}' stderr='{}'",
                stdout, stderr
            );

            // Persist failed submission state (Step 16 & 17)
            let failed_record = super::persistence::PrintJobRecord {
                local_job_id: job_id.clone(),
                xer_service_order_id: req.order_id.clone(),
                native_job_id: None,
                printer_id: target_printer.name.clone(),
                status: "FAILED".to_string(),
                title: Some(job_title.clone()),
                submitted_at: now.clone(),
                updated_at: now.clone(),
                managed_by_xer_service: true,
                submission_state: "FAILED".to_string(),
                recovery_state: "NOT_APPLICABLE".to_string(),
                last_known_native_status: None,
                retry_count: 0,
                cancellation_requested: false,
                completed_at: None,
                failed_at: Some(now.clone()),
                error_code: Some(CanonicalPrintErrorCode::PrintSubmissionFailed.as_str().to_string()),
                error_message: Some(format!("CUPS lp command failed: {}{}", stdout, stderr)),
            };
            let _ = super::persistence::upsert_record(failed_record, None);

            Ok(NativePrintJobResponse {
                job_id,
                status: "FAILED".to_string(),
                printer_id: target_printer.printer_id.clone(),
                submitted_at: now,
                native_job_id: None,
                error_code: Some(CanonicalPrintErrorCode::PrintSubmissionFailed.as_str().to_string()),
                message: format!("CUPS lp command failed: {}{}", stdout, stderr),
                retryable: false,
            })
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = fs::remove_file(&test_doc_path);
        println!("[RUST_IPC_HANDLER] STAGE_E_SUBMISSION_FAILED: Unsupported OS platform");
        Ok(NativePrintJobResponse {
            job_id,
            status: "FAILED".to_string(),
            printer_id: target_printer.printer_id.clone(),
            submitted_at: now,
            native_job_id: None,
            error_code: Some(CanonicalPrintErrorCode::UnknownPrintError.as_str().to_string()),
            message: "Platform is not supported by native printer adapter yet.".to_string(),
            retryable: false,
        })
    }
}

/// Parses "request id is PrinterName-123 (1 file(s))"
fn parse_cups_request_id(stdout: &str) -> Option<String> {
    if let Some(idx) = stdout.find("request id is ") {
        let remainder = &stdout[idx + 14..];
        if let Some(space_idx) = remainder.find(' ') {
            return Some(remainder[..space_idx].trim().to_string());
        } else if !remainder.trim().is_empty() {
            return Some(remainder.trim().to_string());
        }
    }
    None
}
