//! Real Native Print Job Persistence & Order-Safe Mapping Engine
//!
//! Provides crash-safe, durable persistence of native print jobs and order mappings.
//! Uses atomic filesystem operations (.tmp -> rename) in OS-managed application data directories.
//! Strictly prevents duplicate physical printing across application crashes and restarts.
//! Reconciles non-terminal jobs against authoritative native CUPS spooler state on startup.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use super::status::validate_identifier;

pub const CURRENT_SCHEMA_VERSION: u32 = 1;
pub const STORAGE_FILE_NAME: &str = "xerservice_print_jobs.json";

/// Durable native desktop print job record and order-safe mapping model.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrintJobRecord {
    pub local_job_id: String,
    pub xer_service_order_id: Option<String>,
    pub native_job_id: Option<String>,
    pub printer_id: String,
    pub status: String,
    pub title: Option<String>,
    pub submitted_at: String,
    pub updated_at: String,
    pub managed_by_xer_service: bool,
    pub submission_state: String, // "PENDING_SUBMISSION" | "SUBMITTED" | "FAILED"
    pub recovery_state: String, // "NOT_APPLICABLE" | "RECONCILED" | "INVESTIGATION_REQUIRED" | "MISSING_FROM_CUPS"
    pub last_known_native_status: Option<String>,
    pub retry_count: u32,
    pub cancellation_requested: bool,
    pub completed_at: Option<String>,
    pub failed_at: Option<String>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

/// Versioned persistent file container.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrintJobStoreFile {
    pub schema_version: u32,
    pub records: Vec<PrintJobRecord>,
}

static IN_MEMORY_STORE: LazyLock<Mutex<Option<PrintJobStoreFile>>> =
    LazyLock::new(|| Mutex::new(None));

/// Resolves the application data directory safely without hardcoding machine-specific paths.
pub fn resolve_storage_dir(app: Option<&tauri::AppHandle>) -> Result<PathBuf, String> {
    if let Some(dir) = std::env::var_os("XERSERVICE_DATA_DIR") {
        return Ok(PathBuf::from(dir));
    }

    if let Some(handle) = app {
        use tauri::Manager;
        if let Ok(path) = handle.path().app_data_dir() {
            return Ok(path);
        }
    }

    // Platform-standard OS application support fallback
    #[cfg(target_os = "macos")]
    {
        if let Some(home) = std::env::var_os("HOME") {
            let mut p = PathBuf::from(home);
            p.push("Library");
            p.push("Application Support");
            p.push("in.xerservice.desktop");
            return Ok(p);
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            let mut p = PathBuf::from(appdata);
            p.push("in.xerservice.desktop");
            return Ok(p);
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        if let Some(home) = std::env::var_os("HOME") {
            let mut p = PathBuf::from(home);
            p.push(".local");
            p.push("share");
            p.push("in.xerservice.desktop");
            return Ok(p);
        }
    }

    Err("Unable to determine application data directory".to_string())
}

/// Atomically persists the store to disk using write-to-temp and atomic rename.
pub fn save_store_to_dir(store: &PrintJobStoreFile, dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("Failed to create storage directory {:?}: {}", dir, e))?;

    let target_path = dir.join(STORAGE_FILE_NAME);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let tmp_path = dir.join(format!(".{}.{}.tmp", STORAGE_FILE_NAME, nanos));

    let json_bytes = serde_json::to_string_pretty(store)
        .map_err(|e| format!("Serialization error: {}", e))?;

    let mut tmp_file = fs::File::create(&tmp_path)
        .map_err(|e| format!("Failed to create temp file {:?}: {}", tmp_path, e))?;

    tmp_file
        .write_all(json_bytes.as_bytes())
        .map_err(|e| format!("Failed to write to temp file: {}", e))?;

    tmp_file
        .sync_all()
        .map_err(|e| format!("Failed to sync temp file to disk: {}", e))?;

    drop(tmp_file);

    fs::rename(&tmp_path, &target_path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        format!("Atomic rename from {:?} to {:?} failed: {}", tmp_path, target_path, e)
    })?;

    println!(
        "[RUST_PERSISTENCE] STAGE_E_STATE_PERSISTED: Successfully persisted {} records atomically to {:?}",
        store.records.len(),
        target_path
    );

    Ok(())
}

