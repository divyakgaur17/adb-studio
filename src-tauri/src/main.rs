#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::Emitter;

struct LogcatState(Mutex<Option<Child>>);

use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Clone)]
struct FileEntry {
    name: String,
    is_dir: bool,
    permissions: String,
    size: String,
}

fn get_adb_path() -> String {
    if let Ok(home) = std::env::var("HOME") {
        let mac_sdk = format!("{}/Library/Android/sdk/platform-tools/adb", home);
        if std::path::Path::new(&mac_sdk).exists() {
            return mac_sdk;
        }
        let linux_sdk = format!("{}/Android/Sdk/platform-tools/adb", home);
        if std::path::Path::new(&linux_sdk).exists() {
            return linux_sdk;
        }
    }
    "adb".to_string()
}

// Helper to run adb with optional device selector
fn adb_cmd(device_id: Option<&str>) -> Command {
    let mut cmd = Command::new(get_adb_path());
    if let Some(dev) = device_id {
        cmd.args(["-s", dev]);
    }
    cmd
}

#[tauri::command]
fn get_devices() -> Result<String, String> {
    match Command::new(get_adb_path()).arg("devices").output() {
        Ok(output) => Ok(String::from_utf8_lossy(&output.stdout).to_string()),
        Err(e) => Err(format!("Failed to execute adb: {}. Ensure adb is in your PATH.", e)),
    }
}

#[tauri::command]
fn build_apk(app_handle: tauri::AppHandle, project_path: String, build_type: String) {
    std::thread::spawn(move || {
        let gradle_cmd = if build_type == "release" {
            "./gradlew assembleRelease"
        } else {
            "./gradlew assembleDebug"
        };
        
        let _ = app_handle.emit("build_log", format!("> Running {} in {}...", gradle_cmd, project_path));

        let mut child = match Command::new("sh")
            .arg("-c")
            .arg(format!("cd {} && {} 2>&1", project_path, gradle_cmd))
            .stdout(Stdio::piped())
            .spawn() {
            Ok(c) => c,
            Err(e) => {
                let _ = app_handle.emit("build_log", format!("Failed to spawn shell: {}", e));
                let _ = app_handle.emit("build_done", "Failed");
                return;
            }
        };

        let stdout = child.stdout.take().unwrap();
        let reader = BufReader::new(stdout);

        for line in reader.lines() {
            if let Ok(log) = line {
                let _ = app_handle.emit("build_log", log);
            }
        }

        if let Ok(status) = child.wait() {
            if status.success() {
                let _ = app_handle.emit("build_done", "Success");
            } else {
                let _ = app_handle.emit("build_done", "Failed");
            }
        } else {
            let _ = app_handle.emit("build_done", "Failed");
        }
    });
}

fn find_apks_recursive(dir: std::path::PathBuf) -> Vec<String> {
    let mut apks = Vec::new();
    let mut dirs_to_visit = vec![dir];

    while let Some(current_dir) = dirs_to_visit.pop() {
        if let Ok(entries) = std::fs::read_dir(current_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    dirs_to_visit.push(path);
                } else if path.extension().and_then(|s| s.to_str()) == Some("apk") {
                    apks.push(path.to_string_lossy().to_string());
                }
            }
        }
    }
    apks
}

#[tauri::command]
fn scan_apks(project_path: String) -> Vec<String> {
    let apk_dir = std::path::PathBuf::from(format!("{}/app/build/outputs/apk", project_path));
    find_apks_recursive(apk_dir)
}

#[tauri::command]
fn adb_connect(ip: String) -> Result<String, String> {
    let output = Command::new(get_adb_path())
        .args(["connect", &ip])
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
fn install_apk(apk_path: String, device_id: Option<String>) -> Result<String, String> {
    let mut cmd = Command::new(get_adb_path());
    if let Some(dev) = device_id {
        cmd.args(["-s", &dev]);
    }
    cmd.args(["install", "-r", "-t", &apk_path]);

    let output = cmd.output().map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
fn save_logs(logs: String, path: String) -> Result<String, String> {
    std::fs::write(&path, logs).map_err(|e| e.to_string())?;
    Ok("Logs saved successfully".to_string())
}

#[tauri::command]
fn start_logcat(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, LogcatState>,
    device_id: Option<String>,
) {
    // Kill existing logcat process first
    let mut current_child = state.0.lock().unwrap();
    if let Some(mut child) = current_child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }

    let mut cmd = Command::new(get_adb_path());
    if let Some(ref dev) = device_id {
        cmd.args(["-s", dev]);
    }
    cmd.args(["logcat", "-v", "time"]);

    let mut child = match cmd.stdout(Stdio::piped()).spawn() {
        Ok(c) => c,
        Err(e) => {
            let _ = app_handle.emit("logcat", format!("Error starting adb: {}. Ensure adb is accessible in system PATH.", e));
            return;
        }
    };

    let stdout = child.stdout.take().unwrap();
    *current_child = Some(child);

    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);

        for line in reader.lines() {
            if let Ok(log) = line {
                let _ = app_handle.emit("logcat", log);
            }
        }
    });
}

