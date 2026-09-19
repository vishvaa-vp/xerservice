//! Printer and Platform Capabilities Module
//!
//! Strongly-typed models strictly aligned with @packages/printing contracts.
//! Enforces strict truthfulness: absence of information is NEVER fabricated as a capability.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterCapabilities {
    pub supported_paper_sizes: Vec<String>,
    pub color_supported: Option<bool>,
    pub duplex_supported: Option<bool>,
    pub supported_orientations: Vec<String>,
    pub supported_media_types: Option<Vec<String>>,
    pub max_copies: Option<u32>,
    pub trays: Option<Vec<String>>,
    pub max_resolution_dpi: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedPrinter {
    pub printer_id: String,
    pub name: String,
    pub status: String,
    pub is_default: bool,
    pub capabilities: PrinterCapabilities,
    pub description: Option<String>,
    pub connection_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformPrintingCapabilitiesResponse {
    pub supports_silent_printing: bool,
    pub supports_job_cancellation: bool,
    pub supports_status_polling: bool,
    pub platform: String,
    pub native_adapter_status: String,
    pub message: String,
}

/// Detects real capabilities for an installed printer by querying OS printing options.
/// Strictly does NOT fabricate capabilities when data is unavailable.
pub fn detect_printer_capabilities(printer_name: &str) -> PrinterCapabilities {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        use std::process::Command;

        let lpoptions_bin = if std::path::Path::new("/usr/bin/lpoptions").exists() {
            "/usr/bin/lpoptions"
        } else {
            "lpoptions"
        };

        // Run `lpoptions -p <printer_name> -l`
        let output = Command::new(lpoptions_bin)
            .arg("-p")
            .arg(printer_name)
            .arg("-l")
            .output();

        if let Ok(out) = output {
            if out.status.success() {
                let stdout = String::from_utf8_lossy(&out.stdout);
                return parse_cups_ppd_options(&stdout);
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;

        // Escape single quotes for PowerShell filter
        let escaped_name = printer_name.replace('\'', "''");
        let ps_cmd = format!(
            "Get-CimInstance Win32_Printer -Filter \"Name = '{}'\" | Select-Object CapabilityDescriptions, Duplex, Color | ConvertTo-Json -Compress",
            escaped_name
        );

        if let Ok(output) = Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &ps_cmd])
            .output()
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !stdout.is_empty() && stdout != "null" {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&stdout) {
                        let color_supported = parsed.get("Color").and_then(|v| v.as_bool());
                        let duplex_supported = parsed.get("Duplex").and_then(|v| v.as_bool());

                        let mut paper_sizes = Vec::new();
                        if let Some(arr) = parsed.get("CapabilityDescriptions").and_then(|v| v.as_array()) {
                            for item in arr {
                                if let Some(s) = item.as_str() {
                                    let lower = s.to_lowercase();
                                    if lower.contains("a4") && !paper_sizes.contains(&"a4".to_string()) {
                                        paper_sizes.push("a4".to_string());
                                    } else if lower.contains("a3") && !paper_sizes.contains(&"a3".to_string()) {
                                        paper_sizes.push("a3".to_string());
                                    } else if lower.contains("legal") && !paper_sizes.contains(&"legal".to_string()) {
                                        paper_sizes.push("legal".to_string());
                                    } else if lower.contains("letter") && !paper_sizes.contains(&"letter".to_string()) {
                                        paper_sizes.push("letter".to_string());
                                    }
                                }
                            }
                        }

                        return PrinterCapabilities {
                            supported_paper_sizes: paper_sizes,
                            color_supported,
                            duplex_supported,
                            supported_orientations: Vec::new(),
                            supported_media_types: None,
                            max_copies: None,
                            trays: None,
                            max_resolution_dpi: None,
                        };
                    }
                }
            }
        }
    }

    // Default: Return empty/unknown capabilities when CUPS is unavailable or lpoptions fails.
    // ABSOLUTELY ZERO FABRICATED CAPABILITIES.
    PrinterCapabilities {
        supported_paper_sizes: Vec::new(),
        color_supported: None,
        duplex_supported: None,
        supported_orientations: Vec::new(),
        supported_media_types: None,
        max_copies: None,
        trays: None,
        max_resolution_dpi: None,
    }
}

