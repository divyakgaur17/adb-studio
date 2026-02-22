import { useEffect, useState, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { List, ListImperativeAPI } from "react-window";

// ================= PREMIUM APPLE STYLE CSS ================= //
const STYLES = {
  container: {
    padding: "24px", display: "flex", flexDirection: "column" as const, height: "100vh",
    boxSizing: "border-box" as const, backgroundColor: "#f5f5f7",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif",
    overflow: "hidden"
  },
  card: {
    backgroundColor: "rgba(255, 255, 255, 0.7)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
    padding: "20px", borderRadius: "16px", boxShadow: "0 4px 14px rgba(0,0,0,0.04), 0 1px 4px rgba(0,0,0,0.02)",
    border: "1px solid rgba(255,255,255,0.4)"
  },
  cardTitle: {
    fontSize: "14px", fontWeight: 600, color: "#86868b", textTransform: "uppercase" as const,
    letterSpacing: "0.5px", marginBottom: "16px"
  },
  row: {
    display: "flex", alignItems: "center", flexWrap: "wrap" as const, gap: "10px", marginBottom: "12px"
  },
  button: {
    padding: "8px 16px", backgroundColor: "#fff", border: "1px solid #d2d2d7", borderRadius: "8px",
    cursor: "pointer", fontSize: "13px", color: "#1d1d1f", fontWeight: 500,
    boxShadow: "0 1px 2px rgba(0,0,0,0.02)", transition: "all 0.15s ease",
  },
  buttonPrimary: {
    padding: "8px 16px", backgroundColor: "#0071e3", border: "1px solid #0071e3", borderRadius: "8px",
    cursor: "pointer", fontSize: "13px", color: "#fff", fontWeight: 500,
    boxShadow: "0 2px 4px rgba(0,113,227,0.2)", transition: "all 0.15s ease",
  },
  buttonDanger: {
    padding: "8px 16px", backgroundColor: "#fff", border: "1px solid #ff3b30", borderRadius: "8px",
    cursor: "pointer", fontSize: "13px", color: "#ff3b30", fontWeight: 500,
    transition: "all 0.15s ease",
  },
  buttonSuccess: {
    padding: "8px 16px", backgroundColor: "#34c759", border: "1px solid #34c759", borderRadius: "8px",
    cursor: "pointer", fontSize: "13px", color: "#fff", fontWeight: 500,
    boxShadow: "0 2px 4px rgba(52,199,89,0.2)", transition: "all 0.15s ease",
  },
  buttonMirror: {
    padding: "8px 16px", backgroundColor: "#5e5ce6", border: "1px solid #5e5ce6", borderRadius: "8px",
    cursor: "pointer", fontSize: "13px", color: "#fff", fontWeight: 600,
    boxShadow: "0 2px 4px rgba(94,92,230,0.2)", transition: "all 0.15s ease", display: "flex", alignItems: "center", gap: "6px"
  },
  input: {
    padding: "8px 12px", border: "1px solid #d2d2d7", borderRadius: "8px", fontSize: "13px",
    flex: 1, minWidth: "150px", outline: "none", color: "#1d1d1f", backgroundColor: "rgba(255,255,255,0.8)",
    transition: "box-shadow 0.2s ease"
  },
  label: {
    fontSize: "13px", color: "#1d1d1f", fontWeight: 500
  },
  terminal: {
    flex: 1, backgroundColor: "#1e1e1e", border: "1px solid rgba(0,0,0,0.2)", borderRadius: "12px",
    overflow: "hidden", marginTop: "10px", boxShadow: "inset 0 2px 10px rgba(0,0,0,0.5), 0 4px 12px rgba(0,0,0,0.1)"
  },
  buildOverlay: {
    position: "fixed" as const, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.4)",
    backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
    display: "flex", justifyContent: "center", alignItems: "center", zIndex: 9999
  },
  buildModal: {
    width: "70%", height: "70%", backgroundColor: "rgba(30,30,30,0.9)", backdropFilter: "blur(20px)",
    borderRadius: "16px", display: "flex", flexDirection: "column" as const, overflow: "hidden",
    border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 20px 40px rgba(0,0,0,0.3)"
  },
  buildHeader: {
    padding: "16px 20px", backgroundColor: "rgba(0,0,0,0.3)", borderBottom: "1px solid rgba(255,255,255,0.1)",
    display: "flex", justifyContent: "space-between", alignItems: "center"
  },
  buildLogsView: {
    flex: 1, padding: "20px", overflowY: "auto" as const, color: "#f5f5f7", fontFamily: "'SF Mono', Consolas, monospace",
    fontSize: "13px", lineHeight: "1.6"
  },
  tabContainer: {
    display: "flex", gap: "4px", backgroundColor: "rgba(118,118,128,0.12)", padding: "4px", borderRadius: "10px", marginBottom: "20px", width: "fit-content"
  },
  tabButton: {
    padding: "8px 24px", border: "none", borderRadius: "8px", fontSize: "14px", fontWeight: 600, cursor: "pointer",
    backgroundColor: "transparent", color: "#86868b", transition: "all 0.2s ease"
  },
  tabButtonActive: {
    backgroundColor: "#fff", color: "#1d1d1f", boxShadow: "0 3px 8px rgba(0,0,0,0.12), 0 3px 1px rgba(0,0,0,0.04)"
  }
};

