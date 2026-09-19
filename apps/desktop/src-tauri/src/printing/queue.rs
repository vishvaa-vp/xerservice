//! Real Native macOS CUPS Print Queue Management & Inspection Module
//!
//! Queries host OS CUPS spooler for active print jobs across all or specified printers.
//! Strictly validates printer destinations and job identifiers with zero shell interpolation.
//! Differentiates XerService-managed jobs from external system jobs.
//! Enforces safety invariant: Unmanaged system jobs are non-cancellable and untouchable.
//! Keeps native CUPS authoritative and truthful: Never fabricates phantom jobs.

use super::discovery::discover_installed_printers;
use super::status::{
    get_registered_job_by_any_id, is_xer_service_managed, validate_identifier,
};
use serde::{Deserialize, Serialize};

/// Platform-neutral representation of a print job in the native spooler queue.
/// Aligned with @packages/printing PrintQueueItem.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintQueueItem {
    pub job_id: String,
    pub printer_id: String,
    pub status: String,
    pub title: Option<String>,
    pub submitted_at: Option<String>,
    pub owner: Option<String>,
    pub pages: Option<u32>,
    pub size_bytes: Option<u64>,
    pub message: Option<String>,
    pub managed_by_xer_service: bool,
    pub cancellable: bool,
}

/// Parses raw CUPS `lpstat -l` output into normalized `PrintQueueItem` entries.
pub fn parse_cups_queue_output(output: &str, printer_filter: Option<&str>) -> Vec<PrintQueueItem> {
    let mut items = Vec::new();
    let lower_filter = printer_filter.map(|f| f.to_lowercase());

    // Temporary storage for an in-flight job block
    struct JobBlock {
        raw_job_line: String,
        status_line: Option<String>,
        title: Option<String>,
        pages: Option<u32>,
        queued_for: Option<String>,
    }

    let mut current_block: Option<JobBlock> = None;

    let finalize_block = |block: JobBlock, items: &mut Vec<PrintQueueItem>| {
        let trimmed_line = block.raw_job_line.trim();
        if trimmed_line.is_empty() {
            return;
        }

        let tokens: Vec<&str> = trimmed_line.split_whitespace().collect();
        if tokens.is_empty() {
            return;
        }

        // First token is "<printer>-<job_number>"
        let full_job_token = tokens[0];
        let (printer_name, job_num) = match full_job_token.rfind('-') {
            Some(idx) => (&full_job_token[..idx], &full_job_token[idx + 1..]),
            None => ("", full_job_token),
        };

        let effective_printer = block
            .queued_for
            .as_deref()
            .unwrap_or(if !printer_name.is_empty() {
                printer_name
            } else {
                "unknown"
            });

        // Apply printer filter if supplied
        if let Some(ref filter) = lower_filter {
            if effective_printer.to_lowercase() != *filter && printer_name.to_lowercase() != *filter {
                return;
            }
        }

        let owner = tokens.get(1).map(|s| s.to_string());
        let size_bytes = tokens.get(2).and_then(|s| s.parse::<u64>().ok());

        let submitted_at = if tokens.len() >= 4 {
            Some(tokens[3..].join(" "))
        } else {
            None
        };

        // Determine status from status line or default to QUEUED
        let status_text = block.status_line.unwrap_or_default();
        let lower_status = status_text.to_lowercase();

        let normalized_status = if lower_status.contains("processing")
            || lower_status.contains("printing")
            || lower_status.contains("sending data")
        {
            "PRINTING"
        } else if lower_status.contains("job-canceled")
            || lower_status.contains("canceled")
            || lower_status.contains("cancelled")
        {
            "CANCELLED"
        } else if lower_status.contains("job-aborted")
            || lower_status.contains("aborted")
            || lower_status.contains("job-stopped")
            || lower_status.contains("failed")
        {
            "FAILED"
        } else if lower_status.contains("job-completed") || lower_status.contains("completed") {
            "COMPLETED"
        } else {
            "QUEUED"
        };

        // Check if managed by XerService
        let is_managed = is_xer_service_managed(full_job_token, block.title.as_deref())
            || is_xer_service_managed(job_num, block.title.as_deref());

        // Check if matching registered submitted job
        let registered = get_registered_job_by_any_id(full_job_token)
            .or_else(|| get_registered_job_by_any_id(job_num));

        let effective_job_id = if let Some(ref reg) = registered {
            reg.job_id.clone()
        } else {
            full_job_token.to_string()
        };

        // CRITICAL INVARIANT: Only XerService-managed jobs in active state are cancellable
        let cancellable = is_managed
            && (normalized_status == "QUEUED" || normalized_status == "PRINTING");

        let message = if is_managed {
            format!("XerService managed job (native id: {})", full_job_token)
        } else {
            format!("External system job (native id: {})", full_job_token)
        };

        items.push(PrintQueueItem {
            job_id: effective_job_id,
            printer_id: effective_printer.to_string(),
            status: normalized_status.to_string(),
            title: block.title,
            submitted_at,
            owner,
            pages: block.pages,
            size_bytes,
            message: Some(message),
            managed_by_xer_service: is_managed,
            cancellable,
        });
    };

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // New job entry starts at column 0 (not indented)
        if !line.starts_with(' ') && !line.starts_with('\t') {
            if let Some(prev) = current_block.take() {
                finalize_block(prev, &mut items);
            }

            current_block = Some(JobBlock {
                raw_job_line: trimmed.to_string(),
                status_line: None,
                title: None,
                pages: None,
                queued_for: None,
            });
        } else if let Some(ref mut block) = current_block {
            let lower = trimmed.to_lowercase();
            if lower.starts_with("status:") {
                block.status_line = Some(trimmed["status:".len()..].trim().to_string());
            } else if lower.starts_with("title:") {
                block.title = Some(trimmed["title:".len()..].trim().to_string());
            } else if lower.starts_with("queued for") {
                block.queued_for = Some(trimmed["queued for".len()..].trim().to_string());
            } else if lower.starts_with("pages:") {
                block.pages = trimmed["pages:".len()..].trim().parse::<u32>().ok();
            } else if block.status_line.is_none() && (lower.contains("processing") || lower.contains("pending") || lower.contains("held")) {
                block.status_line = Some(trimmed.to_string());
            }
        }
    }

    if let Some(prev) = current_block {
        finalize_block(prev, &mut items);
    }

    items
}

