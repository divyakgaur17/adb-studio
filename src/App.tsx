import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { List, ListImperativeAPI } from "react-window";

// STYLES
const STYLES = {
  container: { padding: "20px", display: "flex", flexDirection: "column" as const, height: "100vh", boxSizing: "border-box" as const, backgroundColor: "#f6f8fb", fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" },
  header: { margin: "0 0 20px 0", fontSize: "24px", color: "#333", fontWeight: 600 },
  card: { backgroundColor: "#fff", padding: "15px", borderRadius: "8px", boxShadow: "0 2px 4px rgba(0,0,0,0.05)", marginBottom: "15px", border: "1px solid #eaeaea" },
  row: { display: "flex", alignItems: "center", flexWrap: "wrap" as const, gap: "10px" },
  button: { padding: "6px 14px", backgroundColor: "#fff", border: "1px solid #ccc", borderRadius: "6px", cursor: "pointer", fontSize: "13px", color: "#333", boxShadow: "0 1px 2px rgba(0,0,0,0.05)", fontWeight: 500, transition: "all 0.2s" },
  buttonPrimary: { padding: "6px 14px", backgroundColor: "#0066cc", border: "1px solid #005bb5", borderRadius: "6px", cursor: "pointer", fontSize: "13px", color: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,0.1)", fontWeight: 500, transition: "all 0.2s" },
  buttonSuccess: { padding: "6px 14px", backgroundColor: "#28a745", border: "1px solid #28a745", borderRadius: "6px", cursor: "pointer", fontSize: "13px", color: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,0.1)", fontWeight: 500, transition: "all 0.2s" },
  input: { padding: "6px 10px", border: "1px solid #ccc", borderRadius: "6px", fontSize: "13px", flex: 1, minWidth: "150px", outline: "none" },
  select: { padding: "6px 10px", border: "1px solid #ccc", borderRadius: "6px", fontSize: "13px", outline: "none", backgroundColor: "#fff" },
  label: { fontSize: "13px", color: "#555", fontWeight: 500 },
  terminal: { flex: 1, backgroundColor: "#1e1e1e", border: "1px solid #333", borderRadius: "8px", overflow: "hidden", marginTop: "10px", boxShadow: "inset 0 2px 5px rgba(0,0,0,0.5)" },
  buildOverlay: { position: "fixed" as const, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.85)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 9999 },
  buildModal: { width: "80%", height: "80%", backgroundColor: "#1e1e1e", borderRadius: "10px", display: "flex", flexDirection: "column" as const, overflow: "hidden", border: "1px solid #444", boxShadow: "0 10px 30px rgba(0,0,0,0.5)" },
  buildHeader: { padding: "15px", backgroundColor: "#2d2d2d", borderBottom: "1px solid #444", display: "flex", justifyContent: "space-between", alignItems: "center" },
  buildLogsView: { flex: 1, padding: "15px", overflowY: "auto" as const, color: "#ddd", fontFamily: "monospace", fontSize: "13px", lineHeight: "1.5" }
};

