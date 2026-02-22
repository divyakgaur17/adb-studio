#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::Emitter;

struct LogcatState(Mutex<Option<Child>>);

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

    let mut cmd = Command::new(scrcpy_path);
    
    // Ensure the child process can find any dependencies like adb if needed
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
        cmd.args(["-s", dev]);
    }

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
        
        // Fallback for unknown OS just in case (though Rust catches compile errors if not covered)
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
    let safe_text = text.replace(" ", "%s"); // ADB input text space character
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
async fn take_screenshot(device_id: Option<String>, save_path: String) -> Result<String, String> {
    let mut cmd = Command::new(get_adb_path());
    if let Some(dev) = device_id {
        cmd.args(["-s", &dev]);
    }
    cmd.args(["exec-out", "screencap", "-p"]);
    
    let output = cmd.output().map_err(|e| e.to_string())?;
    
    if output.status.success() {
        std::fs::write(&save_path, output.stdout).map_err(|e| e.to_string())?;
        Ok(format!("Screenshot saved!"))
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(LogcatState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            get_devices,
            start_logcat,
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
            take_screenshot
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri app");
}