/// Parses standard CUPS PPD option output from `lpoptions -l`.
/// Strictly preserves the distinction between SUPPORTED, UNSUPPORTED, and UNKNOWN.
pub fn parse_cups_ppd_options(output: &str) -> PrinterCapabilities {
    let mut paper_sizes = Vec::new();
    let mut color_supported: Option<bool> = None;
    let mut duplex_supported: Option<bool> = None;
    let supported_orientations = Vec::new();
    let mut trays = Vec::new();

    for line in output.lines() {
        let (key_part, val_part) = match line.split_once(':') {
            Some((k, v)) => (k.trim().to_lowercase(), v.trim().to_lowercase()),
            None => continue,
        };

        // 1. Page sizes: Only record sizes explicitly declared by CUPS PPD
        if key_part.starts_with("pagesize") || key_part.starts_with("mediasize") {
            for token in val_part.split_whitespace() {
                let cleaned = token.trim_start_matches('*');
                if (cleaned == "a4" || cleaned.starts_with("a4")) && !paper_sizes.contains(&"a4".to_string()) {
                    paper_sizes.push("a4".to_string());
                } else if (cleaned == "a3" || cleaned.starts_with("a3")) && !paper_sizes.contains(&"a3".to_string()) {
                    paper_sizes.push("a3".to_string());
                } else if (cleaned == "legal" || cleaned.starts_with("legal")) && !paper_sizes.contains(&"legal".to_string()) {
                    paper_sizes.push("legal".to_string());
                } else if (cleaned == "letter" || cleaned.starts_with("letter")) && !paper_sizes.contains(&"letter".to_string()) {
                    paper_sizes.push("letter".to_string());
                }
            }
        }

        // 2. Duplex: Distinguish SUPPORTED vs UNSUPPORTED vs UNKNOWN
        if key_part.starts_with("duplex") || key_part.contains("two-sided") || key_part.contains("2-sided") {
            let tokens: Vec<&str> = val_part.split_whitespace().map(|t| t.trim_start_matches('*')).collect();
            let has_duplex = tokens.iter().any(|t| *t == "duplexnotumble" || *t == "duplextumble" || *t == "two-sided" || *t == "twosidedlongedge" || *t == "twosidedshortedge" || t.contains("duplex"));
            let has_simplex = tokens.iter().any(|t| *t == "none" || *t == "simplex" || *t == "one-sided" || *t == "onesided");
            if has_duplex {
                duplex_supported = Some(true);
            } else if has_simplex {
                if duplex_supported.is_none() {
                    duplex_supported = Some(false);
                }
            }
        }

        // 3. Color: Distinguish SUPPORTED vs UNSUPPORTED vs UNKNOWN
        if key_part.starts_with("colormodel") || key_part.starts_with("color/") || key_part.starts_with("colormode") || key_part.starts_with("printcolormode") {
            let tokens: Vec<&str> = val_part.split_whitespace().map(|t| t.trim_start_matches('*')).collect();
            let has_color = tokens.iter().any(|t| *t == "cmyk" || *t == "rgb" || *t == "color" || *t == "colour" || *t == "cmy");
            let has_mono = tokens.iter().any(|t| *t == "gray" || *t == "grayscale" || *t == "monochrome" || *t == "black" || *t == "k" || *t == "mono");
            if has_color {
                color_supported = Some(true);
            } else if has_mono {
                if color_supported.is_none() {
                    color_supported = Some(false);
                }
            }
        }

        // 4. Trays / InputSlot
        if key_part.starts_with("inputslot") {
            if let Some(colon_idx) = line.find(':') {
                let options_str = &line[colon_idx + 1..];
                for token in options_str.split_whitespace() {
                    let cleaned = token.trim_start_matches('*');
                    if !cleaned.is_empty() && !trays.contains(&cleaned.to_string()) {
                        trays.push(cleaned.to_string());
                    }
                }
            }
        }
    }

    // STRICT INVARIANT: ZERO FABRICATED FALLBACKS
    // - No paper_sizes fallback to A4
    // - No supported_orientations fallback to portrait/landscape
    // - No max_copies fallback to 99
    // - No color_supported fallback to false
    // - No duplex_supported fallback to false

    PrinterCapabilities {
        supported_paper_sizes: paper_sizes,
        color_supported,
        duplex_supported,
        supported_orientations,
        supported_media_types: None,
        max_copies: None,
        trays: if trays.is_empty() { None } else { Some(trays) },
        max_resolution_dpi: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_no_cups_data_no_fabricated_fallbacks() {
        let caps = parse_cups_ppd_options("");
        // A. No CUPS capability data -> no fabricated A4
        assert!(caps.supported_paper_sizes.is_empty(), "Paper sizes must be empty without CUPS data");
        // B. No CUPS capability data -> no fabricated portrait/landscape
        assert!(caps.supported_orientations.is_empty(), "Orientations must be empty without CUPS data");
        // C. No CUPS capability data -> no max_copies=99 fallback
        assert!(caps.max_copies.is_none(), "maxCopies must be None (unknown) without CUPS data");
        // D. Missing color capability -> not automatically interpreted as black-and-white-only
        assert!(caps.color_supported.is_none(), "color_supported must be None (unknown) without CUPS data");
        // E. Missing duplex capability -> not automatically interpreted as unsupported
        assert!(caps.duplex_supported.is_none(), "duplex_supported must be None (unknown) without CUPS data");
    }

    #[test]
    fn test_lpoptions_failure_returns_empty_and_unknown() {
        // F. CUPS failure -> no fake capability data
        let caps = detect_printer_capabilities("non_existent_destination_for_test");
        assert!(caps.supported_paper_sizes.is_empty());
        assert!(caps.supported_orientations.is_empty());
        assert!(caps.max_copies.is_none());
        assert!(caps.color_supported.is_none());
        assert!(caps.duplex_supported.is_none());
    }

    #[test]
    fn test_real_cups_capability_values_preserved() {
        // G. Real CUPS capability values are preserved when available
        let ppd_sample = "\
PageSize/Media Size: *A4 A3 Legal Custom.WIDTHxHEIGHT\n\
Duplex/2-Sided Printing: None *DuplexNoTumble DuplexTumble\n\
ColorModel/Color Mode: *CMYK RGB Gray\n\
InputSlot/Media Source: *Default Upper Lower\n";

        let caps = parse_cups_ppd_options(ppd_sample);
        assert_eq!(caps.supported_paper_sizes, vec!["a4", "a3", "legal"]);
        assert_eq!(caps.color_supported, Some(true));
        assert_eq!(caps.duplex_supported, Some(true));
        assert_eq!(caps.trays, Some(vec!["Default".to_string(), "Upper".to_string(), "Lower".to_string()]));
    }

    #[test]
    fn test_explicit_unsupported_capabilities() {
        let ppd_mono = "ColorModel/Color Mode: *Gray\nDuplex/2-Sided: *None\n";
        let caps = parse_cups_ppd_options(ppd_mono);
        assert_eq!(caps.color_supported, Some(false));
        assert_eq!(caps.duplex_supported, Some(false));
    }
}