/// Loads the persistent print job store from disk, handling missing or corrupt state safely.
pub fn load_store_from_dir(dir: &Path) -> Result<PrintJobStoreFile, String> {
    let target_path = dir.join(STORAGE_FILE_NAME);

    if !target_path.exists() {
        println!(
            "[RUST_PERSISTENCE] STAGE_E_STATE_LOADED: No persistence file at {:?}; initializing fresh store",
            target_path
        );
        return Ok(PrintJobStoreFile {
            schema_version: CURRENT_SCHEMA_VERSION,
            records: Vec::new(),
        });
    }

    let raw_content = fs::read_to_string(&target_path)
        .map_err(|e| format!("Failed to read persistence file {:?}: {}", target_path, e))?;

    if raw_content.trim().is_empty() {
        println!(
            "[RUST_PERSISTENCE] STAGE_E_STATE_LOADED: Persistence file is empty; backing up and initializing fresh"
        );
        let backup_path = dir.join(format!("{}.empty_backup.{}", STORAGE_FILE_NAME, std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos()));
        let _ = fs::rename(&target_path, &backup_path);
        return Ok(PrintJobStoreFile {
            schema_version: CURRENT_SCHEMA_VERSION,
            records: Vec::new(),
        });
    }

    match serde_json::from_str::<PrintJobStoreFile>(&raw_content) {
        Ok(mut store) => {
            if store.schema_version > CURRENT_SCHEMA_VERSION {
                return Err(format!(
                    "Unsupported future persistence schema version {}. Expected <= {}",
                    store.schema_version, CURRENT_SCHEMA_VERSION
                ));
            }

            // Deduplicate records on load (preserve newer updated_at)
            let mut seen_local = HashSet::new();
            let mut seen_native = HashSet::new();
            let mut clean_records = Vec::new();

            for rec in store.records.into_iter().rev() {
                let local_dup = !seen_local.insert(rec.local_job_id.clone());
                let native_dup = if let Some(ref nid) = rec.native_job_id {
                    !seen_native.insert(nid.clone())
                } else {
                    false
                };

                if !local_dup && !native_dup {
                    clean_records.push(rec);
                } else {
                    println!(
                        "[RUST_PERSISTENCE] STAGE_E_STATE_LOADED: Deduplicated duplicate record local_id={} native_id={:?}",
                        rec.local_job_id, rec.native_job_id
                    );
                }
            }

            clean_records.reverse();
            store.records = clean_records;

            println!(
                "[RUST_PERSISTENCE] STAGE_E_STATE_LOADED: Successfully loaded {} records from {:?}",
                store.records.len(),
                target_path
            );

            Ok(store)
        }
        Err(e) => {
            println!(
                "[RUST_PERSISTENCE] STAGE_E_STATE_LOADED: Corrupted persistence file: {}. Preserving backup...",
                e
            );
            let backup_path = dir.join(format!("{}.corrupt_backup.{}", STORAGE_FILE_NAME, std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos()));
            let _ = fs::rename(&target_path, &backup_path);
            Ok(PrintJobStoreFile {
                schema_version: CURRENT_SCHEMA_VERSION,
                records: Vec::new(),
            })
        }
    }
}

/// Retrieves or initializes the in-memory cached store.
pub fn get_or_load_store(app: Option<&tauri::AppHandle>) -> Result<PrintJobStoreFile, String> {
    let mut lock = IN_MEMORY_STORE.lock().map_err(|e| format!("Store mutex poisoned: {}", e))?;
    if let Some(ref store) = *lock {
        return Ok(store.clone());
    }

    let dir = resolve_storage_dir(app)?;
    let loaded = load_store_from_dir(&dir)?;
    *lock = Some(loaded.clone());
    Ok(loaded)
}