#[tauri::command]
fn stop_logcat(state: tauri::State<'_, LogcatState>) {
    let mut current_child = state.0.lock().unwrap();
    if let Some(mut child) = current_child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[tauri::command]
fn get_package_name(project_path: String) -> Result<String, String> {
    let gradle_paths = vec![
        format!("{}/app/build.gradle", project_path),
        format!("{}/app/build.gradle.kts", project_path),
    ];

    for path in gradle_paths {
        if let Ok(content) = std::fs::read_to_string(&path) {
            for line in content.lines() {
                if line.contains("applicationId") {
                    let mut id = String::new();
                    let mut in_quotes = false;
                    for c in line.chars() {
                        if c == '"' || c == '\'' {
                            if in_quotes {
                                return Ok(id);
                            } else {
                                in_quotes = true;
                            }
                        } else if in_quotes {
                            id.push(c);
                        }
                    }
                }
            }
        }
    }

    let manifest_path = format!("{}/app/src/main/AndroidManifest.xml", project_path);
    if let Ok(content) = std::fs::read_to_string(&manifest_path) {
        for line in content.lines() {
            if line.contains("package=") {
                let mut id = String::new();
                let mut in_quotes = false;
                for c in line.chars() {
                    if c == '"' || c == '\'' {
                        if in_quotes {
                            return Ok(id);
                        } else {
                            in_quotes = true;
                        }
                    } else if in_quotes {
                        id.push(c);
                    }
                }
            }
        }
    }

    Err("Package name not found".to_string())
}

#[tauri::command]
fn check_file_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[tauri::command]
async fn install_apk_multiple(apk_path: String, device_ids: Vec<String>) -> Result<String, String> {
    if device_ids.is_empty() {
        return Err("No devices selected".to_string());
    }
    
    let mut outputs = Vec::new();

    for dev in device_ids {
        let mut cmd = Command::new(get_adb_path());
        cmd.args(["-s", &dev, "install", "-r", "-t", &apk_path]);

        match cmd.output() {
            Ok(output) => {
                if output.status.success() {
                    outputs.push(format!("[{}] Success: {}", dev, String::from_utf8_lossy(&output.stdout)));
                } else {
                    outputs.push(format!("[{}] Error: {}", dev, String::from_utf8_lossy(&output.stderr)));
                }
            }
            Err(e) => {
                outputs.push(format!("[{}] Failed to execute: {}", dev, e));
            }
        }
    }

    Ok(outputs.join("\n\n"))
}

#[tauri::command]
async fn uninstall_apk(package_name: String, device_ids: Vec<String>) -> Result<String, String> {
    if device_ids.is_empty() {
        return Err("No devices selected".to_string());
    }
    
    let mut outputs = Vec::new();
    for dev in device_ids {
        let mut cmd = Command::new(get_adb_path());
        cmd.args(["-s", &dev, "uninstall", &package_name]);
        match cmd.output() {
            Ok(output) => {
                let msg = String::from_utf8_lossy(&output.stdout).to_string();
                outputs.push(format!("[{}] Uninstall {}: {}", dev, package_name, msg.trim()));
            }
            Err(e) => {
                outputs.push(format!("[{}] Failed to uninstall: {}", dev, e));
            }
        }
    }

    Ok(outputs.join("\n\n"))
}

#[tauri::command]
async fn auto_connect_wireless() -> Result<String, String> {
    let output = Command::new(get_adb_path())
        .args(["mdns", "services"])
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut outputs = Vec::new();

    for line in stdout.lines() {
        if line.contains("List of discovered mdns services") || line.trim().is_empty() || line.starts_with('*') {
            continue;
        }
        
        let parts: Vec<&str> = line.split_whitespace().collect();
        for part in parts {
            if part.contains(':') && part.chars().any(|c| c.is_digit(10)) && part.contains('.') {
                let connect_cmd = Command::new(get_adb_path())
                    .args(["connect", part])
                    .output();
                
                if let Ok(out) = connect_cmd {
                    outputs.push(format!("Tried connecting to {}: {}", part, String::from_utf8_lossy(&out.stdout).trim()));
                }
            }
        }
    }

    if outputs.is_empty() {
         Ok("No wireless devices discovered via Android mDNS on your local network.".to_string())
    } else {
         Ok(outputs.join("\n"))
    }
}

#[tauri::command]
fn start_scrcpy(device_id: Option<String>) -> Result<String, String> {
    #[allow(unused_mut)]
    let mut scrcpy_path = "scrcpy".to_string();

    #[cfg(target_os = "macos")]
    {
        if std::path::Path::new("/opt/homebrew/bin/scrcpy").exists() {
            scrcpy_path = "/opt/homebrew/bin/scrcpy".to_string();
        } else if std::path::Path::new("/usr/local/bin/scrcpy").exists() {
            scrcpy_path = "/usr/local/bin/scrcpy".to_string();
        } else if std::path::Path::new("/opt/local/bin/scrcpy").exists() {
            scrcpy_path = "/opt/local/bin/scrcpy".to_string();
        }
    }

    let mut cmd = Command::new(&scrcpy_path);
    
    #[cfg(target_os = "macos")]
    if let Ok(path) = std::env::var("PATH") {
        let adb_dir = {
            if let Ok(home) = std::env::var("HOME") {
                format!("{}/Library/Android/sdk/platform-tools", home)
            } else {
                "".to_string()
            }
        };
        cmd.env("PATH", format!("/opt/homebrew/bin:/usr/local/bin:/opt/local/bin:{}:{}", adb_dir, path));
    }

    if let Some(ref dev) = device_id {
        if !dev.is_empty() {
            cmd.args(["-s", dev]);
        }
    }

    // Detach the process so it doesn't block
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::piped());

    match cmd.spawn() {
        Ok(_) => Ok("scrcpy started successfully.".to_string()),
        Err(e) => Err(format!("Failed to start scrcpy: {}. Please ensure scrcpy is installed.", e)),
    }
}

