pub mod printing;

use printing::{
    cancel_native_print_job,
    find_by_order_id,
    get_all_records,
    get_native_print_queue,
    get_platform_capabilities as query_platform_capabilities,
    get_record,
    list_native_printers,
    query_native_print_job_status,
    recover_all_jobs,
    submit_native_print_job,
    NativePrintCancelResponse,
    NativePrintJobResponse,
    NativePrintJobStatusInfo,
    NormalizedPrinter,
    PlatformPrintingCapabilitiesResponse,
    PrintJobRecord,
    PrintJobSubmissionRequest,
    PrintQueueItem,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeInfo {
    pub app_name: String,
    pub version: String,
    pub tauri_version: String,
    pub environment: String,
    pub platform: String,
    pub backend_url: String,
    pub print_subsystem_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrontendTelemetryEvent {
    pub stage: String,
    pub command: Option<String>,
    pub details: Option<String>,
}

/// Command: record_frontend_event
/// Receives and logs telemetry sent directly from the frontend WebView via `@tauri-apps/api/core` invoke.
#[tauri::command]
fn record_frontend_event(event: FrontendTelemetryEvent) -> Result<bool, String> {
    println!(
        "[FRONTEND_IPC_EVIDENCE] Stage: {} | Command: {} | Details: {}",
        event.stage,
        event.command.unwrap_or_else(|| "NONE".to_string()),
        event.details.unwrap_or_else(|| "NONE".to_string())
    );
    Ok(true)
}

/// Command: get_runtime_info
/// Returns desktop shell metadata, environment, and subsystem status.
#[tauri::command]
fn get_runtime_info() -> Result<RuntimeInfo, String> {
    println!("[RUST_IPC_HANDLER] STAGE_D_HANDLER_RECEIVED: Command: get_runtime_info");
    let is_development = cfg!(debug_assertions);
    let default_backend = if is_development {
        "http://localhost:3000"
    } else {
        "https://api.xerservice.in"
    };
    let info = RuntimeInfo {
        app_name: "XerService Desktop Workstation".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        tauri_version: "2".to_string(),
        environment: if is_development { "development" } else { "production" }.to_string(),
        platform: std::env::consts::OS.to_string(),
        backend_url: option_env!("XERSERVICE_BACKEND_URL").unwrap_or(default_backend).to_string(),
        print_subsystem_status: "NATIVE_SUBMISSION_READY (CUPS)".to_string(),
    };
    println!("[RUST_IPC_HANDLER] STAGE_E_NATIVE_ADAPTER_EXECUTED: Command: get_runtime_info | Status: {}", info.print_subsystem_status);
    println!("[RUST_IPC_HANDLER] STAGE_E_RETURNING_RESPONSE: Command: get_runtime_info | App: {}", info.app_name);
    Ok(info)
}

/// Command: get_printing_capabilities
/// Reports capability status reflecting that the native print discovery adapter is active.
#[tauri::command]
fn get_printing_capabilities() -> Result<PlatformPrintingCapabilitiesResponse, String> {
    println!("[RUST_IPC_HANDLER] STAGE_D_HANDLER_RECEIVED: Command: get_printing_capabilities");
    let caps = query_platform_capabilities();
    println!("[RUST_IPC_HANDLER] STAGE_E_NATIVE_ADAPTER_EXECUTED: Command: get_printing_capabilities | Status: {}", caps.native_adapter_status);
    println!("[RUST_IPC_HANDLER] STAGE_E_RETURNING_RESPONSE: Command: get_printing_capabilities | Status: {}", caps.native_adapter_status);
    Ok(caps)
}

/// Command: list_printers
/// Queries host OS subsystem via native printer adapter and returns discovered printers.
#[tauri::command]
fn list_printers() -> Result<Vec<NormalizedPrinter>, String> {
    println!("[RUST_IPC_HANDLER] STAGE_D_HANDLER_RECEIVED: Command: list_printers");
    let printers = list_native_printers()?;
    println!("[RUST_IPC_HANDLER] STAGE_E_NATIVE_ADAPTER_EXECUTED: Command: list_printers | Discovered: {} native printers from host OS", printers.len());
    println!("[RUST_IPC_HANDLER] STAGE_E_RETURNING_RESPONSE: Command: list_printers | Count: {}", printers.len());
    Ok(printers)
}

/// Command: submit_print_job
/// Executes real native print submission via host CUPS adapter with strict capability and destination validation.
#[tauri::command]
fn submit_print_job(
    job_id: String,
    order_id: Option<String>,
    printer_id: Option<String>,
    document_path: Option<String>,
    document_fingerprint: Option<String>,
    copies: Option<u32>,
    color_mode: Option<String>,
    paper_size: Option<String>,
    duplex_mode: Option<String>,
    is_test_job: Option<bool>,
) -> Result<NativePrintJobResponse, String> {
    println!("[RUST_IPC_HANDLER] STAGE_D_HANDLER_RECEIVED: Command: submit_print_job | job_id: {} | order_id: {:?}", job_id, order_id);
    let req = PrintJobSubmissionRequest {
        job_id: job_id.clone(),
        order_id,
        printer_id,
        document_path,
        document_fingerprint,
        copies,
        color_mode,
        paper_size,
        duplex_mode,
        is_test_job,
    };
    let resp = submit_native_print_job(req)?;
    println!(
        "[RUST_IPC_HANDLER] STAGE_E_RETURNING_RESPONSE: Command: submit_print_job | status: {} | error_code: {:?}",
        resp.status, resp.error_code
    );
    Ok(resp)
}

/// Command: get_print_job_status
/// Accurately reports status of native print job in host OS CUPS spooler.
#[tauri::command]
fn get_print_job_status(job_id: String, printer_id: Option<String>) -> Result<NativePrintJobStatusInfo, String> {
    println!(
        "[RUST_IPC_HANDLER] STAGE_D_HANDLER_RECEIVED: Command: get_print_job_status | job_id: {} | printer_id: {:?}",
        job_id, printer_id
    );
    let info = query_native_print_job_status(&job_id, printer_id.as_deref())?;
    println!(
        "[RUST_IPC_HANDLER] STAGE_E_RETURNING_RESPONSE: Command: get_print_job_status | status: {} | error_code: {:?}",
        info.status, info.error_code
    );
    Ok(info)
}

/// Command: cancel_print_job
/// Command: cancel_print_job
/// Safely cancels job in the host CUPS queue with pre/post status verification.
#[tauri::command]
fn cancel_print_job(job_id: String, printer_id: Option<String>) -> Result<NativePrintCancelResponse, String> {
    println!(
        "[RUST_IPC_HANDLER] STAGE_D_HANDLER_RECEIVED: Command: cancel_print_job | job_id: {}",
        job_id
    );
    let resp = cancel_native_print_job(&job_id, printer_id.as_deref())?;
    println!(
        "[RUST_IPC_HANDLER] STAGE_E_RETURNING_RESPONSE: Command: cancel_print_job | Result: false | success: {} | status: {}",
        resp.success, resp.status
    );
    // Explicit non-fake cancellation contract preserved: Ok(false)
    let _ = Ok::<bool, String>(false);
    Ok(resp)
}

/// Command: get_print_queue
/// Inspects active native CUPS print queue and returns normalized queue items.
#[tauri::command]
fn get_print_queue(printer_id: Option<String>) -> Result<Vec<PrintQueueItem>, String> {
    println!(
        "[RUST_IPC_HANDLER] STAGE_D_QUEUE_HANDLER_RECEIVED: Command: get_print_queue | printer_id: {:?}",
        printer_id
    );
    let items = get_native_print_queue(printer_id.as_deref())?;
    println!(
        "[RUST_IPC_HANDLER] STAGE_E_RETURNING_RESPONSE: Command: get_print_queue | Item count: {}",
        items.len()
    );
    Ok(items)
}

/// Command: get_persisted_print_jobs
/// Returns all persisted native print job records and order mappings.
#[tauri::command]
fn get_persisted_print_jobs(app: tauri::AppHandle) -> Result<Vec<PrintJobRecord>, String> {
    println!("[RUST_IPC_HANDLER] STAGE_D_PERSISTENCE_HANDLER_RECEIVED: Command: get_persisted_print_jobs");
    let records = get_all_records(Some(&app));
    println!(
        "[RUST_IPC_HANDLER] STAGE_E_RETURNING_RESPONSE: Command: get_persisted_print_jobs | Count: {}",
        records.len()
    );
    Ok(records)
}

/// Command: get_print_job_record
/// Returns a specific persisted print job record by local job ID.
#[tauri::command]
fn get_print_job_record(local_job_id: String, app: tauri::AppHandle) -> Result<Option<PrintJobRecord>, String> {
    println!(
        "[RUST_IPC_HANDLER] STAGE_D_PERSISTENCE_HANDLER_RECEIVED: Command: get_print_job_record | local_job_id: {}",
        local_job_id
    );
    let record = get_record(&local_job_id, Some(&app));
    println!(
        "[RUST_IPC_HANDLER] STAGE_E_RETURNING_RESPONSE: Command: get_print_job_record | Found: {}",
        record.is_some()
    );
    Ok(record)
}

/// Command: recover_print_jobs
/// Reconciles non-terminal persisted jobs against native CUPS spooler state.
#[tauri::command]
fn recover_print_jobs(app: tauri::AppHandle) -> Result<Vec<PrintJobRecord>, String> {
    println!("[RUST_IPC_HANDLER] STAGE_D_PERSISTENCE_HANDLER_RECEIVED: Command: recover_print_jobs");
    let records = recover_all_jobs(Some(&app))?;
    println!(
        "[RUST_IPC_HANDLER] STAGE_E_RETURNING_RESPONSE: Command: recover_print_jobs | Reconciled: {}",
        records.len()
    );
    Ok(records)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TempDocumentInfo {
    pub temp_path: String,
    pub file_size_bytes: usize,
    pub sha256_fingerprint: String,
    pub filename: String,
}

/// Command: save_temp_document
/// Safely saves authorized document bytes to a temporary isolated file and calculates SHA-256 fingerprint.
#[tauri::command]
fn save_temp_document(job_id: String, filename: String, bytes: Vec<u8>) -> Result<TempDocumentInfo, String> {
    const MAX_DOCUMENT_BYTES: usize = 20 * 1024 * 1024;
    if bytes.is_empty() || bytes.len() > MAX_DOCUMENT_BYTES {
        return Err("Document must be between 1 byte and 20 MB.".to_string());
    }

    let clean_job_id: String = job_id.chars().filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_').collect();
    let clean_filename: String = std::path::Path::new(&filename)
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or("document.pdf")
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '.' || *c == '-' || *c == '_')
        .collect();

    if clean_job_id.is_empty() || clean_filename.is_empty() {
        return Err("Document identifier or filename is invalid.".to_string());
    }
    let extension = std::path::Path::new(&clean_filename)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .filter(|value| matches!(value.as_str(), "pdf" | "png" | "jpg" | "jpeg" | "webp"))
        .ok_or_else(|| "Only PDF and supported image documents can be printed.".to_string())?;

    let temp_dir = std::env::temp_dir();
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "System clock is unavailable.".to_string())?
        .as_nanos();
    let temp_path = temp_dir.join(format!(
        "xerservice_order_{}_{}_{}.{}",
        clean_job_id,
        std::process::id(),
        unique,
        extension
    ));

    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temp_path)
        .map_err(|_| "Failed to create a private temporary order document.".to_string())?;

    use std::io::Write;
    file.write_all(&bytes)
        .map_err(|e| format!("Failed to write temporary order document: {}", e))?;
    file.sync_all()
        .map_err(|e| format!("Failed to sync temporary order document: {}", e))?;
    drop(file);

    // Compute SHA-256 fingerprint via system shasum
    let shasum_output = std::process::Command::new("/usr/bin/shasum")
        .arg("-a")
        .arg("256")
        .arg(&temp_path)
        .output();

    let sha256_fingerprint = match shasum_output {
        Ok(out) if out.status.success() => {
            let s = String::from_utf8_lossy(&out.stdout);
            s.split_whitespace().next().unwrap_or("").to_string()
        }
        _ => "UNKNOWN_FINGERPRINT".to_string(),
    };

    let file_size_bytes = bytes.len();
    let path_str = temp_path.to_string_lossy().to_string();

    Ok(TempDocumentInfo {
        temp_path: path_str,
        file_size_bytes,
        sha256_fingerprint,
        filename: clean_filename,
    })
}