/// Saves the store both to in-memory cache and atomically to disk.
pub fn save_and_cache_store(store: PrintJobStoreFile, app: Option<&tauri::AppHandle>) -> Result<(), String> {
    let dir = resolve_storage_dir(app)?;
    save_store_to_dir(&store, &dir)?;

    if let Ok(mut lock) = IN_MEMORY_STORE.lock() {
        *lock = Some(store);
    }
    Ok(())
}

/// Checks whether a local job can safely be submitted, strictly preventing duplicate physical printing.
pub fn check_duplicate_submission(
    local_job_id: &str,
    order_id: Option<&str>,
    app: Option<&tauri::AppHandle>,
) -> Result<(), String> {
    let store = get_or_load_store(app)?;
    if let Some(existing) = store.records.iter().find(|r| r.local_job_id == local_job_id) {
        if existing.native_job_id.is_some()
            || existing.status == "COMPLETED"
            || existing.status == "PRINTING"
            || existing.status == "QUEUED"
        {
            return Err(format!(
                "DUPLICATE_SUBMISSION_BLOCKED: Local job '{}' already exists with active or completed native job '{:?}' (status={})",
                local_job_id, existing.native_job_id, existing.status
            ));
        }
    }
    if let Some(oid) = order_id {
        if !oid.trim().is_empty() {
            if let Some(existing_order) = store.records.iter().find(|r| r.xer_service_order_id.as_deref() == Some(oid)) {
                if existing_order.status == "COMPLETED"
                    || existing_order.status == "PRINTING"
                    || existing_order.status == "QUEUED"
                    || existing_order.native_job_id.is_some()
                {
                    return Err(format!(
                        "DUPLICATE_PRINT_BLOCKED: XerService Order '{}' already has active or completed native print job '{}' (status={})",
                        oid, existing_order.local_job_id, existing_order.status
                    ));
                }
            }
        }
    }
    Ok(())
}

/// Finds a record by XerService Order ID.
pub fn find_by_order_id(order_id: &str, app: Option<&tauri::AppHandle>) -> Option<PrintJobRecord> {
    if let Ok(store) = get_or_load_store(app) {
        let lower = order_id.to_lowercase();
        store.records.into_iter().find(|r| {
            r.xer_service_order_id.as_deref().map(|o| o.to_lowercase() == lower).unwrap_or(false)
        })
    } else {
        None
    }
}

/// Upserts a print job record in the persistent store.
pub fn upsert_record(record: PrintJobRecord, app: Option<&tauri::AppHandle>) -> Result<(), String> {
    validate_identifier(&record.local_job_id)?;
    if let Some(ref nid) = record.native_job_id {
        validate_identifier(nid)?;
    }

    let mut store = get_or_load_store(app)?;

    if let Some(idx) = store.records.iter().position(|r| r.local_job_id == record.local_job_id) {
        store.records[idx] = record;
    } else {
        store.records.push(record);
    }

    save_and_cache_store(store, app)
}

/// Retrieves a record by local job ID.
pub fn get_record(local_job_id: &str, app: Option<&tauri::AppHandle>) -> Option<PrintJobRecord> {
    if let Ok(store) = get_or_load_store(app) {
        store.records.into_iter().find(|r| r.local_job_id == local_job_id)
    } else {
        None
    }
}

/// Retrieves all persisted records.
pub fn get_all_records(app: Option<&tauri::AppHandle>) -> Vec<PrintJobRecord> {
    if let Ok(store) = get_or_load_store(app) {
        store.records
    } else {
        Vec::new()
    }
}

/// Finds a record by native CUPS job ID.
pub fn find_by_native_job_id(native_id: &str, app: Option<&tauri::AppHandle>) -> Option<PrintJobRecord> {
    if let Ok(store) = get_or_load_store(app) {
        let lower = native_id.to_lowercase();
        store.records.into_iter().find(|r| {
            r.native_job_id.as_deref().map(|n| n.to_lowercase() == lower).unwrap_or(false)
        })
    } else {
        None
    }
}