#[tauri::command]
fn install_scrcpy(app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        let _ = app_handle.emit("build_log", ">> Starting scrcpy installation...");

        #[cfg(target_os = "macos")]
        let cmd_str = "export PATH=\"/opt/homebrew/bin:/usr/local/bin:$PATH\" && brew install scrcpy";
        #[cfg(target_os = "linux")]
        let cmd_str = "sudo apt-get update && sudo apt-get install -y scrcpy";
        #[cfg(target_os = "windows")]
        let cmd_str = "winget install Genymobile.scrcpy";
        
        #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
        let cmd_str = "echo Unsupported OS for automatic installation";

        let _ = app_handle.emit("build_log", format!("> Running: {}", cmd_str));

        let mut cmd = if cfg!(target_os = "windows") {
            Command::new("cmd")
        } else {
            Command::new("sh")
        };

        let arg = if cfg!(target_os = "windows") { "/C" } else { "-c" };

        let mut child = match cmd
            .arg(arg)
            .arg(format!("{} 2>&1", cmd_str))
            .stdout(Stdio::piped())
            .spawn() {
            Ok(c) => c,
            Err(e) => {
                let _ = app_handle.emit("build_log", format!("Failed to start installation shell: {}", e));
                let _ = app_handle.emit("build_done", "Failed");
                return;
            }
        };

        let stdout = child.stdout.take().unwrap();
        let reader = BufReader::new(stdout);

        for line in reader.lines() {
            if let Ok(log) = line {
                let _ = app_handle.emit("build_log", log);
            }
        }

        if let Ok(status) = child.wait() {
            if status.success() {
                let _ = app_handle.emit("build_done", "Success");
            } else {
                let _ = app_handle.emit("build_done", "Failed");
            }
        } else {
            let _ = app_handle.emit("build_done", "Failed");
        }
    });
}

#[tauri::command]
async fn force_stop_app(package_name: String, device_ids: Vec<String>) -> Result<String, String> {
    if device_ids.is_empty() { return Err("No devices selected".to_string()); }
    let mut outputs = Vec::new();
    for dev in device_ids {
        let mut cmd = Command::new(get_adb_path());
        cmd.args(["-s", &dev, "shell", "am", "force-stop", &package_name]);
        match cmd.output() {
            Ok(_) => outputs.push(format!("[{}] Force stopped {}", dev, package_name)),
            Err(e) => outputs.push(format!("[{}] Error: {}", dev, e)),
        }
    }
    Ok(outputs.join("\n"))
}

