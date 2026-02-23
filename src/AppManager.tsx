import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { STYLES } from "./styles";

interface PermEntry { name: string; granted: boolean }

export default function AppManager({
    selectedDevices, packageFilter, setPackageFilter, projectPath, setProjectPath: _setProjectPath,
    buildApk, selectProject, installApk, foundApks, scanApks: _scanApks,
}: {
    selectedDevices: string[]; packageFilter: string; setPackageFilter: (v: string) => void;
    projectPath: string; setProjectPath: (v: string) => void;
    buildApk: (t: string) => void; selectProject: () => void;
    installApk: (path: string) => void; foundApks: { path: string; name: string }[];
    scanApks: (p: string) => void;
}) {
    const [subTab, setSubTab] = useState<"build" | "apps" | "deeplink" | "permissions">("build");
    const [installedApps, setInstalledApps] = useState<string[]>([]);
    const [showSystem, setShowSystem] = useState(false);
    const [appSearch, setAppSearch] = useState("");
    const [deepLinkUri, setDeepLinkUri] = useState("");
    const [permissions, setPermissions] = useState<PermEntry[]>([]);
    const [permPkg, setPermPkg] = useState("");
    const [loadingApps, setLoadingApps] = useState(false);

    const dev = selectedDevices.length > 0 ? selectedDevices[0] : null;

    const fetchApps = useCallback(async () => {
        if (!dev) return;
        setLoadingApps(true);
        try {
            const res = await invoke<string>("list_installed_apps", { deviceId: dev, systemApps: showSystem });
            setInstalledApps(JSON.parse(res || "[]"));
        } catch { setInstalledApps([]); }
        setLoadingApps(false);
    }, [dev, showSystem]);

    useEffect(() => { if (subTab === "apps") fetchApps(); }, [subTab, fetchApps]);

    const launchApp = async (pkg: string) => {
        try { await invoke("launch_app", { deviceId: dev, packageName: pkg }); } catch (e: any) { alert(e); }
    };

    const forceStopApp = async (pkg?: string) => {
        const target = pkg || packageFilter;
        if (!target) return alert("Enter package name first.");
        try { alert(await invoke("force_stop_app", { packageName: target, deviceIds: selectedDevices })); } catch (e: any) { alert(e); }
    };

    const clearAppData = async (pkg?: string) => {
        const target = pkg || packageFilter;
        if (!target) return alert("Enter package name first.");
        if (!window.confirm(`Wipe data for ${target}?`)) return;
        try { alert(await invoke("clear_app_data", { packageName: target, deviceIds: selectedDevices })); } catch (e: any) { alert(e); }
    };

    const uninstallApp = async (pkg: string) => {
        if (!window.confirm(`Uninstall ${pkg}?`)) return;
        try {
            alert(await invoke("uninstall_apk", { packageName: pkg, deviceIds: selectedDevices }));
            fetchApps();
        } catch (e: any) { alert(e); }
    };

    const extractApk = async (pkg: string) => {
        const savePath = await save({ defaultPath: `${pkg}.apk`, filters: [{ name: "APK", extensions: ["apk"] }] });
        if (!savePath) return;
        try { alert(await invoke("extract_apk", { deviceId: dev, packageName: pkg, savePath })); } catch (e: any) { alert(e); }
    };

    const sendDeepLink = async () => {
        if (!deepLinkUri) return;
        try {
            const res = await invoke<string>("send_deep_link", { deviceId: dev, uri: deepLinkUri });
            alert("Deep link sent!\n" + res);
        } catch (e: any) { alert("Error: " + (typeof e === "string" ? e : JSON.stringify(e))); }
    };

    const loadPermissions = async () => {
        const pkg = permPkg || packageFilter;
        if (!pkg) return alert("Enter a package name.");
        try {
            const res = await invoke<string>("get_app_permissions", { deviceId: dev, packageName: pkg });
            setPermissions(JSON.parse(res || "[]"));
        } catch (e: any) { alert(e); }
    };

    const togglePerm = async (perm: string, grant: boolean) => {
        const pkg = permPkg || packageFilter;
        try {
            await invoke("toggle_permission", { deviceId: dev, packageName: pkg, permission: perm, grant });
            loadPermissions();
        } catch (e: any) { alert("Error: " + (typeof e === "string" ? e : JSON.stringify(e))); }
    };

    const filteredApps = installedApps.filter(a => !appSearch || a.toLowerCase().includes(appSearch.toLowerCase()));

    const subTabs = [
        { id: "build" as const, label: "📦 Build & Install" },
        { id: "apps" as const, label: "📱 Installed Apps" },
        { id: "deeplink" as const, label: "🔗 Deep Links" },
        { id: "permissions" as const, label: "🔐 Permissions" },
    ];

    return (
        <div style={{ ...STYLES.card, flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column" }}>
            {/* Sub-tabs */}
            <div style={{ display: "flex", gap: "2px", marginBottom: "20px", backgroundColor: "rgba(118,118,128,0.08)", padding: "3px", borderRadius: "8px", width: "fit-content" }}>
                {subTabs.map(t => (
                    <button key={t.id} onClick={() => setSubTab(t.id)} style={{
                        padding: "6px 16px", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer",
                        backgroundColor: subTab === t.id ? "#fff" : "transparent", color: subTab === t.id ? "#1d1d1f" : "#86868b",
                        boxShadow: subTab === t.id ? "0 2px 6px rgba(0,0,0,0.1)" : "none", transition: "all 0.15s"
                    }}>{t.label}</button>
                ))}
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                {/* BUILD & INSTALL */}
                {subTab === "build" && (
                    <div style={{ maxWidth: "800px" }}>
                        <div style={STYLES.cardTitle as any}>📦 Development Project & Builder</div>
                        <div style={STYLES.row as any}>
                            <span style={STYLES.label}>Workspace:</span>
                            <input placeholder="Select Android project folder..." value={projectPath} readOnly style={{ ...(STYLES.input), flex: 2, backgroundColor: "transparent", borderBottom: "1px solid #d2d2d7" }} />
                            <button style={STYLES.button} onClick={selectProject}>Browse Directory...</button>
                        </div>
                        <div style={{ ...STYLES.row, marginTop: "16px" } as any}>
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
                        <div style={{ borderTop: "1px solid rgba(0,0,0,0.08)", margin: "32px 0 24px 0" }} />
                        <div style={STYLES.cardTitle as any}>🧹 Clean & Control Application</div>
                        <div style={{ ...STYLES.row, marginBottom: "16px" } as any}>
                            <span style={STYLES.label}>Target Package:</span>
                            <input placeholder="com.example.app" value={packageFilter} onChange={(e) => setPackageFilter(e.target.value)} style={{ ...(STYLES.input), maxWidth: "300px" }} />
                        </div>
                        <div style={STYLES.row as any}>
                            <button style={STYLES.buttonDanger} onClick={() => forceStopApp()}>Stop Process</button>
                            <button style={{ ...STYLES.buttonDanger, borderStyle: "dashed" }} onClick={() => clearAppData()}>Wipe Data & Cache</button>
                        </div>
                    </div>
                )}

                {/* INSTALLED APPS */}
                {subTab === "apps" && (
                    <div>
                        <div style={{ display: "flex", gap: "10px", marginBottom: "14px", alignItems: "center" }}>
                            <input placeholder="Search apps..." value={appSearch} onChange={e => setAppSearch(e.target.value)} style={{ ...(STYLES.input), maxWidth: "300px" }} />
                            <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", cursor: "pointer" }}>
                                <input type="checkbox" checked={showSystem} onChange={() => setShowSystem(!showSystem)} /> System Apps
                            </label>
                            <button style={STYLES.button} onClick={fetchApps}>↻ Refresh</button>
                            <span style={{ fontSize: "12px", color: "#86868b" }}>{filteredApps.length} apps</span>
                        </div>
                        {loadingApps ? (
                            <div style={{ textAlign: "center", padding: "40px", color: "#86868b" }}>Loading installed apps...</div>
                        ) : (
                            <div style={{ maxHeight: "calc(100vh - 340px)", overflowY: "auto", borderRadius: "10px", border: "1px solid rgba(0,0,0,0.06)" }}>
                                {filteredApps.map(pkg => (
                                    <div key={pkg} style={{
                                        display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px",
                                        borderBottom: "1px solid rgba(0,0,0,0.04)", fontSize: "13px", transition: "background 0.1s",
                                    }}
                                        onMouseEnter={e => (e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.02)")}
                                        onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
                                    >
                                        <span style={{ fontFamily: "'SF Mono', monospace", fontSize: "12px", flex: 1 }}>{pkg}</span>
                                        <div style={{ display: "flex", gap: "4px" }}>
                                            <button style={{ ...STYLES.buttonPrimary, padding: "3px 8px", fontSize: "10px" }} onClick={() => launchApp(pkg)}>▶ Launch</button>
                                            <button style={{ ...STYLES.button, padding: "3px 8px", fontSize: "10px" }} onClick={() => forceStopApp(pkg)}>⏹ Stop</button>
                                            <button style={{ ...STYLES.button, padding: "3px 8px", fontSize: "10px" }} onClick={() => extractApk(pkg)}>📥 Extract</button>
                                            <button style={{ ...STYLES.buttonDanger, padding: "3px 8px", fontSize: "10px" }} onClick={() => clearAppData(pkg)}>🗑 Clear</button>
                                            <button style={{ ...STYLES.buttonDanger, padding: "3px 8px", fontSize: "10px", borderStyle: "dashed" }} onClick={() => uninstallApp(pkg)}>✕ Uninstall</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* DEEP LINK TESTER */}
                {subTab === "deeplink" && (
                    <div style={{ maxWidth: "700px" }}>
                        <div style={STYLES.cardTitle as any}>🔗 Deep Link / Intent Tester</div>
                        <p style={{ fontSize: "13px", color: "#86868b", marginBottom: "16px", lineHeight: 1.6 }}>
                            Fire a <code style={{ backgroundColor: "rgba(0,0,0,0.06)", padding: "2px 6px", borderRadius: "4px" }}>VIEW</code> intent with a custom URI to test deep links without needing to run from a browser or another app.
                        </p>
                        <div style={{ display: "flex", gap: "10px", marginBottom: "16px" }}>
                            <input placeholder="myapp://screen/detail?id=123" value={deepLinkUri} onChange={e => setDeepLinkUri(e.target.value)}
                                style={{ ...(STYLES.input), fontFamily: "'SF Mono', monospace", fontSize: "13px" }}
                                onKeyDown={e => e.key === "Enter" && sendDeepLink()}
                            />
                            <button style={STYLES.buttonPrimary} onClick={sendDeepLink}>🚀 Fire Intent</button>
                        </div>
                        <div style={{ fontSize: "12px", color: "#86868b" }}>
                            <b>Examples:</b>
                            {["https://example.com/path", "myapp://home", "market://details?id=com.example.app"].map(uri => (
                                <div key={uri} style={{ marginTop: "6px", cursor: "pointer", color: "#0071e3" }} onClick={() => setDeepLinkUri(uri)}>
                                    {uri}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* PERMISSIONS */}
                {subTab === "permissions" && (
                    <div style={{ maxWidth: "700px" }}>
                        <div style={STYLES.cardTitle as any}>🔐 Runtime Permission Manager</div>
                        <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
                            <input placeholder="com.example.app" value={permPkg || packageFilter} onChange={e => setPermPkg(e.target.value)} style={{ ...(STYLES.input), maxWidth: "300px" }} />
                            <button style={STYLES.buttonPrimary} onClick={loadPermissions}>Load Permissions</button>
                        </div>
                        {permissions.length > 0 && (
                            <div style={{ borderRadius: "10px", border: "1px solid rgba(0,0,0,0.06)", overflow: "hidden" }}>
                                {permissions.map((p, i) => (
                                    <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid rgba(0,0,0,0.04)" }}>
                                        <span style={{ fontSize: "12px", fontFamily: "'SF Mono', monospace", flex: 1 }}>{p.name.replace("android.permission.", "")}</span>
                                        <button
                                            style={{ ...(p.granted ? STYLES.buttonSuccess : STYLES.buttonDanger), padding: "4px 12px", fontSize: "11px" }}
                                            onClick={() => togglePerm(p.name, !p.granted)}
                                        >{p.granted ? "✓ Granted" : "✕ Denied"}</button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