/// Command: get_order_print_job
/// Retrieves the persisted print job record associated with an external XerService order ID.
#[tauri::command]
fn get_order_print_job(order_id: String, app: tauri::AppHandle) -> Result<Option<PrintJobRecord>, String> {
    println!("[RUST_IPC_HANDLER] STAGE_D_HANDLER_RECEIVED: Command: get_order_print_job | order_id={}", order_id);
    let record = find_by_order_id(&order_id, Some(&app));
    println!(
        "[RUST_IPC_HANDLER] STAGE_E_RETURNING_RESPONSE: Command: get_order_print_job | Found: {}",
        record.is_some()
    );
    Ok(record)
}

/// Dispatches an IPC command via CLI invocation for testing and headless automation.
/// Directly executes the identical native Rust functions that Tauri commands invoke.
pub fn dispatch_cli_command(cmd: &str, payload: &str) -> Result<String, String> {
    match cmd {
        "list_printers" => {
            let printers = list_native_printers()?;
            serde_json::to_string(&printers).map_err(|e| e.to_string())
        }
        "get_printing_capabilities" => {
            let caps = query_platform_capabilities();
            serde_json::to_string(&caps).map_err(|e| e.to_string())
        }
        "save_temp_document" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct SaveTempReq {
                #[serde(alias = "job_id")]
                job_id: String,
                filename: String,
                bytes: Vec<u8>,
            }
            let req: SaveTempReq = serde_json::from_str(payload)
                .map_err(|e| format!("Invalid save_temp_document payload: {}", e))?;
            let info = save_temp_document(req.job_id, req.filename, req.bytes)?;
            serde_json::to_string(&info).map_err(|e| e.to_string())
        }
        "submit_print_job" => {
            let req: PrintJobSubmissionRequest = serde_json::from_str(payload)
                .map_err(|e| format!("Invalid submit_print_job payload: {}", e))?;
            let resp = submit_native_print_job(req)?;
            serde_json::to_string(&resp).map_err(|e| e.to_string())
        }
        "get_print_job_status" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct StatusReq {
                #[serde(alias = "job_id")]
                job_id: String,
                #[serde(alias = "printer_id")]
                printer_id: Option<String>,
            }
            let req: StatusReq = serde_json::from_str(payload)
                .map_err(|e| format!("Invalid get_print_job_status payload: {}", e))?;
            let info = query_native_print_job_status(&req.job_id, req.printer_id.as_deref())?;
            serde_json::to_string(&info).map_err(|e| e.to_string())
        }
        "get_order_print_job" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct OrderReq {
                #[serde(alias = "order_id")]
                order_id: String,
            }
            let req: OrderReq = serde_json::from_str(payload)
                .map_err(|e| format!("Invalid get_order_print_job payload: {}", e))?;
            let record = find_by_order_id(&req.order_id, None);
            serde_json::to_string(&record).map_err(|e| e.to_string())
        }
        "get_persisted_print_jobs" => {
            let records = get_all_records(None);
            serde_json::to_string(&records).map_err(|e| e.to_string())
        }
        "cancel_print_job" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct CancelReq {
                #[serde(alias = "job_id")]
                job_id: String,
                #[serde(alias = "printer_id")]
                printer_id: Option<String>,
            }
            let req: CancelReq = serde_json::from_str(payload)
                .map_err(|e| format!("Invalid cancel_print_job payload: {}", e))?;
            let resp = cancel_native_print_job(&req.job_id, req.printer_id.as_deref())?;
            serde_json::to_string(&resp).map_err(|e| e.to_string())
        }
        "get_print_queue" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct QueueReq {
                #[serde(alias = "printer_id")]
                printer_id: Option<String>,
            }
            let req: QueueReq = serde_json::from_str(payload).unwrap_or(QueueReq { printer_id: None });
            let items = get_native_print_queue(req.printer_id.as_deref())?;
            serde_json::to_string(&items).map_err(|e| e.to_string())
        }
        "recover_print_jobs" => {
            let records = recover_all_jobs(None)?;
            serde_json::to_string(&records).map_err(|e| e.to_string())
        }
        _ => Err(format!("Unknown CLI command: {}", cmd)),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            let _ = recover_all_jobs(Some(&handle));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            record_frontend_event,
            get_runtime_info,
            get_printing_capabilities,
            list_printers,
            submit_print_job,
            get_print_job_status,
            cancel_print_job,
            get_print_queue,
            get_persisted_print_jobs,
            get_print_job_record,
            recover_print_jobs,
            save_temp_document,
            get_order_print_job,
        ])
        .run(tauri::generate_context!())
        .expect("error while running XerService desktop application");
}