#[tauri::command]
async fn clear_app_data(package_name: String, device_ids: Vec<String>) -> Result<String, String> {
    if device_ids.is_empty() { return Err("No devices selected".to_string()); }
    let mut outputs = Vec::new();
    for dev in device_ids {
        let mut cmd = Command::new(get_adb_path());
        cmd.args(["-s", &dev, "shell", "pm", "clear", &package_name]);
        match cmd.output() {
            Ok(out) => outputs.push(format!("[{}] Cleared data: {}", dev, String::from_utf8_lossy(&out.stdout).trim())),
            Err(e) => outputs.push(format!("[{}] Error: {}", dev, e)),
        }
    }
    Ok(outputs.join("\n"))
}

#[tauri::command]
async fn input_text(text: String, device_ids: Vec<String>) -> Result<String, String> {
    if device_ids.is_empty() { return Err("No devices selected".to_string()); }
    let safe_text = text.replace(" ", "%s");
    let mut outputs = Vec::new();
    for dev in device_ids {
        let mut cmd = Command::new(get_adb_path());
        cmd.args(["-s", &dev, "shell", "input", "text", &safe_text]);
        match cmd.output() {
            Ok(_) => outputs.push(format!("[{}] Text sent", dev)),
            Err(e) => outputs.push(format!("[{}] Error: {}", dev, e)),
        }
    }
    Ok(outputs.join("\n"))
}

#[tauri::command]
async fn take_screenshot(device_id: Option<String>, save_path: Option<String>) -> Result<String, String> {
    let mut cmd = Command::new(get_adb_path());
    if let Some(ref dev) = device_id {
        cmd.args(["-s", dev]);
    }
    cmd.args(["exec-out", "screencap", "-p"]);
    
    let output = cmd.output().map_err(|e| e.to_string())?;
    
    if output.status.success() {
        // Save to file if path provided
        if let Some(ref path) = save_path {
            std::fs::write(path, &output.stdout).map_err(|e| e.to_string())?;
        }
        // Always return base64 for clipboard
        use std::io::Write;
        let mut encoder = Vec::new();
        // Simple base64 encode
        let b64 = base64_encode(&output.stdout);
        let _ = encoder.write_all(b64.as_bytes());
        Ok(format!("data:image/png;base64,{}", b64))
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[((n >> 18) & 63) as usize] as char);
        result.push(CHARS[((n >> 12) & 63) as usize] as char);
        if chunk.len() > 1 { result.push(CHARS[((n >> 6) & 63) as usize] as char); } else { result.push('='); }
        if chunk.len() > 2 { result.push(CHARS[(n & 63) as usize] as char); } else { result.push('='); }
    }
    result
}

// ==================== NEW: Device Info & Profiling ==================== //

#[tauri::command]
async fn get_device_info(device_id: Option<String>) -> Result<String, String> {
    let dev = device_id.as_deref();
    
    let props = vec![
        ("Model", "ro.product.model"),
        ("Brand", "ro.product.brand"),
        ("Device", "ro.product.device"),
        ("Android Version", "ro.build.version.release"),
        ("SDK Level", "ro.build.version.sdk"),
        ("Build ID", "ro.build.display.id"),
        ("CPU ABI", "ro.product.cpu.abi"),
        ("Serial", "ro.serialno"),
        ("Screen Density", "ro.sf.lcd_density"),
        ("Manufacturer", "ro.product.manufacturer"),
    ];

    let mut info = serde_json::Map::new();
    for (label, prop) in props {
        let mut cmd = adb_cmd(dev);
        cmd.args(["shell", "getprop", prop]);
        if let Ok(output) = cmd.output() {
            let val = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !val.is_empty() {
                info.insert(label.to_string(), serde_json::Value::String(val));
            }
        }
    }

    // Get screen resolution
    let mut cmd = adb_cmd(dev);
    cmd.args(["shell", "wm", "size"]);
    if let Ok(output) = cmd.output() {
        let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if let Some(size) = raw.split(':').last() {
            info.insert("Resolution".to_string(), serde_json::Value::String(size.trim().to_string()));
        }
    }

    Ok(serde_json::to_string(&info).unwrap_or_default())
}

#[tauri::command]
async fn get_battery_info(device_id: Option<String>) -> Result<String, String> {
    let mut cmd = adb_cmd(device_id.as_deref());
    cmd.args(["shell", "dumpsys", "battery"]);
    let output = cmd.output().map_err(|e| e.to_string())?;
    let raw = String::from_utf8_lossy(&output.stdout).to_string();
    
    let mut info = serde_json::Map::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if let Some((key, val)) = trimmed.split_once(':') {
            let k = key.trim().to_string();
            let v = val.trim().to_string();
            if !k.is_empty() && !v.is_empty() {
                info.insert(k, serde_json::Value::String(v));
            }
        }
    }
    Ok(serde_json::to_string(&info).unwrap_or_default())
}