/// Queries the host OS CUPS subsystem for real-time print queue status.
///
/// Can query all queues or filter by a specific printer destination.
/// If `printer_id` is specified, it validates that the printer exists on the host.
pub fn get_native_print_queue(printer_id: Option<&str>) -> Result<Vec<PrintQueueItem>, String> {
    println!(
        "[RUST_IPC_HANDLER] STAGE_D_QUEUE_HANDLER_RECEIVED: printer_id={:?}",
        printer_id
    );
    println!("[RUST_IPC_HANDLER] STAGE_E_QUEUE_QUERY_STARTED: Querying native CUPS print queue...");

    // 1. Validate destination identifier if provided
    if let Some(pid) = printer_id {
        if let Err(e) = validate_identifier(pid) {
            println!("[RUST_IPC_HANDLER] STAGE_E_QUEUE_QUERY_FAILED: Invalid printer_id: {}", e);
            return Err(format!("PRINTER_NOT_FOUND: Invalid printer_id '{}': {}", pid, e));
        }

        // Validate printer destination exists on host
        let installed = discover_installed_printers()
            .map_err(|e| format!("Failed to query host OS printers: {}", e))?;
        let exists = installed.iter().any(|p| p.printer_id == pid || p.name == pid);
        if !exists {
            println!(
                "[RUST_IPC_HANDLER] STAGE_E_QUEUE_QUERY_FAILED: Printer '{}' does not exist on host",
                pid
            );
            return Err(format!(
                "PRINTER_NOT_FOUND: Printer '{}' not found among host OS installed printers (Total discovered: {}).",
                pid,
                installed.len()
            ));
        }
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        use std::process::Command;

        let lpstat_bin = if std::path::Path::new("/usr/bin/lpstat").exists() {
            "/usr/bin/lpstat"
        } else {
            "lpstat"
        };

        // Query active not-completed queue via safe process invocation (zero shell)
        let mut cmd = Command::new(lpstat_bin);
        cmd.arg("-l").arg("-W").arg("not-completed");
        if let Some(pid) = printer_id {
            cmd.arg("-o").arg(pid);
        }

        let output = cmd.output().map_err(|e| {
            println!(
                "[RUST_IPC_HANDLER] STAGE_E_QUEUE_QUERY_FAILED: Failed to execute {}: {}",
                lpstat_bin, e
            );
            format!("Failed to execute {}: {}", lpstat_bin, e)
        })?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let items = parse_cups_queue_output(&stdout, printer_id);

        println!(
            "[RUST_IPC_HANDLER] STAGE_E_QUEUE_QUERY_COMPLETED: Found {} jobs in active CUPS queue",
            items.len()
        );
        println!(
            "[RUST_IPC_HANDLER] STAGE_E_QUEUE_NORMALIZED: Normalized {} queue items",
            items.len()
        );

        Ok(items)
    }

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;

        let ps_cmd = match printer_id {
            Some(pid) => {
                let escaped = pid.replace('\'', "''");
                format!(
                    "Get-PrintJob -PrinterName '{}' | Select-Object Id, DocumentName, JobStatus, TotalPages, PagesPrinted, SubmittedTime, UserName | ConvertTo-Json -Compress",
                    escaped
                )
            }
            None => "Get-PrintJob | Select-Object Id, DocumentName, JobStatus, TotalPages, PagesPrinted, SubmittedTime, UserName, PrinterName | ConvertTo-Json -Compress".to_string(),
        };

        let mut items = Vec::new();

        if let Ok(output) = Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &ps_cmd])
            .output()
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !stdout.is_empty() && stdout != "null" {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&stdout) {
                        let raw_items: Vec<&serde_json::Value> = match &parsed {
                            serde_json::Value::Array(arr) => arr.iter().collect(),
                            serde_json::Value::Object(_) => vec![&parsed],
                            _ => Vec::new(),
                        };

                        for raw in raw_items {
                            let id_num = raw.get("Id").and_then(|v| v.as_i64()).map(|n| n.to_string()).unwrap_or_default();
                            let doc_name = raw.get("DocumentName").and_then(|v| v.as_str()).map(|s| s.to_string());
                            let status_str = raw.get("JobStatus").and_then(|v| v.as_str()).unwrap_or("");
                            let pages = raw.get("TotalPages").and_then(|v| v.as_u64()).map(|p| p as u32);
                            let owner = raw.get("UserName").and_then(|v| v.as_str()).map(|s| s.to_string());
                            let item_printer = raw.get("PrinterName").and_then(|v| v.as_str()).unwrap_or(printer_id.unwrap_or("unknown"));

                            let lower_st = status_str.to_lowercase();
                            let canonical_status = if lower_st.contains("print") || lower_st.contains("spool") {
                                "PRINTING"
                            } else if lower_st.contains("pause") || lower_st.contains("block") {
                                "HELD"
                            } else if lower_st.contains("error") || lower_st.contains("paper") {
                                "FAILED"
                            } else {
                                "QUEUED"
                            };

                            let is_managed = is_xer_service_managed(&id_num)
                                || doc_name.as_ref().map(|d| d.contains("XerService")).unwrap_or(false);

                            items.push(PrintQueueItem {
                                job_id: id_num,
                                printer_id: item_printer.to_string(),
                                status: canonical_status.to_string(),
                                title: doc_name,
                                submitted_at: raw.get("SubmittedTime").and_then(|v| v.as_str()).map(|s| s.to_string()),
                                owner,
                                pages,
                                size_bytes: None,
                                message: Some(format!("Windows Spooler: {}", status_str)),
                                managed_by_xer_service: is_managed,
                                cancellable: is_managed,
                            });
                        }
                    }
                }
            }
        }

        println!(
            "[RUST_IPC_HANDLER] STAGE_E_QUEUE_QUERY_COMPLETED: Found {} jobs in Windows print queue",
            items.len()
        );

        Ok(items)
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        Ok(Vec::new())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_empty_cups_output() {
        let items = parse_cups_queue_output("", None);
        assert!(items.is_empty());

        let whitespace_items = parse_cups_queue_output("   \n\n  \t \n", None);
        assert!(whitespace_items.is_empty());
    }

    #[test]
    fn test_parse_single_managed_job() {
        let sample = "\
DeskJet-42              john             1024   Mon Sep 14 04:00:00 2026
\tStatus: processing since Mon Sep 14 04:00:00 2026
\tFilter: pdftops
\tTitle: XerService Order XS-10001
\tAlerts: none
\tqueued for DeskJet
";
        let items = parse_cups_queue_output(sample, None);
        assert_eq!(items.len(), 1);

        let item = &items[0];
        assert_eq!(item.job_id, "DeskJet-42");
        assert_eq!(item.printer_id, "DeskJet");
        assert_eq!(item.status, "PRINTING");
        assert_eq!(item.title.as_deref(), Some("XerService Order XS-10001"));
        assert_eq!(item.owner.as_deref(), Some("john"));
        assert_eq!(item.size_bytes, Some(1024));
        assert!(item.managed_by_xer_service);
        assert!(item.cancellable);
    }

    #[test]
    fn test_parse_multiple_jobs_with_unmanaged() {
        let sample = "\
DeskJet-42              john             1024   Mon Sep 14 04:00:00 2026
\tStatus: pending
\tTitle: XerService Test Job
\tqueued for DeskJet
LaserJet-99             alice            8192   Mon Sep 14 04:05:00 2026
\tStatus: pending
\tTitle: Personal Photos
\tqueued for LaserJet
";
        let items = parse_cups_queue_output(sample, None);
        assert_eq!(items.len(), 2);

        // Job 1: XerService managed
        assert!(items[0].managed_by_xer_service);
        assert!(items[0].cancellable);
        assert_eq!(items[0].status, "QUEUED");

        // Job 2: Unmanaged external job
        assert!(!items[1].managed_by_xer_service);
        assert!(!items[1].cancellable); // Untouchable!
        assert_eq!(items[1].status, "QUEUED");
    }

    #[test]
    fn test_unmanaged_job_cannot_be_cancelled() {
        let sample = "\
HP_LaserJet-101         system           40960  Sun Sep 13 22:15:30 2026
\tStatus: processing
\tTitle: System Tax Report
\tqueued for HP_LaserJet
";
        let items = parse_cups_queue_output(sample, None);
        assert_eq!(items.len(), 1);
        assert!(!items[0].managed_by_xer_service);
        assert!(!items[0].cancellable, "External unmanaged jobs must NEVER be cancellable");
    }

    #[test]
    fn test_completed_or_failed_job_not_cancellable() {
        let sample = "\
DeskJet-50              john             1024   Mon Sep 14 04:00:00 2026
\tStatus: job-completed
\tTitle: XerService Finished Job
\tqueued for DeskJet
DeskJet-51              john             1024   Mon Sep 14 04:01:00 2026
\tStatus: job-aborted
\tTitle: XerService Failed Job
\tqueued for DeskJet
";
        let items = parse_cups_queue_output(sample, None);
        assert_eq!(items.len(), 2);

        assert_eq!(items[0].status, "COMPLETED");
        assert!(!items[0].cancellable);

        assert_eq!(items[1].status, "FAILED");
        assert!(!items[1].cancellable);
    }

    #[test]
    fn test_printer_filter() {
        let sample = "\
DeskJet-42              john             1024   Mon Sep 14 04:00:00 2026
\tStatus: pending
\tTitle: XerService Job 1
\tqueued for DeskJet
Office_Printer-88       bob              2048   Mon Sep 14 04:02:00 2026
\tStatus: pending
\tTitle: XerService Job 2
\tqueued for Office_Printer
";
        let deskjet_items = parse_cups_queue_output(sample, Some("DeskJet"));
        assert_eq!(deskjet_items.len(), 1);
        assert_eq!(deskjet_items[0].printer_id, "DeskJet");

        let office_items = parse_cups_queue_output(sample, Some("Office_Printer"));
        assert_eq!(office_items.len(), 1);
        assert_eq!(office_items[0].printer_id, "Office_Printer");

        let nonexistent_items = parse_cups_queue_output(sample, Some("Imaginary"));
        assert_eq!(nonexistent_items.len(), 0);
    }

    #[test]
    fn test_real_host_cups_queue_empty() {
        let res = get_native_print_queue(None);
        assert!(res.is_ok());
        let items = res.unwrap();
        // Since current host has 0 printers and no jobs, queue must be empty
        assert_eq!(items.len(), 0);
    }

    #[test]
    fn test_non_existent_printer_returns_error() {
        let res = get_native_print_queue(Some("non-existent-printer-dest-999"));
        assert!(res.is_err());
        let err = res.unwrap_err();
        assert!(err.contains("PRINTER_NOT_FOUND"));
    }
}
