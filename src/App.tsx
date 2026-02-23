import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { List, ListImperativeAPI } from "react-window";
import { STYLES } from "./styles";
import DeviceProfiler from "./DeviceProfiler";
import FileExplorer from "./FileExplorer";
import AppManager from "./AppManager";

const TABS = ["Debug Log", "App Manager", "Profiler", "File Explorer", "Device Tools"];

function App() {
  const [activeTab, setActiveTab] = useState("Debug Log");
  const [logs, setLogs] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [packageFilter, setPackageFilter] = useState("");
  const [levels, setLevels] = useState({ V: true, D: true, I: true, W: true, E: true, F: true });
  const [crashDetected, setCrashDetected] = useState<string[]>([]);

  const [deviceList, setDeviceList] = useState<string[]>([]);
  const [selectedDevices, setSelectedDevices] = useState<string[]>([]);
  const [projectPath, setProjectPath] = useState(() => localStorage.getItem("adb-debugger-project") || "");
  const [ipAddress, setIpAddress] = useState("");
  const [inputText, setInputText] = useState("");

  const [foundApks, setFoundApks] = useState<{ path: string; name: string }[]>([]);

  const [isBuilding, setIsBuilding] = useState(false);
  const [buildLogs, setBuildLogs] = useState<string[]>([]);
  const [isInstalling, setIsInstalling] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [buildTitle, setBuildTitle] = useState("⚙️ Running Task in background...");

  // Screen recording state
  const [isRecording, setIsRecording] = useState(false);

  const listRef = useRef<ListImperativeAPI>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const buildLogsBottomRef = useRef<HTMLDivElement>(null);
  // Track the device we're currently listening to, to avoid duplicate logcat starts
  const logcatDeviceRef = useRef<string | null>(null);

  useEffect(() => {
    if (isBuilding && buildLogsBottomRef.current) {
      buildLogsBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [buildLogs, isBuilding]);

  const scanApks = useCallback(async (path: string) => {
    if (!path) { setFoundApks([]); return; }
    try {
      const paths = await invoke<string[]>("scan_apks", { projectPath: path });
      setFoundApks(paths.map(p => {
        const parts = p.split('/');
        return { path: p, name: parts[parts.length - 1] };
      }));
    } catch { setFoundApks([]); }
  }, []);

  useEffect(() => {
    scanApks(projectPath);
    if (projectPath) {
      localStorage.setItem("adb-debugger-project", projectPath);
      invoke<string>("get_package_name", { projectPath }).then(pkg => { if (pkg) setPackageFilter(pkg); }).catch(console.warn);
    }
  }, [projectPath, scanApks]);

  // Properly restart logcat when selected device changes
  useEffect(() => {
    const targetDevice = selectedDevices.length > 0 ? selectedDevices[0] : null;

    // Clear old logs on device switch
    setLogs([]);
    setCrashDetected([]);
    logcatDeviceRef.current = targetDevice;

    // Stop existing logcat first, then start new one
    invoke("stop_logcat").catch(() => { }).then(() => {
      if (targetDevice) {
        invoke("start_logcat", { deviceId: targetDevice });
      }
    });

    const unlisten = listen("logcat", (event: any) => {
      const line: string = event.payload;
      setLogs((prev) => [...prev, line].slice(-10000));

      // Crash detection: look for FATAL EXCEPTION or ANR
      if (line.includes("FATAL EXCEPTION") || (line.includes("AndroidRuntime") && line.includes("Error"))) {
        setCrashDetected(prev => [...prev, line].slice(-20));
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
    // Use JSON serialization as dependency to detect actual content changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDevices.join(",")]);

  const fetchDevices = useCallback(async () => {
    try {
      const res = await invoke<string>("get_devices");
      const lines = res.split("\n").map(l => l.trim()).filter(l => l);
      const devs: string[] = [];
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split("\t");
        if (parts.length > 0 && parts[0] && parts[1]?.includes("device")) devs.push(parts[0]);
      }
      setDeviceList(devs);

      // KEY FIX: Prune stale device IDs that are no longer connected
      setSelectedDevices(prev => {
        const stillConnected = prev.filter(d => devs.includes(d));
        // If all previously selected devices are gone, auto-select the first available
        if (stillConnected.length === 0 && devs.length > 0) {
          return [devs[0]];
        }
        return stillConnected;
      });
    } catch { setDeviceList([]); }
  }, []);

  // Auto-fetch devices on mount + poll every 3 seconds
  useEffect(() => {
    fetchDevices();
    const interval = setInterval(fetchDevices, 3000);
    return () => clearInterval(interval);
  }, [fetchDevices]);

  const connectAdb = async () => {
    if (!ipAddress) return;
    try {
      alert(await invoke<string>("adb_connect", { ip: ipAddress }));
      fetchDevices();
    } catch (e: any) { alert("Error: " + (typeof e === "string" ? e : JSON.stringify(e))); }
  };

  const autoConnectWireless = async () => {
    try {
      alert("Scan Results:\n\n" + await invoke<string>("auto_connect_wireless"));
      fetchDevices();
    } catch (e: any) { alert("Error: " + (typeof e === "string" ? e : JSON.stringify(e))); }
  };

  // BUG FIX: Proper error handling for scrcpy (e may be object, not string)
  const startScrcpy = async () => {
    try {
      const dev = selectedDevices.length > 0 ? selectedDevices[0] : null;
      await invoke("start_scrcpy", { deviceId: dev });
    } catch (e: any) {
      const errMsg = typeof e === "string" ? e : (e?.message || JSON.stringify(e));
      if (errMsg.toLowerCase().includes("ensure scrcpy is installed") || errMsg.toLowerCase().includes("failed to start scrcpy")) {
        if (window.confirm("scrcpy is not installed or failed to start. Auto install now?")) installScrcpy();
      } else {
        alert("Error: " + errMsg);
      }
    }
  };

  const takeScreenshot = async () => {
    try {
      const dev = selectedDevices.length > 0 ? selectedDevices[0] : null;
      // Ask to save to file
      const savePath = await save({ defaultPath: 'screenshot.png', filters: [{ name: 'Image', extensions: ['png'] }] });
      // Take screenshot — returns base64 data URI
      const dataUri = await invoke<string>("take_screenshot", { deviceId: dev, savePath: savePath || null });
      // Copy to clipboard
      try {
        const resp = await fetch(dataUri);
        const blob = await resp.blob();
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
        alert(savePath ? "Screenshot saved & copied to clipboard!" : "Screenshot copied to clipboard!");
      } catch {
        alert(savePath ? "Screenshot saved! (Clipboard copy failed)" : "Screenshot taken but clipboard copy failed.");
      }
    } catch (e: any) { alert("Error: " + (typeof e === "string" ? e : JSON.stringify(e))); }
  };

  const sendInputText = async () => {
    if (!inputText) return;
    try {
      await invoke("input_text", { text: inputText, deviceIds: selectedDevices });
      alert("Input sent!");
      setInputText("");
    } catch (e: any) { alert(typeof e === "string" ? e : JSON.stringify(e)); }
  };

  const installScrcpy = async () => {
    setBuildTitle("⚙️ Installing scrcpy in background...");
    setIsBuilding(true);
    setBuildLogs(["Initializing scrcpy installation..."]);
    const unlistenLog = await listen("build_log", (event: any) => setBuildLogs(prev => [...prev, event.payload]));
    const unlistenDone = await listen("build_done", (event: any) => {
      unlistenLog(); unlistenDone();
      if (event.payload === "Success") {
        setBuildLogs(prev => [...prev, "✅ Installed successfully! You can mirror now."]);
        setBuildTitle("✅ Installation Successful");
      } else {
        setBuildLogs(prev => [...prev, "❌ Installation Failed: " + event.payload]);
        setBuildTitle("❌ Installation Failed");
      }
    });
    try { await invoke("install_scrcpy"); } catch (e: any) {
      setBuildLogs(prev => [...prev, "❌ Error: " + e]);
      setBuildTitle("❌ Installation Error");
    }
  };

  const buildApk = async (type: string) => {
    if (!projectPath) return alert("Select project folder first");
    setBuildTitle(`⚙️ Compiling ${type === 'release' ? 'Release' : 'Debug'} APK...`);
    setIsBuilding(true);
    setBuildLogs(["Initializing Gradle..."]);
    const unlistenLog = await listen("build_log", (event: any) => setBuildLogs(prev => [...prev, event.payload]));
    const unlistenDone = await listen("build_done", (event: any) => {
      unlistenLog(); unlistenDone(); scanApks(projectPath);
      if (event.payload === "Success") {
        setBuildLogs(prev => [...prev, "✅ Build Finished Successfully!"]);
        setBuildTitle("✅ Build Successful");
      } else {
        setBuildLogs(prev => [...prev, "❌ Build Failed: " + event.payload]);
        setBuildTitle("❌ Build Failed");
      }
    });
    try { await invoke("build_apk", { projectPath, buildType: type }); } catch (e: any) {
      setBuildLogs(prev => [...prev, "❌ Error: " + e]);
      setBuildTitle("❌ Build Error");
    }
  };

  const selectProject = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected && typeof selected === "string") {
        setProjectPath(selected);
        try {
          const pkg = await invoke<string>("get_package_name", { projectPath: selected });
          if (pkg) setPackageFilter(pkg);
        } catch { }
      }
    } catch { }
  };

  const installApk = async (apkPath: string) => {
    setIsInstalling(true);
    try {
      const res = await invoke<string>("install_apk_multiple", { apkPath, deviceIds: selectedDevices });
      if (res.includes("INSTALL_FAILED_UPDATE_INCOMPATIBLE") || res.includes("signatures do not match")) {
        setIsInstalling(false);
        if (window.confirm("Signatures don't match. Auto-uninstall and retry?")) {
          if (!packageFilter) alert("Need Package Name to uninstall.");
          else {
            setIsInstalling(true);
            const uninstallRes = await invoke<string>("uninstall_apk", { packageName: packageFilter, deviceIds: selectedDevices });
            const retryRes = await invoke<string>("install_apk_multiple", { apkPath, deviceIds: selectedDevices });
            alert("Uninstall:\n" + uninstallRes + "\n\nRetry:\n" + retryRes);
          }
        }
      } else alert("Installed:\n" + res);
    } catch (e: any) { alert("Error: " + e); } finally { setIsInstalling(false); }
  };

  // Screen recording — stop is ALWAYS decoupled from save
  const toggleRecording = async () => {
    const dev = selectedDevices.length > 0 ? selectedDevices[0] : null;
    if (isRecording) {
      // Step 1: Always stop the recording first
      setIsRecording(false);
      try {
        await invoke<string>("stop_screen_record", { deviceId: dev });
      } catch (e: any) {
        console.warn("Stop signal error (may already be stopped):", e);
      }
      // Step 2: Ask to save (optional)
      const savePath = await save({ defaultPath: "recording.mp4", filters: [{ name: "Video", extensions: ["mp4"] }] });
      if (savePath) {
        try {
          const res = await invoke<string>("pull_recording", { deviceId: dev, savePath });
          alert(res);
        } catch (e: any) { alert("Error pulling recording: " + (typeof e === "string" ? e : JSON.stringify(e))); }
      } else {
        alert("Recording stopped. File not saved (still on device at /sdcard/adb_studio_recording.mp4)");
      }
    } else {
      try {
        await invoke<string>("start_screen_record", { deviceId: dev });
        setIsRecording(true);
      } catch (e: any) { alert("Error: " + (typeof e === "string" ? e : JSON.stringify(e))); }
    }
  };

  const getLevel = (log: string) => {
    const match = log.match(/ ([VDIWEF])\/?(?:[^\s]*)/);
    return match ? match[1] : null;
  };

  const toggleLevel = (lvl: string) => {
    setLevels((prev: any) => ({ ...prev, [lvl]: !prev[lvl] }));
  };

  const filteredLogs = useMemo(() => {
    let regexObj: RegExp | null = null;
    if (useRegex && filter) {
      try { regexObj = new RegExp(filter, "i"); } catch { regexObj = null; }
    }

    return logs.filter((log) => {
      if (packageFilter && !log.toLowerCase().includes(packageFilter.toLowerCase())) return false;
      if (filter) {
        if (useRegex && regexObj) {
          if (!regexObj.test(log)) return false;
        } else {
          if (!log.toLowerCase().includes(filter.toLowerCase())) return false;
        }
      }
      const lvl = getLevel(log) || "V";
      if (lvl && !(levels as any)[lvl]) return false;
      return true;
    });
  }, [logs, packageFilter, filter, levels, useRegex]);

  const handleScroll = ({ scrollOffset, scrollUpdateWasRequested }: any) => {
    if (!scrollUpdateWasRequested && terminalRef.current) {
      const clientHeight = terminalRef.current.clientHeight;
      const totalHeight = filteredLogs.length * 22;
      setAutoScroll(scrollOffset + clientHeight >= totalHeight - 50);
    }
  };

  useEffect(() => {
    if (autoScroll && listRef.current && filteredLogs.length > 0) {
      listRef.current.scrollToRow({ index: filteredLogs.length - 1, align: "end" });
    }
  }, [filteredLogs.length, autoScroll]);

  const saveLogs = async () => {
    const path = await save({ defaultPath: "logcat.txt", filters: [{ name: "Text", extensions: ["txt", "log"] }] });
    if (!path) return;
    try {
      await invoke("save_logs", { logs: filteredLogs.join("\n"), path });
      alert("Logs saved!");
    } catch (e: any) { alert(e); }
  };

  const LogRow = (props: any) => {
    const { index, style, ariaAttributes } = props;
    const log = filteredLogs[index];
    const lvl = getLevel(log) || "V";
    let color = "#10a37f";
    if (lvl === "E" || lvl === "F") color = "#ff453a";
    else if (lvl === "W") color = "#ff9f0a";
    else if (lvl === "D") color = "#32ade6";
    else if (lvl === "V") color = "#8e8e93";

    const isCrash = log.includes("FATAL EXCEPTION") || log.includes("AndroidRuntime");

    return (
      <div {...ariaAttributes} style={{
        ...style, whiteSpace: "nowrap", overflow: "hidden", color, textOverflow: "ellipsis",
        fontFamily: "'SF Mono', Consolas, monospace", padding: "0 15px", fontSize: "12px",
        lineHeight: "22px", userSelect: "text", WebkitUserSelect: "text",
        backgroundColor: isCrash ? "rgba(255,59,48,0.15)" : "transparent",
        borderLeft: isCrash ? "3px solid #ff453a" : "3px solid transparent",
      }}>
        {log}
      </div>
    );
  };

  return (
    <div style={STYLES.container}>
      {/* OVERLAYS */}
      {isBuilding && (
        <div style={STYLES.buildOverlay}>
          <div style={STYLES.buildModal}>
            <div style={STYLES.buildHeader}>
              <span style={{ color: "#fff", fontWeight: 600, fontSize: "15px" }}>{buildTitle}</span>
              <button style={{ ...STYLES.button, padding: "4px 10px", backgroundColor: "rgba(255,255,255,0.2)", color: "#fff", border: "none" }} onClick={() => setIsBuilding(false)}>
                {buildTitle.includes("Failed") || buildTitle.includes("Error") || buildTitle.includes("Successful") ? "Close" : "Hide Viewer"}
              </button>
            </div>
            <div style={STYLES.buildLogsView}>
              {buildLogs.map((logLine, index) => <div key={index} style={{ marginBottom: "2px" }}>{logLine}</div>)}
              <div ref={buildLogsBottomRef} />
            </div>
          </div>
        </div>
      )}

      {isInstalling && (
        <div style={STYLES.buildOverlay}>
          <div style={{ ...STYLES.buildModal, width: "320px", height: "auto", padding: "30px", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: "40px", height: "40px", border: "4px solid rgba(255,255,255,0.1)", borderTop: "4px solid #fff", borderRadius: "50%", animation: "spin 1s linear infinite", marginBottom: "20px" }} />
            <span style={{ color: "#fff", fontWeight: 600, fontSize: "16px" }}>Installing on Devices...</span>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } } input:focus, button:hover { opacity: 0.9; }`}</style>

      {/* HEADER */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <h2 style={{ margin: 0, fontSize: "28px", color: "#1d1d1f", fontWeight: 700, letterSpacing: "-0.5px" }}>ADB Studio ⚡</h2>
      </div>

      {/* CONNECTIVITY BAR */}
      <div style={{ ...STYLES.card, padding: "12px 20px", marginBottom: "20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
          <button style={STYLES.button} onClick={fetchDevices}>↻ Refresh</button>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "13px", fontWeight: 600, color: "#86868b" }}>DEVICES:</span>
            {deviceList.length > 0 ? deviceList.map((d) => (
              <label key={d} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", fontSize: "14px", fontWeight: 500 }}>
                <input type="checkbox" checked={selectedDevices.includes(d)} onChange={(e) => {
                  if (e.target.checked) setSelectedDevices(prev => [...prev, d]);
                  else setSelectedDevices(prev => prev.filter(x => x !== d));
                }} />
                {d}
              </label>
            )) : <span style={{ fontSize: "13px", color: "#86868b" }}>-- None --</span>}
          </div>
          <div style={{ borderLeft: "1px solid #d2d2d7", height: "24px", margin: "0 4px" }} />
          <input placeholder="IP:Port (192.168.1.5:5555)" value={ipAddress} onChange={e => setIpAddress(e.target.value)} style={{ ...STYLES.input, flex: "none", width: "180px" }} />
          <button style={STYLES.buttonPrimary} onClick={connectAdb}>Connect</button>
          <button style={STYLES.button} onClick={autoConnectWireless}>Scan Local</button>
        </div>
      </div>

      {/* TABS */}
      <div style={STYLES.tabContainer}>
        {TABS.map(tab => (
          <button key={tab} style={{ ...STYLES.tabButton, ...(activeTab === tab ? STYLES.tabButtonActive : {}) }} onClick={() => setActiveTab(tab)}>
            {tab}
          </button>
        ))}
      </div>

      {/* CRASH BANNER */}
      {crashDetected.length > 0 && activeTab === "Debug Log" && (
        <div style={{
          backgroundColor: "rgba(255,59,48,0.1)", border: "1px solid rgba(255,59,48,0.3)", borderRadius: "10px",
          padding: "10px 16px", marginBottom: "12px", display: "flex", justifyContent: "space-between", alignItems: "center"
        }}>
          <span style={{ fontSize: "13px", color: "#ff3b30", fontWeight: 600 }}>
            🚨 {crashDetected.length} crash/fatal event(s) detected
          </span>
          <div style={{ display: "flex", gap: "8px" }}>
            <button style={{ ...STYLES.button, padding: "4px 10px", fontSize: "11px" }} onClick={() => {
              navigator.clipboard.writeText(crashDetected.join("\n"));
              alert("Stack trace copied!");
            }}>📋 Copy Stack Trace</button>
            <button style={{ ...STYLES.button, padding: "4px 10px", fontSize: "11px", color: "#86868b" }} onClick={() => setCrashDetected([])}>Dismiss</button>
          </div>
        </div>
      )}

      {/* TAB: DEBUG LOG */}
      {activeTab === "Debug Log" && (
        <div style={{ ...STYLES.card, flex: 1, display: "flex", flexDirection: "column", padding: "16px", minHeight: 0 }}>
          <div style={{ ...STYLES.row, marginBottom: "8px" }}>
            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              <span style={{ ...STYLES.label, fontWeight: 700 }}>Search:</span>
              <input placeholder={useRegex ? "Regex pattern..." : "Keyword..."} value={filter} onChange={(e) => setFilter(e.target.value)} style={{ ...STYLES.input, width: "140px", flex: "none" }} />
              <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", cursor: "pointer", color: useRegex ? "#0071e3" : "#86868b" }}>
                <input type="checkbox" checked={useRegex} onChange={() => setUseRegex(!useRegex)} /> Regex
              </label>
              <span style={{ ...STYLES.label, fontWeight: 700, marginLeft: "10px" }}>Package:</span>
              <input placeholder="com.example.app" value={packageFilter} onChange={(e) => setPackageFilter(e.target.value)} style={{ ...STYLES.input, width: "160px", flex: "none" }} />
            </div>

            <div style={{ display: "flex", gap: "12px", marginLeft: "15px" }}>
              {Object.entries(levels).map(([lvl, enabled]) => (
                <label key={lvl} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", fontWeight: 600 }}>
                  <input type="checkbox" checked={enabled} onChange={() => toggleLevel(lvl)} />
                  <span style={{ color: lvl === "E" ? "#ff453a" : lvl === "W" ? "#ff9f0a" : "#1d1d1f" }}>{lvl}</span>
                </label>
              ))}
            </div>

            <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
              <button style={{ ...STYLES.button, color: "#ff453a", border: "1px solid rgba(255,69,58,0.3)" }} onClick={() => { setLogs([]); setCrashDetected([]); }}>Clear</button>
              <button style={STYLES.button} onClick={() => { navigator.clipboard.writeText(filteredLogs.join("\n")); alert("Copied!"); }}>Copy</button>
              <button style={STYLES.button} onClick={saveLogs}>💾 Save</button>
            </div>
          </div>

          <div style={STYLES.terminal} ref={terminalRef}>
            {filteredLogs.length > 0 ? (
              <List listRef={listRef} onScroll={handleScroll} style={{ height: "100%", width: "100%", overflowY: "auto" }} rowCount={filteredLogs.length} rowHeight={22} rowComponent={LogRow} rowProps={{} as any} />
            ) : (
              <div style={{ display: "flex", height: "100%", justifyContent: "center", alignItems: "center", color: "#86868b", fontFamily: "monospace", fontSize: "14px" }}>
                {!packageFilter && !filter ? "> Start an app or connect a device to see logs..." : "> No logs matched criteria."}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB: APP MANAGER */}
      {activeTab === "App Manager" && (
        <AppManager
          selectedDevices={selectedDevices} packageFilter={packageFilter} setPackageFilter={setPackageFilter}
          projectPath={projectPath} setProjectPath={setProjectPath}
          buildApk={buildApk} selectProject={selectProject} installApk={installApk}
          foundApks={foundApks} scanApks={scanApks}
        />
      )}

      {/* TAB: PROFILER */}
      {activeTab === "Profiler" && (
        <DeviceProfiler selectedDevices={selectedDevices} packageFilter={packageFilter} />
      )}

      {/* TAB: FILE EXPLORER */}
      {activeTab === "File Explorer" && (
        <FileExplorer selectedDevices={selectedDevices} />
      )}

      {/* TAB: DEVICE TOOLS */}
      {activeTab === "Device Tools" && (
        <div style={{ ...STYLES.card, flex: 1, minHeight: 0, overflowY: "auto", display: "flex", justifyContent: "center" }}>
          <div style={{ width: "100%", maxWidth: "800px", display: "flex", flexDirection: "column", gap: "40px", marginTop: "20px" }}>
            <div>
              <div style={STYLES.cardTitle as any}>📺 Display & Visuals</div>
              <div style={STYLES.row as any}>
                <button style={{ ...STYLES.buttonMirror, padding: "12px 24px", fontSize: "15px" }} onClick={startScrcpy}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>
                  Launch Screen Mirror
                </button>
                <button style={{ ...STYLES.button, padding: "12px 24px", fontSize: "15px" }} onClick={takeScreenshot}>📸 Screenshot</button>
                <button
                  style={{ ...(isRecording ? STYLES.buttonDanger : STYLES.button), padding: "12px 24px", fontSize: "15px" }}
                  onClick={toggleRecording}
                >{isRecording ? "⏹ Stop Recording" : "🔴 Record Screen"}</button>
              </div>
              <p style={{ fontSize: "13px", color: "#86868b", marginTop: "10px", lineHeight: "1.5" }}>
                Mirror via <b>scrcpy</b>, take screenshots, or record screen video directly to your computer.
              </p>
            </div>
            <div style={{ borderTop: "1px solid rgba(0,0,0,0.08)" }} />
            <div>
              <div style={STYLES.cardTitle as any}>⌨️ Remote Input</div>
              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                <input placeholder="Type a long password or URL here..." value={inputText} onChange={e => setInputText(e.target.value)} style={{ ...STYLES.input, padding: "12px", fontSize: "14px" }} onKeyDown={(e) => e.key === 'Enter' && sendInputText()} />
                <button style={{ ...STYLES.buttonPrimary, padding: "12px 24px" }} onClick={sendInputText}>Send to Device</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;