function App() {
  const [logs, setLogs] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [packageFilter, setPackageFilter] = useState("");
  const [levels, setLevels] = useState({ V: true, D: true, I: true, W: true, E: true, F: true });

  const [deviceList, setDeviceList] = useState<string[]>([]);
  const [selectedDevices, setSelectedDevices] = useState<string[]>([]);
  const [projectPath, setProjectPath] = useState(() => localStorage.getItem("adb-debugger-project") || "");
  const [ipAddress, setIpAddress] = useState("");
  const [savePath, setSavePath] = useState("");

  const [foundApks, setFoundApks] = useState<{ path: string; name: string }[]>([]);

  const [isBuilding, setIsBuilding] = useState(false);
  const [buildLogs, setBuildLogs] = useState<string[]>([]);
  const [isInstalling, setIsInstalling] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [buildTitle, setBuildTitle] = useState("⚙️ Running Task in background...");

  const listRef = useRef<ListImperativeAPI>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const buildLogsBottomRef = useRef<HTMLDivElement>(null);

  // Focus effect for build logs streaming
  useEffect(() => {
    if (isBuilding && buildLogsBottomRef.current) {
      buildLogsBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [buildLogs, isBuilding]);

  // Dynamically query all APKs inside the project
  const scanApks = async (path: string) => {
    if (!path) {
      setFoundApks([]);
      return;
    }
    try {
      const paths = await invoke<string[]>("scan_apks", { projectPath: path });
      const mapped = paths.map(p => {
        const parts = p.split('/');
        const name = parts[parts.length - 1];
        return { path: p, name };
      });
      setFoundApks(mapped);
    } catch (e) {
      console.error(e);
      setFoundApks([]);
    }
  };

  useEffect(() => {
    scanApks(projectPath);
    if (projectPath) {
      localStorage.setItem("adb-debugger-project", projectPath);
      invoke<string>("get_package_name", { projectPath })
        .then(pkg => {
          if (pkg) setPackageFilter(pkg);
        })
        .catch(console.warn);
    }
  }, [projectPath]);

  // Start logcat whenever selectedDevices changes
  useEffect(() => {
    setLogs([]); // clear logs on device switch
    invoke("start_logcat", { deviceId: selectedDevices.length > 0 ? selectedDevices[0] : null });

    const unlisten = listen("logcat", (event: any) => {
      setLogs((prev) => {
        const updated = [...prev, event.payload];
        return updated.slice(-10000); // limit logs
      });
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, [selectedDevices]);

  // Get devices
  const fetchDevices = async () => {
    try {
      const res = await invoke<string>("get_devices");
      const lines = res.split("\n").map(l => l.trim()).filter(l => l);
      const devs: string[] = [];
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split("\t");
        if (parts.length > 0 && parts[0]) {
          devs.push(parts[0]);
        }
      }
      setDeviceList(devs);
      if (selectedDevices.length === 0 && devs.length > 0) {
        setSelectedDevices([devs[0]]);
      }
    } catch (e: any) {
      console.warn("ADB Error:", e);
      // We don't alert here constantly to avoid popups on load, but we can set list empty
      setDeviceList([]);
    }
  };

  // Connect Wireless
  const connectAdb = async () => {
    if (!ipAddress) return;
    try {
      const res = await invoke<string>("adb_connect", { ip: ipAddress });
      alert(res);
      fetchDevices();
    } catch (e: any) {
      alert("Error: " + e);
    }
  };

  const autoConnectWireless = async () => {
    try {
      const res = await invoke<string>("auto_connect_wireless");
      alert("Scan Results:\n\n" + res);
      fetchDevices();
    } catch (e: any) {
      alert("Error: " + e);
    }
  };

  const startScrcpy = async () => {
    try {
      const dev = selectedDevices.length > 0 ? selectedDevices[0] : null;
      await invoke("start_scrcpy", { deviceId: dev });
    } catch (e: any) {
      if (e.includes("ensure scrcpy is installed")) {
        const confirmInstall = window.confirm("scrcpy is not installed on your system. Would you like to automatically install it now?");
        if (confirmInstall) {
          installScrcpy();
        }
      } else {
        alert(e);
      }
    }
  };

  const installScrcpy = async () => {
    setBuildTitle("⚙️ Installing scrcpy in background...");
    setIsBuilding(true);
    setBuildLogs(["Initializing scrcpy installation..."]);

    const unlistenLog = await listen("build_log", (event: any) => {
      setBuildLogs(prev => [...prev, event.payload]);
    });

    const unlistenDone = await listen("build_done", (event: any) => {
      unlistenLog();
      unlistenDone();

      if (event.payload === "Success") {
        alert("scrcpy Installed successfully! You can now start Screen Mirroring.");
        setIsBuilding(false);
      } else {
        alert("Installation failed or completed with errors. Please check the logs in the viewer.");
      }
    });

    try {
      await invoke("install_scrcpy");
    } catch (e: any) {
      alert("Error starting installation: " + e);
      setIsBuilding(false);
      unlistenLog();
      unlistenDone();
    }
  };

  // Build APK Realtime logic
  const buildApk = async (type: string) => {
    if (!projectPath) {
      alert("Please select a project folder first");
      return;
    }

    setBuildTitle(`⚙️ Compiling ${type === 'release' ? 'Release' : 'Debug'} APK in background...`);
    setIsBuilding(true);
    setBuildLogs(["Initializing Gradle build daemon..."]);

    const unlistenLog = await listen("build_log", (event: any) => {
      setBuildLogs(prev => [...prev, event.payload]);
    });

    const unlistenDone = await listen("build_done", (event: any) => {
      setIsBuilding(false);
      unlistenLog();
      unlistenDone();
      scanApks(projectPath); // scan again after finishing

      if (event.payload !== "Success") {
        alert("Build Completed with failures.");
      }
    });

    try {
      await invoke("build_apk", {
        projectPath,
        buildType: type,
      });
    } catch (e: any) {
      alert("Error triggering build dispatch: " + e);
      setIsBuilding(false);
      unlistenLog();
      unlistenDone();
    }
  };

  const selectProject = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected && typeof selected === "string") {
        setProjectPath(selected);
        try {
          const pkg = await invoke<string>("get_package_name", { projectPath: selected });
          if (pkg) {
            setPackageFilter(pkg);
          }
        } catch (e) {
          console.warn("Could not read package name:", e);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Install APK
  const installApk = async (apkPath: string) => {
    setIsInstalling(true);
    try {
      const res = await invoke<string>("install_apk_multiple", { apkPath, deviceIds: selectedDevices });

      if (res.includes("INSTALL_FAILED_UPDATE_INCOMPATIBLE") || res.includes("signatures do not match")) {
        setIsInstalling(false);
        const confirmUninstall = window.confirm("INSTALL_FAILED_UPDATE_INCOMPATIBLE: Existing package signatures do not match.\n\nWould you like to auto-UNINSTALL the existing app and try installing again?");
        if (confirmUninstall) {
          if (!packageFilter) {
            alert("We need the Package Name (e.g. com.example.app) to uninstall it. Please enter it in the 'Package' field below the Search Logs and try again.");
          } else {
            setIsInstalling(true);
            const uninstallRes = await invoke<string>("uninstall_apk", { packageName: packageFilter, deviceIds: selectedDevices });
            const retryRes = await invoke<string>("install_apk_multiple", { apkPath, deviceIds: selectedDevices });
            alert("Uninstall Output:\n" + uninstallRes + "\n\nRetry Installation Output:\n" + retryRes);
          }
        }
      } else {
        alert("Installed log output:\n" + res);
      }
    } catch (e: any) {
      alert("Error: " + e);
    } finally {
      setIsInstalling(false);
    }
  };

  // Save Logs
  const saveLogs = async () => {
    if (!savePath) return alert("Enter save path");
    try {
      const res = await invoke<string>("save_logs", { logs: logs.join("\n"), path: savePath });
      alert(res);
    } catch (e: any) {
      alert("Error: " + e);
    }
  };

  const toggleLevel = (lvl: string) => {
    setLevels((prev: any) => ({ ...prev, [lvl]: !prev[lvl] }));
  };

  const getLevel = (log: string) => {
    const match = log.match(/ ([VDIWEF])\/?(?:[^\s]*)/);
    if (match) return match[1];
    return null;
  };

  const filteredLogs = logs.filter((log) => {
    if (!packageFilter) return false;

    const logLower = log.toLowerCase();
    if (packageFilter && !logLower.includes(packageFilter.toLowerCase())) return false;
    if (filter && !logLower.includes(filter.toLowerCase())) return false;

    const lvl = getLevel(log) || "V";
    if (lvl && !(levels as any)[lvl]) return false;

    return true;
  });

  const handleScroll = ({ scrollOffset, scrollUpdateWasRequested }: any) => {
    if (!scrollUpdateWasRequested && terminalRef.current) {
      const clientHeight = terminalRef.current.clientHeight;
      const totalHeight = filteredLogs.length * 22;
      const isAtBottom = scrollOffset + clientHeight >= totalHeight - 50;
      setAutoScroll(isAtBottom);
    }
  };

  // Auto-scroll list
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
    if (lvl === "E" || lvl === "F") color = "#f75c5c";
    else if (lvl === "W") color = "#f0b132";
    else if (lvl === "D") color = "#5c9df7";
    else if (lvl === "V") color = "#888888";

    return (
      <div {...ariaAttributes} style={{ ...style, whiteSpace: "nowrap", overflow: "hidden", color, textOverflow: "ellipsis", fontFamily: "'SF Mono', Consolas, monospace", padding: "0 10px", fontSize: "12px", lineHeight: "22px", userSelect: "text", WebkitUserSelect: "text" }}>
        {log}
      </div>
    );
  };

  return (
    <div style={STYLES.container}>
      {/* BUILD OVERLAY MODAL */}
      {isBuilding && (
        <div style={STYLES.buildOverlay}>
          <div style={STYLES.buildModal}>
            <div style={STYLES.buildHeader}>
              <span style={{ color: "#fff", fontWeight: 600, fontSize: "15px" }}>{buildTitle}</span>
              <button style={{ ...STYLES.button, padding: "4px 8px", backgroundColor: "#555", color: "#fff", border: "none" }} onClick={() => setIsBuilding(false)}>Hide Viewer</button>
            </div>
            <div style={STYLES.buildLogsView}>
              {buildLogs.map((logLine, index) => (
                <div key={index} style={{ marginBottom: "2px" }}>{logLine}</div>
              ))}
              <div ref={buildLogsBottomRef} />
            </div>
          </div>
        </div>
      )}

      {/* INSTALL OVERLAY MODAL */}
      {isInstalling && (
        <div style={STYLES.buildOverlay}>
          <div style={{ ...STYLES.buildModal, width: "300px", height: "auto", padding: "30px", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: "40px", height: "40px", border: "4px solid rgba(255,255,255,0.1)", borderTop: "4px solid #fff", borderRadius: "50%", animation: "spin 1s linear infinite", marginBottom: "15px" }} />
            <span style={{ color: "#fff", fontWeight: 600 }}>Installing APK on Devices...</span>
            <span style={{ color: "#aaa", fontSize: "12px", marginTop: "8px", textAlign: "center" }}>Please wait, transferring over ADB...</span>
            <style>
              {`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}
            </style>
          </div>
        </div>
      )}


      <h2 style={STYLES.header}>ADB Logger Client</h2>

      <div style={STYLES.card}>
        <div style={STYLES.row}>
          <button style={STYLES.button} onClick={fetchDevices}>Refresh Devices</button>
          <button style={{ ...STYLES.buttonPrimary, backgroundColor: "#6f42c1", border: "1px solid #5a329d" }} onClick={startScrcpy} title="Requires scrcpy installed on your system">Screen Mirror (scrcpy)</button>
          <div style={{ ...STYLES.row, border: "1px solid #ccc", padding: "5px 10px", borderRadius: "6px" }}>
            {deviceList.length > 0 ? deviceList.map((d) => (
              <label key={d} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "4px", fontSize: "13px" }}>
                <input
                  type="checkbox"
                  checked={selectedDevices.includes(d)}
                  onChange={(e) => {
                    if (e.target.checked) setSelectedDevices(prev => [...prev, d]);
                    else setSelectedDevices(prev => prev.filter(x => x !== d));
                  }}
                />
                {d}
              </label>
            )) : <span style={{ fontSize: "13px", color: "#666" }}>-- auto-detecting any --</span>}
          </div>

          <div style={{ marginLeft: "auto", display: "flex", gap: "10px" }}>
            <input
              placeholder="Wireless IP:Port (e.g. 192.168.1.5:5555)"
              value={ipAddress}
              onChange={e => setIpAddress(e.target.value)}
              style={STYLES.input}
            />
            <button style={STYLES.buttonPrimary} onClick={connectAdb}>Connect</button>
            <span style={{ borderLeft: "1px solid #ddd", height: "24px", margin: "0 5px" }}></span>
            <button style={STYLES.button} onClick={autoConnectWireless}>Scan & Connect</button>
          </div>
        </div>
      </div>

      <div style={STYLES.card}>
        <div style={STYLES.row}>
          <span style={STYLES.label}>Project:</span>
          <input
            placeholder="No Android project selected..."
            value={projectPath}
            onChange={(e) => setProjectPath(e.target.value)}
            style={{ ...STYLES.input, flex: 2 }}
            readOnly
          />
          <button style={STYLES.button} onClick={selectProject}>Browse Directory...</button>

          <span style={{ borderLeft: "1px solid #ddd", height: "24px", margin: "0 10px" }}></span>

          <button style={STYLES.button} onClick={() => buildApk("debug")}>Build Debug</button>
          <button style={STYLES.button} onClick={() => buildApk("release")}>Build Release</button>
        </div>

        {/* DYNAMIC SCANNED APK LISTING */}
        {foundApks.length > 0 && (
          <div style={{ marginTop: "15px", padding: "12px", border: "1px dashed #d0d7de", borderRadius: "6px", backgroundColor: "#fbfcfd" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "#57606a", display: "block", marginBottom: "8px", textTransform: "uppercase" }}>Quick Install Detected APKs</span>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {foundApks.map((apk, i) => (
                <button key={i} style={STYLES.buttonSuccess} onClick={() => installApk(apk.path)} title={apk.path}>
                  Install {apk.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={STYLES.card}>
        <div style={{ ...STYLES.row, marginBottom: "10px" }}>
          <span style={STYLES.label}>Search Logs:</span>
          <input
            placeholder="Keyword filter..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={STYLES.input}
          />
          <span style={STYLES.label}>Package:</span>
          <input
            placeholder="e.g. com.example.app"
            value={packageFilter}
            onChange={(e) => setPackageFilter(e.target.value)}
            style={STYLES.input}
          />
        </div>

        <div style={STYLES.row}>
          <span style={STYLES.label}>Log Levels:</span>
          <div style={{ display: "flex", gap: "15px", marginLeft: "5px" }}>
            {Object.entries(levels).map(([lvl, enabled]) => (
              <label key={lvl} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "4px", fontSize: "13px" }}>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={() => toggleLevel(lvl)}
                  style={{ cursor: "pointer" }}
                />
                <strong style={{ color: lvl === "E" ? "#d9534f" : lvl === "W" ? "#f0ad4e" : "#555" }}>{lvl}</strong>
              </label>
            ))}
          </div>

          <div style={{ marginLeft: "auto", display: "flex", gap: "10px" }}>
            <button style={{ ...STYLES.button, color: "#d9534f" }} onClick={() => setLogs([])}>Clear Logs</button>
            <button style={STYLES.button} onClick={() => {
              navigator.clipboard.writeText(filteredLogs.join("\n"));
              alert("Copied " + filteredLogs.length + " visible logs to clipboard!");
            }}>Copy View</button>
            <span style={{ borderLeft: "1px solid #ddd", height: "24px", margin: "0 5px" }}></span>
            <input
              placeholder="/path/to/save/logs.txt"
              value={savePath}
              onChange={e => setSavePath(e.target.value)}
              style={STYLES.input}
            />
            <button style={STYLES.button} onClick={saveLogs}>Export</button>
          </div>
        </div>
      </div>

      <div style={STYLES.terminal} ref={terminalRef}>
        {filteredLogs.length > 0 ? (
          <List
            listRef={listRef}
            onScroll={handleScroll}
            style={{ height: "100%", width: "100%", overflowY: "auto" }}
            rowCount={filteredLogs.length}
            rowHeight={22}
            rowComponent={LogRow}
            rowProps={{} as any}
          />
        ) : (
          <div style={{ padding: "20px", color: "#666", textAlign: "center", marginTop: "20px", fontFamily: "monospace" }}>
            {!projectPath ? "Waiting for project selection..." : "No logs streaming for this package yet."}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;