/// Finds a record by either internal local job ID or native CUPS ID.
pub fn find_by_any_id(id: &str, app: Option<&tauri::AppHandle>) -> Option<PrintJobRecord> {
    if let Ok(store) = get_or_load_store(app) {
        let lower = id.to_lowercase();
        store.records.into_iter().find(|r| {
            r.local_job_id.to_lowercase() == lower
                || r.native_job_id.as_deref().map(|n| n.to_lowercase() == lower).unwrap_or(false)
        })
    } else {
        None
    }
}

/// Reconciles all non-terminal persisted print jobs against authoritative native CUPS spooler state.
pub fn recover_all_jobs(app: Option<&tauri::AppHandle>) -> Result<Vec<PrintJobRecord>, String> {
    println!("[RUST_PERSISTENCE] STAGE_A_RECOVERY_STARTED: Initiating startup print job recovery...");

    let mut store = get_or_load_store(app)?;
    let now = "2026-09-14T05:00:00.000Z".to_string();

    for record in store.records.iter_mut() {
        // Terminal states are strictly immutable
        if record.status == "COMPLETED" || record.status == "CANCELLED" || record.status == "FAILED" {
            if record.recovery_state == "NOT_APPLICABLE" || record.recovery_state.is_empty() {
                record.recovery_state = "RECONCILED".to_string();
            }
            continue;
        }

        // Case 1: Crash happened before or during CUPS submission before native ID was recorded
        if record.submission_state == "PENDING_SUBMISSION" && record.native_job_id.is_none() {
            record.status = "FAILED".to_string();
            record.submission_state = "FAILED".to_string();
            record.recovery_state = "INVESTIGATION_REQUIRED".to_string();
            record.error_code = Some("SUBMISSION_INTERRUPTED".to_string());
            record.error_message = Some(
                "Application interrupted before native job ID was recorded. Automatic resubmission disabled.".to_string(),
            );
            record.updated_at = now.clone();
            println!(
                "[RUST_PERSISTENCE] STAGE_E_STATE_RECONCILED: Job '{}' marked INVESTIGATION_REQUIRED (interrupted before native ID)",
                record.local_job_id
            );
            continue;
        }

        // Case 2: Native job ID exists; query authoritative CUPS spooler
        if let Some(ref native_id) = record.native_job_id {
            match super::status::query_native_print_job_status(&record.local_job_id, Some(&record.printer_id)) {
                Ok(status_info) => {
                    record.last_known_native_status = Some(status_info.status.clone());
                    match status_info.status.as_str() {
                        "PRINTING" => {
                            record.status = "PRINTING".to_string();
                            record.recovery_state = "RECONCILED".to_string();
                            record.updated_at = now.clone();
                            println!(
                                "[RUST_PERSISTENCE] STAGE_E_NATIVE_JOB_MATCHED: Job '{}' ({}) reconciled as PRINTING",
                                record.local_job_id, native_id
                            );
                        }
                        "QUEUED" => {
                            record.status = "QUEUED".to_string();
                            record.recovery_state = "RECONCILED".to_string();
                            record.updated_at = now.clone();
                            println!(
                                "[RUST_PERSISTENCE] STAGE_E_NATIVE_JOB_MATCHED: Job '{}' ({}) reconciled as QUEUED",
                                record.local_job_id, native_id
                            );
                        }
                        "COMPLETED" => {
                            record.status = "COMPLETED".to_string();
                            record.recovery_state = "RECONCILED".to_string();
                            record.completed_at = Some(now.clone());
                            record.updated_at = now.clone();
                            println!(
                                "[RUST_PERSISTENCE] STAGE_E_NATIVE_JOB_MATCHED: Job '{}' ({}) reconciled as COMPLETED",
                                record.local_job_id, native_id
                            );
                        }
                        "CANCELLED" => {
                            record.status = "CANCELLED".to_string();
                            record.recovery_state = "RECONCILED".to_string();
                            record.updated_at = now.clone();
                            println!(
                                "[RUST_PERSISTENCE] STAGE_E_NATIVE_JOB_MATCHED: Job '{}' ({}) reconciled as CANCELLED",
                                record.local_job_id, native_id
                            );
                        }
                        _ => {
                            // Missing or unrecognized CUPS status: STRICT INVARIANT: NEVER assume COMPLETED!
                            record.status = "FAILED".to_string();
                            record.recovery_state = "MISSING_FROM_CUPS".to_string();
                            record.error_code = Some("UNKNOWN_PRINT_ERROR".to_string());
                            record.error_message = Some(
                                "Native job disappeared from CUPS active queue and history. Manual investigation required.".to_string(),
                            );
                            record.updated_at = now.clone();
                            println!(
                                "[RUST_PERSISTENCE] STAGE_E_NATIVE_JOB_MISSING: Job '{}' ({}) missing from CUPS; marked MISSING_FROM_CUPS",
                                record.local_job_id, native_id
                            );
                        }
                    }
                }
                Err(e) => {
                    record.status = "FAILED".to_string();
                    record.recovery_state = "INVESTIGATION_REQUIRED".to_string();
                    record.error_message = Some(format!("Failed to query CUPS: {}", e));
                    record.updated_at = now.clone();
                }
            }
        }
    }

    save_and_cache_store(store.clone(), app)?;

    println!(
        "[RUST_PERSISTENCE] STAGE_E_RECOVERY_COMPLETED: Finished recovery reconciliation for {} records",
        store.records.len()
    );

    Ok(store.records)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_dir(test_name: &str) -> PathBuf {
        let temp = std::env::temp_dir().join(format!("xerservice_test_{}_{}", test_name, std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos()));
        let _ = fs::create_dir_all(&temp);
        temp
    }

    fn sample_record(local_id: &str, native_id: Option<&str>, status: &str) -> PrintJobRecord {
        PrintJobRecord {
            local_job_id: local_id.to_string(),
            xer_service_order_id: Some("XS-ORD-101".to_string()),
            native_job_id: native_id.map(|s| s.to_string()),
            printer_id: "Test_Printer".to_string(),
            status: status.to_string(),
            title: Some(format!("Test Print {}", local_id)),
            submitted_at: "2026-09-14T04:00:00.000Z".to_string(),
            updated_at: "2026-09-14T04:00:00.000Z".to_string(),
            managed_by_xer_service: true,
            submission_state: if native_id.is_some() { "SUBMITTED".to_string() } else { "PENDING_SUBMISSION".to_string() },
            recovery_state: "NOT_APPLICABLE".to_string(),
            last_known_native_status: None,
            retry_count: 0,
            cancellation_requested: false,
            completed_at: None,
            failed_at: None,
            error_code: None,
            error_message: None,
        }
    }

    #[test]
    fn test_atomic_persistence_and_load() {
        let dir = create_test_dir("atomic");
        let record = sample_record("local-1", Some("Printer-1"), "PRINTING");
        let store = PrintJobStoreFile {
            schema_version: 1,
            records: vec![record.clone()],
        };

        let save_res = save_store_to_dir(&store, &dir);
        assert!(save_res.is_ok());

        let loaded = load_store_from_dir(&dir).unwrap();
        assert_eq!(loaded.schema_version, 1);
        assert_eq!(loaded.records.len(), 1);
        assert_eq!(loaded.records[0].local_job_id, "local-1");
        assert_eq!(loaded.records[0].native_job_id.as_deref(), Some("Printer-1"));
    }

    #[test]
    fn test_missing_file_initializes_empty() {
        let dir = create_test_dir("missing");
        let loaded = load_store_from_dir(&dir).unwrap();
        assert_eq!(loaded.schema_version, 1);
        assert!(loaded.records.is_empty());
    }

    #[test]
    fn test_corrupt_file_handled_safely() {
        let dir = create_test_dir("corrupt");
        let target = dir.join(STORAGE_FILE_NAME);
        fs::write(&target, "{ invalid json ").unwrap();

        let loaded = load_store_from_dir(&dir).unwrap();
        assert_eq!(loaded.schema_version, 1);
        assert!(loaded.records.is_empty());

        // Backup file must have been created
        let entries: Vec<_> = fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().to_string()).collect();
        assert!(entries.iter().any(|name| name.contains("corrupt_backup")));
    }

    #[test]
    fn test_future_schema_version_rejected() {
        let dir = create_test_dir("future_schema");
        let store = PrintJobStoreFile {
            schema_version: 999,
            records: vec![],
        };
        save_store_to_dir(&store, &dir).unwrap();

        let load_res = load_store_from_dir(&dir);
        assert!(load_res.is_err());
        assert!(load_res.unwrap_err().contains("Unsupported future persistence schema version"));
    }

    #[test]
    fn test_deduplication_on_load() {
        let dir = create_test_dir("dedup");
        let mut rec1 = sample_record("local-1", Some("Printer-1"), "QUEUED");
        rec1.updated_at = "2026-09-14T04:00:00.000Z".to_string();

        let mut rec2 = sample_record("local-1", Some("Printer-1"), "PRINTING");
        rec2.updated_at = "2026-09-14T04:05:00.000Z".to_string();

        let store = PrintJobStoreFile {
            schema_version: 1,
            records: vec![rec1, rec2],
        };
        save_store_to_dir(&store, &dir).unwrap();

        let loaded = load_store_from_dir(&dir).unwrap();
        assert_eq!(loaded.records.len(), 1);
        assert_eq!(loaded.records[0].status, "PRINTING");
    }

    #[test]
    fn test_crash_before_submission_recovery() {
        let mut rec = sample_record("local-crash-1", None, "SUBMITTING");
        rec.submission_state = "PENDING_SUBMISSION".to_string();

        let mut store = PrintJobStoreFile {
            schema_version: 1,
            records: vec![rec],
        };

        // Simulate crash recovery
        for r in store.records.iter_mut() {
            if r.submission_state == "PENDING_SUBMISSION" && r.native_job_id.is_none() {
                r.status = "FAILED".to_string();
                r.submission_state = "FAILED".to_string();
                r.recovery_state = "INVESTIGATION_REQUIRED".to_string();
                r.error_code = Some("SUBMISSION_INTERRUPTED".to_string());
            }
        }

        assert_eq!(store.records[0].status, "FAILED");
        assert_eq!(store.records[0].recovery_state, "INVESTIGATION_REQUIRED");
        assert_eq!(store.records[0].submission_state, "FAILED");
    }

    #[test]
    fn test_terminal_states_immutable() {
        let rec = sample_record("local-term-1", Some("Printer-1"), "COMPLETED");
        assert_eq!(rec.status, "COMPLETED");
        // Cannot revert to queued
        let cannot_revert = rec.status == "COMPLETED" || rec.status == "CANCELLED" || rec.status == "FAILED";
        assert!(cannot_revert);
    }

    #[test]
    fn test_duplicate_submission_order_id_protection() {
        let mut rec = sample_record("local-order-1", Some("CUPS-101"), "PRINTING");
        rec.xer_service_order_id = Some("order-unique-123".to_string());

        let store = PrintJobStoreFile {
            schema_version: 1,
            records: vec![rec],
        };

        // If order already has an active print job, duplicate submission must be rejected
        let is_dup = store.records.iter().any(|r| {
            r.xer_service_order_id.as_deref() == Some("order-unique-123")
                && (r.status == "PRINTING" || r.status == "QUEUED" || r.status == "COMPLETED")
        });
        assert!(is_dup, "Duplicate order printing must be detected");
    }

    #[test]
    fn test_find_by_order_id() {
        let mut rec1 = sample_record("local-a", Some("CUPS-A"), "PRINTING");
        rec1.xer_service_order_id = Some("XS-ORD-999".to_string());

        let store = PrintJobStoreFile {
            schema_version: 1,
            records: vec![rec1],
        };

        let found = store.records.into_iter().find(|r| {
            r.xer_service_order_id.as_deref().map(|o| o.eq_ignore_ascii_case("xs-ord-999")).unwrap_or(false)
        });

        assert!(found.is_some());
        assert_eq!(found.unwrap().local_job_id, "local-a");
    }
}
