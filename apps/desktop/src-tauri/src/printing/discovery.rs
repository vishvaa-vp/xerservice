//! OS-Level Printer Discovery Module
//!
//! Queries macOS CUPS subsystem to enumerate installed printers and their statuses.
//! Strictly does NOT fabricate or mock printers.

use super::capabilities::{detect_printer_capabilities, NormalizedPrinter};
use super::errors::NativePrintAdapterError;
use std::collections::HashMap;

/// Discovers installed printers on the host system.
pub fn discover_installed_printers() -> Result<Vec<NormalizedPrinter>, NativePrintAdapterError> {
    #[cfg(target_os = "macos")]
    {
        discover_macos_printers()
    }

    #[cfg(not(target_os = "macos"))]
    {
        // Safe cross-platform fallback for future Linux/Windows implementations
        Err(NativePrintAdapterError::UnsupportedPlatform(
            std::env::consts::OS.to_string(),
        ))
    }
}

#[cfg(target_os = "macos")]
fn discover_macos_printers() -> Result<Vec<NormalizedPrinter>, NativePrintAdapterError> {
    use std::process::Command;

    // 1. Get system default destination
    let default_output = Command::new("/usr/bin/lpstat")
        .arg("-d")
        .output()
        .map_err(|e| NativePrintAdapterError::OsCommandFailed(format!("lpstat -d failed: {}", e)))?;

    let default_stdout = String::from_utf8_lossy(&default_output.stdout);
    let default_printer_name = parse_default_printer(&default_stdout);

    // 2. Get device URIs to classify connection types
    let mut connection_map: HashMap<String, (String, Option<String>)> = HashMap::new();
    if let Ok(device_out) = Command::new("/usr/bin/lpstat").arg("-v").output() {
        if device_out.status.success() {
            let device_stdout = String::from_utf8_lossy(&device_out.stdout);
            for line in device_stdout.lines() {
                // Format: "device for <name>: <uri>"
                if let Some(colon_idx) = line.find(':') {
                    let prefix = &line[..colon_idx];
                    let uri = line[colon_idx + 1..].trim();
                    if let Some(for_idx) = prefix.find("for ") {
                        let name = prefix[for_idx + 4..].trim().to_string();
                        let conn_type = if uri.starts_with("usb://") {
                            Some("usb".to_string())
                        } else if uri.starts_with("ipp://")
                            || uri.starts_with("ipps://")
                            || uri.starts_with("socket://")
                            || uri.starts_with("lpd://")
                            || uri.starts_with("dnssd://")
                        {
                            Some("network".to_string())
                        } else if uri.starts_with("file://") || uri.contains("pdf") {
                            Some("virtual".to_string())
                        } else {
                            None
                        };
                        connection_map.insert(name, (uri.to_string(), conn_type));
                    }
                }
            }
        }
    }

    // 3. Enumerate printer names and statuses
    let p_output = Command::new("/usr/bin/lpstat")
        .arg("-p")
        .output()
        .map_err(|e| NativePrintAdapterError::OsCommandFailed(format!("lpstat -p failed: {}", e)))?;

    let p_stdout = String::from_utf8_lossy(&p_output.stdout);
    let p_stderr = String::from_utf8_lossy(&p_output.stderr);

    // Check for "No destinations added" or empty
    if p_stdout.contains("No destinations added") || p_stderr.contains("No destinations added") {
        return Ok(Vec::new());
    }

    let mut printers = Vec::new();

    for line in p_stdout.lines() {
        let trimmed = line.trim();
        // Format: "printer <name> is idle. enabled since ..."
        // Format: "printer <name> is printing ..."
        // Format: "printer <name> disabled since ..."
        if trimmed.starts_with("printer ") {
            let parts: Vec<&str> = trimmed.split_whitespace().collect();
            if parts.len() >= 2 {
                let name = parts[1].to_string();
                let is_default = default_printer_name.as_ref() == Some(&name);

                let status = if trimmed.contains("idle") {
                    "idle".to_string()
                } else if trimmed.contains("printing") || trimmed.contains("busy") {
                    "busy".to_string()
                } else if trimmed.contains("disabled") || trimmed.contains("offline") {
                    "offline".to_string()
                } else {
                    "idle".to_string()
                };

                let conn_info = connection_map.get(&name);
                let connection_type = conn_info.and_then(|(_, c)| c.clone());
                let description = conn_info.map(|(u, _)| format!("CUPS Device: {}", u));

                let capabilities = detect_printer_capabilities(&name);

                printers.push(NormalizedPrinter {
                    printer_id: name.clone(),
                    name: name.clone(),
                    status,
                    is_default,
                    capabilities,
                    description,
                    connection_type,
                });
            }
        }
    }

    Ok(printers)
}

/// Helper to extract default printer from `lpstat -d`
fn parse_default_printer(output: &str) -> Option<String> {
    // Expected: "system default destination: PrinterName"
    for line in output.lines() {
        if line.contains("system default destination:") {
            let parts: Vec<&str> = line.split(':').collect();
            if parts.len() >= 2 {
                let default_name = parts[1].trim();
                if !default_name.is_empty() && default_name != "no system default destination" {
                    return Some(default_name.to_string());
                }
            }
        }
    }
    None
}