function App() {
  const [activeTab, setActiveTab] = useState("Debug Log");
  const [logs, setLogs] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [packageFilter, setPackageFilter] = useState("");
  const [levels, setLevels] = useState({ V: true, D: true, I: true, W: true, E: true, F: true });

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

  const listRef = useRef<ListImperativeAPI>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const buildLogsBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isBuilding && buildLogsBottomRef.current) {
      buildLogsBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [buildLogs, isBuilding]);

  const scanApks = async (path: string) => {
    if (!path) { setFoundApks([]); return; }
    try {
      const paths = await invoke<string[]>("scan_apks", { projectPath: path });
      setFoundApks(paths.map(p => {
        const parts = p.split('/');
        return { path: p, name: parts[parts.length - 1] };
      }));
    } catch (e) { setFoundApks([]); }
  };

  useEffect(() => {
    scanApks(projectPath);
    if (projectPath) {
      localStorage.setItem("adb-debugger-project", projectPath);
      invoke<string>("get_package_name", { projectPath }).then(pkg => { if (pkg) setPackageFilter(pkg); }).catch(console.warn);
    }
  }, [projectPath]);

  useEffect(() => {
    setLogs([]);
    invoke("start_logcat", { deviceId: selectedDevices.length > 0 ? selectedDevices[0] : null });
    const unlisten = listen("logcat", (event: any) => {
      setLogs((prev) => [...prev, event.payload].slice(-10000));
    });
    return () => { unlisten.then((f) => f()); };
  }, [selectedDevices]);

  const fetchDevices = async () => {
    try {
      const res = await invoke<string>("get_devices");
      const lines = res.split("\n").map(l => l.trim()).filter(l => l);
      const devs: string[] = [];
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split("\t");
        if (parts.length > 0 && parts[0]) devs.push(parts[0]);
      }
      setDeviceList(devs);
      if (selectedDevices.length === 0 && devs.length > 0) setSelectedDevices([devs[0]]);
    } catch { setDeviceList([]); }
  };

  const connectAdb = async () => {
    if (!ipAddress) return;
    try {
      alert(await invoke<string>("adb_connect", { ip: ipAddress }));
      fetchDevices();
    } catch (e: any) { alert("Error: " + e); }
  };

  const autoConnectWireless = async () => {
    try {
      alert("Scan Results:\n\n" + await invoke<string>("auto_connect_wireless"));
      fetchDevices();
    } catch (e: any) { alert("Error: " + e); }
  };

  const startScrcpy = async () => {
    try {
      await invoke("start_scrcpy", { deviceId: selectedDevices.length > 0 ? selectedDevices[0] : null });
    } catch (e: any) {
      if (e.includes("ensure scrcpy is installed")) {
        if (window.confirm("scrcpy is not installed. Auto install now?")) installScrcpy();
      } else alert(e);
    }
  };

  const takeScreenshot = async () => {
    try {
      const dev = selectedDevices.length > 0 ? selectedDevices[0] : null;
      const savePath = await save({ defaultPath: 'screenshot.png', filters: [{ name: 'Image', extensions: ['png'] }] });
      if (!savePath) return;
      alert(await invoke("take_screenshot", { deviceId: dev, savePath }));
    } catch (e: any) { alert("Error: " + e); }
  };

  const sendInputText = async () => {
    if (!inputText) return;
    try {
      await invoke("input_text", { text: inputText, deviceIds: selectedDevices });
      alert("Input sent!");
      setInputText("");
    } catch (e: any) { alert(e); }
  };

  const forceStopApp = async () => {
    if (!packageFilter) return alert("Enter Package name first.");
    try {
      alert(await invoke("force_stop_app", { packageName: packageFilter, deviceIds: selectedDevices }));
    } catch (e: any) { alert(e); }
  };

  const clearAppData = async () => {
    if (!packageFilter) return alert("Enter Package name first.");
    if (!window.confirm(`Wipe user data completely for ${packageFilter}?`)) return;
    try {
      alert(await invoke("clear_app_data", { packageName: packageFilter, deviceIds: selectedDevices }));
    } catch (e: any) { alert(e); }
  };

  const installScrcpy = async () => {
    setBuildTitle("⚙️ Installing scrcpy in background...");
    setIsBuilding(true);
    setBuildLogs(["Initializing scrcpy installation..."]);
    const unlistenLog = await listen("build_log", (event: any) => setBuildLogs(prev => [...prev, event.payload]));
    const unlistenDone = await listen("build_done", (event: any) => {
      unlistenLog(); unlistenDone();
      if (event.payload === "Success") {
        alert("Installed successfully! You can mirror now.");
        setIsBuilding(false);
      } else alert("Installation failed.");
    });
    try { await invoke("install_scrcpy"); } catch (e: any) { setIsBuilding(false); }
  };

  const buildApk = async (type: string) => {
    if (!projectPath) return alert("Select project folder first");
    setBuildTitle(`⚙️ Compiling ${type === 'release' ? 'Release' : 'Debug'} APK...`);
    setIsBuilding(true);
    setBuildLogs(["Initializing Gradle..."]);
    const unlistenLog = await listen("build_log", (event: any) => setBuildLogs(prev => [...prev, event.payload]));
    const unlistenDone = await listen("build_done", (event: any) => {
      setIsBuilding(false); unlistenLog(); unlistenDone(); scanApks(projectPath);
      if (event.payload !== "Success") alert("Build failures.");
    });
    try { await invoke("build_apk", { projectPath, buildType: type }); } catch { setIsBuilding(false); }
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
          if (!packageFilter) alert("Need Package Name in string field to uninstall.");
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

  const getLevel = (log: string) => {
    const match = log.match(/ ([VDIWEF])\/?(?:[^\s]*)/);
    return match ? match[1] : null;
  };

  const toggleLevel = (lvl: string) => {
    setLevels((prev: any) => ({ ...prev, [lvl]: !prev[lvl] }));
  };

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (!packageFilter && activeTab === "Debug Log") return true; // Show all logs if no app package selected
      if (packageFilter && !log.toLowerCase().includes(packageFilter.toLowerCase())) return false;
      if (filter && !log.toLowerCase().includes(filter.toLowerCase())) return false;
      const lvl = getLevel(log) || "V";
      if (lvl && !(levels as any)[lvl]) return false;
      return true;
    });
  }, [logs, packageFilter, filter, levels, activeTab]);

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

  const LogRow = (props: any) => {
    const { index, style, ariaAttributes } = props;
    const log = filteredLogs[index];
    const lvl = getLevel(log) || "V";
    let color = "#10a37f";
    if (lvl === "E" || lvl === "F") color = "#ff453a";
    else if (lvl === "W") color = "#ff9f0a";
    else if (lvl === "D") color = "#32ade6";
    else if (lvl === "V") color = "#8e8e93";

    return (
      <div {...ariaAttributes} style={{ ...style, whiteSpace: "nowrap", overflow: "hidden", color, textOverflow: "ellipsis", fontFamily: "'SF Mono', Consolas, monospace", padding: "0 15px", fontSize: "12px", lineHeight: "22px", userSelect: "text", WebkitUserSelect: "text" }}>
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
              <button style={{ ...STYLES.button, padding: "4px 10px", backgroundColor: "rgba(255,255,255,0.2)", color: "#fff", border: "none" }} onClick={() => setIsBuilding(false)}>Hide Viewer</button>
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
            <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } } input:focus, button:hover { opacity: 0.9; }`}</style>
          </div>
        </div>
      )}

      {/* HEADER & PERSISTENT CONNECTIVITY BAR */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <h2 style={{ margin: 0, fontSize: "28px", color: "#1d1d1f", fontWeight: 700, letterSpacing: "-0.5px" }}>ADB Studio ⚡</h2>
      </div>

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

          <div style={{ borderLeft: "1px solid #d2d2d7", height: "24px", margin: "0 4px" }}></div>

          <input placeholder="IP:Port (192.168.1.5:5555)" value={ipAddress} onChange={e => setIpAddress(e.target.value)} style={{ ...STYLES.input, flex: "none", width: "180px" }} />
          <button style={STYLES.buttonPrimary} onClick={connectAdb}>Connect</button>
          <button style={STYLES.button} onClick={autoConnectWireless}>Scan Local</button>
        </div>
      </div>

      {/* TABS */}
      <div style={STYLES.tabContainer}>
        {["Debug Log", "App Manager", "Device Tools"].map(tab => (
          <button
            key={tab}
            style={{ ...STYLES.tabButton, ...(activeTab === tab ? STYLES.tabButtonActive : {}) }}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* TAB CONTENT - LOGCAT */}
      {activeTab === "Debug Log" && (
        <div style={{ ...STYLES.card, flex: 1, display: "flex", flexDirection: "column", padding: "16px", minHeight: 0 }}>
          <div style={{ ...STYLES.row, marginBottom: "8px" }}>
            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              <span style={{ ...STYLES.label, fontWeight: 700 }}>Search Logs:</span>
              <input placeholder="Keyword..." value={filter} onChange={(e) => setFilter(e.target.value)} style={{ ...STYLES.input, width: "140px", flex: "none" }} />
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
              <button style={{ ...STYLES.button, color: "#ff453a", border: "1px solid rgba(255,69,58,0.3)" }} onClick={() => setLogs([])}>Clear View</button>
              <button style={STYLES.button} onClick={() => { navigator.clipboard.writeText(filteredLogs.join("\n")); alert("Copied visible logs!"); }}>Copy View</button>
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

      {/* TAB CONTENT - APP MANAGER */}
      {activeTab === "App Manager" && (
        <div style={{ ...STYLES.card, flex: 1, minHeight: 0, overflowY: "auto", display: "flex", justifyContent: "center" }}>
          <div style={{ width: "100%", maxWidth: "800px", marginTop: "20px" }}>

            <div style={STYLES.cardTitle}>📦 Development Project & Builder</div>
            <div style={STYLES.row}>
              <span style={STYLES.label}>Workspace:</span>
              <input placeholder="Select Android project folder..." value={projectPath} onChange={(e) => setProjectPath(e.target.value)} style={{ ...STYLES.input, flex: 2, backgroundColor: "transparent", borderBottom: "1px solid #d2d2d7" }} readOnly />
              <button style={STYLES.button} onClick={selectProject}>Browse Directory...</button>
            </div>
            <div style={{ ...STYLES.row, marginTop: "16px" }}>
              <button style={STYLES.buttonPrimary} onClick={() => buildApk("debug")}>Build Debug APK</button>
              <button style={STYLES.button} onClick={() => buildApk("release")}>Build Release APK</button>
            </div>

            {foundApks.length > 0 && (
              <div style={{ marginTop: "24px", padding: "16px", border: "1px solid rgba(52,199,89,0.3)", borderRadius: "12px", backgroundColor: "rgba(52,199,89,0.05)" }}>
                <span style={{ fontSize: "12px", fontWeight: 600, color: "#34c759", display: "block", marginBottom: "12px" }}>▶ QUICK INSTALL READY APKS</span>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  {foundApks.map((apk, i) => (
                    <button key={i} style={STYLES.buttonSuccess} onClick={() => installApk(apk.path)} title={apk.path}>⬇ Install {apk.name}</button>
                  ))}
                </div>
              </div>
            )}

            <div style={{ borderTop: "1px solid rgba(0,0,0,0.08)", margin: "32px 0 24px 0" }}></div>

            <div style={STYLES.cardTitle}>🧹 Clean & Control Application</div>
            <div style={{ ...STYLES.row, marginBottom: "16px" }}>
              <span style={STYLES.label}>Target Package:</span>
              <input placeholder="com.example.app" value={packageFilter} onChange={(e) => setPackageFilter(e.target.value)} style={{ ...STYLES.input, maxWidth: "300px" }} />
            </div>
            <div style={STYLES.row}>
              <button style={STYLES.buttonDanger} onClick={forceStopApp} title="Kills the app process">Stop Process</button>
              <button style={{ ...STYLES.buttonDanger, borderStyle: "dashed" }} onClick={clearAppData} title="Wipes all app data and cache like fresh install">Wipe Data & Cache</button>
            </div>

          </div>
        </div>
      )}

      {/* TAB CONTENT - DEVICE TOOLS */}
      {activeTab === "Device Tools" && (
        <div style={{ ...STYLES.card, flex: 1, minHeight: 0, overflowY: "auto", display: "flex", justifyContent: "center" }}>
          <div style={{ width: "100%", maxWidth: "800px", display: "flex", flexDirection: "column", gap: "40px", marginTop: "20px" }}>

            <div>
              <div style={STYLES.cardTitle}>📺 Display & Visuals</div>
              <div style={STYLES.row}>
                <button style={{ ...STYLES.buttonMirror, padding: "12px 24px", fontSize: "15px" }} onClick={startScrcpy} title="Requires scrcpy installed">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>
                  Launch Screen Mirror
                </button>
                <button style={{ ...STYLES.button, padding: "12px 24px", fontSize: "15px" }} onClick={takeScreenshot}>
                  📸 Take High-Res Screenshot
                </button>
              </div>
              <p style={{ fontSize: "13px", color: "#86868b", marginTop: "10px", lineHeight: "1.5" }}>Mirror your device screen to your Mac with zero latency via <b>scrcpy</b>. Click "Take Screenshot" to instantly capture the current frame to your computer via ADB.</p>
            </div>

            <div style={{ borderTop: "1px solid rgba(0,0,0,0.08)" }}></div>

            <div>
              <div style={STYLES.cardTitle}>⌨️ Remote Input</div>
              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                <input placeholder="Type a long password or URL here..." value={inputText} onChange={e => setInputText(e.target.value)} style={{ ...STYLES.input, padding: "12px", fontSize: "14px" }} onKeyDown={(e) => e.key === 'Enter' && sendInputText()} />
                <button style={{ ...STYLES.buttonPrimary, padding: "12px 24px" }} onClick={sendInputText}>Send to Device</button>
              </div>
              <p style={{ fontSize: "13px", color: "#86868b", marginTop: "10px", lineHeight: "1.5" }}>Useful for quickly pasting long credentials, authentication tokens, or deep links directly into your connected Android Phone/Emulator without fighting the virtual keyboard.</p>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}

export default App;