#[tauri::command]
async fn get_memory_info(device_id: Option<String>, package_name: Option<String>) -> Result<String, String> {
    let mut cmd = adb_cmd(device_id.as_deref());
    if let Some(ref pkg) = package_name {
        cmd.args(["shell", "dumpsys", "meminfo", pkg]);
    } else {
        cmd.args(["shell", "cat", "/proc/meminfo"]);
    }
    let output = cmd.output().map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
async fn get_cpu_info(device_id: Option<String>, package_name: Option<String>) -> Result<String, String> {
    let mut cmd = adb_cmd(device_id.as_deref());
    if let Some(ref pkg) = package_name {
        cmd.args(["shell", "top", "-n", "1", "-b"]);
        let output = cmd.output().map_err(|e| e.to_string())?;
        let raw = String::from_utf8_lossy(&output.stdout).to_string();
        // Filter for the package line
        let mut result = Vec::new();
        for line in raw.lines() {
            if line.contains(pkg) || line.starts_with("%Cpu") || line.starts_with("Tasks") || line.contains("PID") {
                result.push(line.to_string());
            }
        }
        if result.is_empty() {
            Ok(format!("No process found for {}", pkg))
        } else {
            Ok(result.join("\n"))
        }
    } else {
        cmd.args(["shell", "top", "-n", "1", "-b", "-q"]);
        let output = cmd.output().map_err(|e| e.to_string())?;
        let raw = String::from_utf8_lossy(&output.stdout).to_string();
        // Return first 30 lines for overview
        let lines: Vec<&str> = raw.lines().take(30).collect();
        Ok(lines.join("\n"))
    }
}

// ==================== NEW: File Explorer ==================== //

#[tauri::command]
async fn list_device_files(device_id: Option<String>, path: String) -> Result<String, String> {
    let mut cmd = adb_cmd(device_id.as_deref());
    // CRITICAL: add trailing slash to force listing directory CONTENTS
    // Without it, `ls -la /sdcard` shows the symlink itself on many Android devices
    let browse_path = if path.ends_with('/') { path.clone() } else { format!("{}/", path) };
    cmd.args(["shell", "ls", "-la", &browse_path]);
    let output = cmd.output().map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    
    // Only treat as error if output is empty/near-empty 
    // (don't check stdout for "No such file" — partial errors are normal for broken symlinks within a valid dir)
    if stdout.trim().is_empty() || (stdout.trim().len() < 5 && !stdout.contains("total")) {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        if !stderr.trim().is_empty() {
            return Err(stderr.trim().to_string());
        }
        // Empty directory is fine
    }

    let mut files: Vec<FileEntry> = Vec::new();
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with("total") {
            continue;
        }
        // Skip error lines within the listing
        if trimmed.contains("No such file") || trimmed.contains("Permission denied") {
            continue;
        }
        
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() < 7 { continue; }
        
        let perms = parts[0];
        if perms.len() < 9 { continue; }
        
        let is_dir = perms.starts_with('d');
        let is_link = perms.starts_with('l');
        
        let name = extract_filename(trimmed, parts.len());
        
        if name.is_empty() || name == "." || name == ".." { continue; }
        // Skip entries that look like full paths (not just filenames)
        let display_name = if is_link {
            let link_name = name.split(" -> ").next().unwrap_or(&name).trim().to_string();
            // Extract just the filename if it's a full path
            link_name.rsplit('/').next().unwrap_or(&link_name).to_string()
        } else {
            name.clone()
        };
        
        if display_name.is_empty() { continue; }

        let size_str = parts.iter()
            .skip(2)
            .take(3)
            .find(|s| s.chars().all(|c| c.is_ascii_digit()) && !s.is_empty())
            .unwrap_or(&"0")
            .to_string();
        
        files.push(FileEntry {
            name: display_name,
            is_dir: is_dir || is_link,
            permissions: perms.to_string(),
            size: size_str,
        });
    }
    
    Ok(serde_json::to_string(&files).unwrap_or("[]".to_string()))
}

fn extract_filename(line: &str, _num_parts: usize) -> String {
    // Strategy: find the time pattern (HH:MM or YYYY) then take everything after it as filename
    let parts: Vec<&str> = line.split_whitespace().collect();
    // Look for time-like pattern (HH:MM) starting from index 5
    for i in 5..parts.len() {
        if parts[i].contains(':') && parts[i].len() <= 5 {
            // Next part(s) = filename
            if i + 1 < parts.len() {
                return parts[i+1..].join(" ");
            }
        }
        // Or year pattern (all digits, 4 chars)
        if parts[i].len() == 4 && parts[i].chars().all(|c| c.is_ascii_digit()) && i >= 5 {
            if i + 1 < parts.len() {
                return parts[i+1..].join(" ");
            }
        }
    }
    // Fallback: last part
    parts.last().unwrap_or(&"").to_string()
}

#[tauri::command]
async fn pull_file(device_id: Option<String>, remote_path: String, local_path: String) -> Result<String, String> {
    let mut cmd = adb_cmd(device_id.as_deref());
    cmd.args(["pull", &remote_path, &local_path]);
    let output = cmd.output().map_err(|e| e.to_string())?;
    
    if output.status.success() {
        Ok(format!("Pulled: {}", String::from_utf8_lossy(&output.stdout).trim()))
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
async fn push_file(device_id: Option<String>, local_path: String, remote_path: String) -> Result<String, String> {
    let mut cmd = adb_cmd(device_id.as_deref());
    cmd.args(["push", &local_path, &remote_path]);
    let output = cmd.output().map_err(|e| e.to_string())?;
    
    if output.status.success() {
        Ok(format!("Pushed: {}", String::from_utf8_lossy(&output.stdout).trim()))
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
async fn delete_device_file(device_id: Option<String>, remote_path: String) -> Result<String, String> {
    let mut cmd = adb_cmd(device_id.as_deref());
    cmd.args(["shell", "rm", "-rf", &remote_path]);
    let output = cmd.output().map_err(|e| e.to_string())?;
    
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !stderr.trim().is_empty() {
        Err(stderr)
    } else {
        Ok("Deleted successfully".to_string())
    }
}

// ==================== NEW: Advanced App Management ==================== //

#[tauri::command]
async fn list_installed_apps(device_id: Option<String>, system_apps: bool) -> Result<String, String> {
    let mut cmd = adb_cmd(device_id.as_deref());
    if system_apps {
        cmd.args(["shell", "pm", "list", "packages", "-s"]);
    } else {
        cmd.args(["shell", "pm", "list", "packages", "-3"]);
    }
    let output = cmd.output().map_err(|e| e.to_string())?;
    let raw = String::from_utf8_lossy(&output.stdout).to_string();
    
    let mut packages: Vec<String> = raw.lines()
        .filter_map(|l| l.strip_prefix("package:"))
        .map(|s| s.trim().to_string())
        .collect();
    packages.sort();
    
    Ok(serde_json::to_string(&packages).unwrap_or("[]".to_string()))
}

#[tauri::command]
async fn launch_app(device_id: Option<String>, package_name: String) -> Result<String, String> {
    let mut cmd = adb_cmd(device_id.as_deref());
    cmd.args(["shell", "monkey", "-p", &package_name, "-c", "android.intent.category.LAUNCHER", "1"]);
    let output = cmd.output().map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
async fn send_deep_link(device_id: Option<String>, uri: String) -> Result<String, String> {
    let mut cmd = adb_cmd(device_id.as_deref());
    cmd.args(["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", &uri]);
    let output = cmd.output().map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    
    if stdout.contains("Error") || !stderr.trim().is_empty() {
        Err(format!("{}\n{}", stdout, stderr))
    } else {
        Ok(stdout)
    }
}

#[tauri::command]
async fn get_app_permissions(device_id: Option<String>, package_name: String) -> Result<String, String> {
    let mut cmd = adb_cmd(device_id.as_deref());
    cmd.args(["shell", "dumpsys", "package", &package_name]);
    let output = cmd.output().map_err(|e| e.to_string())?;
    let raw = String::from_utf8_lossy(&output.stdout).to_string();
    
    // Extract runtime permissions section
    let mut permissions: Vec<serde_json::Value> = Vec::new();
    let mut in_perms = false;
    
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.contains("runtime permissions:") || trimmed.contains("install permissions:") {
            in_perms = true;
            continue;
        }
        if in_perms {
            if trimmed.is_empty() || (!trimmed.starts_with("android.permission.") && !trimmed.starts_with("com.")) {
                if !trimmed.contains("permission") && !trimmed.contains(":") {
                    in_perms = false;
                    continue;
                }
            }
            
            if trimmed.contains("android.permission.") || trimmed.contains("com.google") {
                let perm_name = trimmed.split(':').next().unwrap_or(trimmed).trim();
                let granted = trimmed.contains("granted=true");
                
                let mut entry = serde_json::Map::new();
                entry.insert("name".into(), serde_json::Value::String(perm_name.to_string()));
                entry.insert("granted".into(), serde_json::Value::Bool(granted));
                permissions.push(serde_json::Value::Object(entry));
            }
        }
    }
    
    Ok(serde_json::to_string(&permissions).unwrap_or("[]".to_string()))
}

#[tauri::command]
async fn toggle_permission(device_id: Option<String>, package_name: String, permission: String, grant: bool) -> Result<String, String> {
    let mut cmd = adb_cmd(device_id.as_deref());
    if grant {
        cmd.args(["shell", "pm", "grant", &package_name, &permission]);
    } else {
        cmd.args(["shell", "pm", "revoke", &package_name, &permission]);
    }
    let output = cmd.output().map_err(|e| e.to_string())?;
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !stderr.trim().is_empty() {
        Err(stderr)
    } else {
        Ok(format!("{} {} for {}", if grant { "Granted" } else { "Revoked" }, permission, package_name))
    }
}

#[tauri::command]
async fn extract_apk(device_id: Option<String>, package_name: String, save_path: String) -> Result<String, String> {
    // Get APK path on device
    let mut cmd = adb_cmd(device_id.as_deref());
    cmd.args(["shell", "pm", "path", &package_name]);
    let output = cmd.output().map_err(|e| e.to_string())?;
    let raw = String::from_utf8_lossy(&output.stdout).to_string();
    
    let apk_path = raw.lines()
        .filter_map(|l| l.strip_prefix("package:"))
        .next()
        .map(|s| s.trim().to_string())
        .ok_or("Could not find APK path on device".to_string())?;
    
    // Pull the APK
    let mut pull_cmd = adb_cmd(device_id.as_deref());
    pull_cmd.args(["pull", &apk_path, &save_path]);
    let pull_output = pull_cmd.output().map_err(|e| e.to_string())?;
    
    if pull_output.status.success() {
        Ok(format!("APK extracted to: {}", save_path))
    } else {
        Err(String::from_utf8_lossy(&pull_output.stderr).to_string())
    }
}

// ==================== Screen Recording ==================== //

#[tauri::command]
async fn start_screen_record(device_id: Option<String>) -> Result<String, String> {
    let mut cmd = adb_cmd(device_id.as_deref());
    cmd.args(["shell", "screenrecord", "/sdcard/adb_studio_recording.mp4"]);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::null());
    
    match cmd.spawn() {
        Ok(_) => Ok("Recording started (max 3 min)".to_string()),
        Err(e) => Err(format!("Failed to start recording: {}", e)),
    }
}

#[tauri::command]
async fn stop_screen_record(device_id: Option<String>) -> Result<String, String> {
    // Kill screenrecord process - always succeeds
    let mut cmd = adb_cmd(device_id.as_deref());
    cmd.args(["shell", "pkill", "-2", "screenrecord"]);
    let _ = cmd.output();
    
    // Wait for file finalization
    std::thread::sleep(std::time::Duration::from_secs(2));
    Ok("Recording stopped".to_string())
}

#[tauri::command]
async fn pull_recording(device_id: Option<String>, save_path: String) -> Result<String, String> {
    let mut pull_cmd = adb_cmd(device_id.as_deref());
    pull_cmd.args(["pull", "/sdcard/adb_studio_recording.mp4", &save_path]);
    let output = pull_cmd.output().map_err(|e| e.to_string())?;
    
    // Clean up device file
    let mut rm_cmd = adb_cmd(device_id.as_deref());
    rm_cmd.args(["shell", "rm", "/sdcard/adb_studio_recording.mp4"]);
    let _ = rm_cmd.output();
    
    if output.status.success() {
        Ok(format!("Recording saved to: {}", save_path))
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

// ==================== Gallery ==================== //

#[tauri::command]
async fn list_gallery(device_id: Option<String>) -> Result<String, String> {
    // Use separate find commands for each directory to avoid complex shell syntax
    let dirs = ["/sdcard/DCIM", "/sdcard/Pictures", "/sdcard/Movies", "/sdcard/Download"];
    let exts = ["jpg", "jpeg", "png", "webp", "gif", "mp4", "mkv", "mov", "3gp"];
    
    let mut all_paths: Vec<String> = Vec::new();
    
    for dir in &dirs {
        let mut cmd = adb_cmd(device_id.as_deref());
        // Simple ls -R to find all files recursively, then filter in Rust
        cmd.args(["shell", "find", dir, "-type", "f"]);
        if let Ok(output) = cmd.output() {
            let raw = String::from_utf8_lossy(&output.stdout).to_string();
            for line in raw.lines() {
                let path = line.trim();
                if path.is_empty() || path.contains("No such file") { continue; }
                // Check extension
                if let Some(ext) = path.rsplit('.').next() {
                    if exts.contains(&ext.to_lowercase().as_str()) {
                        all_paths.push(path.to_string());
                        if all_paths.len() >= 200 { break; }
                    }
                }
            }
        }
        if all_paths.len() >= 200 { break; }
    }
    let mut items: Vec<serde_json::Value> = Vec::new();
    for file_path in &all_paths {
        let name = file_path.rsplit('/').next().unwrap_or(file_path);
        let ext = name.rsplit('.').next().unwrap_or("").to_lowercase();
        let is_video = matches!(ext.as_str(), "mp4" | "mkv" | "mov" | "3gp" | "avi");
        
        let mut entry = serde_json::Map::new();
        entry.insert("path".into(), serde_json::Value::String(file_path.to_string()));
        entry.insert("name".into(), serde_json::Value::String(name.to_string()));
        entry.insert("isVideo".into(), serde_json::Value::Bool(is_video));
        items.push(serde_json::Value::Object(entry));
    }
    
    Ok(serde_json::to_string(&items).unwrap_or("[]".to_string()))
}

#[tauri::command]
async fn get_media_thumbnail(device_id: Option<String>, remote_path: String) -> Result<String, String> {
    let ext = remote_path.rsplit('.').next().unwrap_or("jpg").to_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "mp4" | "mkv" | "mov" | "3gp" => return Err("Video preview not supported inline".to_string()),
        _ => "image/jpeg",
    };

    // Try to get a smaller version by using Android's thumbnail cache first
    // Android stores thumbnails in /sdcard/DCIM/.thumbnails/
    let filename = remote_path.rsplit('/').next().unwrap_or("");
    if !filename.is_empty() {
        let thumb_dirs = ["/sdcard/DCIM/.thumbnails", "/sdcard/.thumbnails"];
        for thumb_dir in &thumb_dirs {
            let mut find_cmd = adb_cmd(device_id.as_deref());
            find_cmd.args(["shell", "find", thumb_dir, "-name", &format!("*{}*", filename.split('.').next().unwrap_or("")), "-type", "f", "2>/dev/null"]);
            if let Ok(find_output) = find_cmd.output() {
                let found = String::from_utf8_lossy(&find_output.stdout);
                if let Some(thumb_path) = found.lines().next() {
                    let thumb_path = thumb_path.trim();
                    if !thumb_path.is_empty() && !thumb_path.contains("No such file") {
                        let mut cat_cmd = adb_cmd(device_id.as_deref());
                        cat_cmd.args(["exec-out", "cat", thumb_path]);
                        if let Ok(cat_output) = cat_cmd.output() {
                            if cat_output.status.success() && !cat_output.stdout.is_empty() && cat_output.stdout.len() < 500_000 {
                                let b64 = base64_encode(&cat_output.stdout);
                                return Ok(format!("data:image/jpeg;base64,{}", b64));
                            }
                        }
                    }
                }
            }
        }
    }

    // Fallback: read the original file
    let mut cmd = adb_cmd(device_id.as_deref());
    cmd.args(["exec-out", "cat", &remote_path]);
    let output = cmd.output().map_err(|e| e.to_string())?;
    
    if output.status.success() && !output.stdout.is_empty() {
        let b64 = base64_encode(&output.stdout);
        Ok(format!("data:{};base64,{}", mime, b64))
    } else {
        Err("Failed to read file".to_string())
    }
}

#[cfg(target_os = "macos")]
fn sync_mac_env() {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    if let Ok(output) = Command::new(shell).args(["-ilc", "env"]).output() {
        if let Ok(env_output) = String::from_utf8(output.stdout) {
            for line in env_output.lines() {
                if let Some((k, v)) = line.split_once('=') {
                    if !k.trim().is_empty() {
                        std::env::set_var(k.trim(), v.trim());
                    }
                }
            }
        }
    }
}

fn main() {
    #[cfg(target_os = "macos")]
    sync_mac_env();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(LogcatState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            get_devices,
            start_logcat,
            stop_logcat,
            build_apk,
            adb_connect,
            auto_connect_wireless,
            install_apk,
            install_apk_multiple,
            save_logs,
            get_package_name,
            check_file_exists,
            scan_apks,
            uninstall_apk,
            start_scrcpy,
            install_scrcpy,
            force_stop_app,
            clear_app_data,
            input_text,
            take_screenshot,
            get_device_info,
            get_battery_info,
            get_memory_info,
            get_cpu_info,
            list_device_files,
            pull_file,
            push_file,
            delete_device_file,
            list_installed_apps,
            launch_app,
            send_deep_link,
            get_app_permissions,
            toggle_permission,
            extract_apk,
            start_screen_record,
            stop_screen_record,
            pull_recording,
            list_gallery,
            get_media_thumbnail,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri app");
}
