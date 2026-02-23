import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { STYLES } from "./styles";

interface DeviceInfo { [key: string]: string }
interface BatteryInfo { [key: string]: string }

export default function DeviceProfiler({ selectedDevices, packageFilter }: { selectedDevices: string[]; packageFilter: string }) {
    const [deviceInfo, setDeviceInfo] = useState<DeviceInfo>({});
    const [battery, setBattery] = useState<BatteryInfo>({});
    const [memoryRaw, setMemoryRaw] = useState("");
    const [cpuRaw, setCpuRaw] = useState("");
    const [loading, setLoading] = useState(false);

    const dev = selectedDevices.length > 0 ? selectedDevices[0] : null;

    const refresh = useCallback(async () => {
        if (!dev) return;
        setLoading(true);
        try {
            const [infoStr, battStr, memStr, cpuStr] = await Promise.all([
                invoke<string>("get_device_info", { deviceId: dev }),
                invoke<string>("get_battery_info", { deviceId: dev }),
                invoke<string>("get_memory_info", { deviceId: dev, packageName: packageFilter || null }),
                invoke<string>("get_cpu_info", { deviceId: dev, packageName: packageFilter || null }),
            ]);
            setDeviceInfo(JSON.parse(infoStr || "{}"));
            setBattery(JSON.parse(battStr || "{}"));
            setMemoryRaw(memStr);
            setCpuRaw(cpuStr);
        } catch (e) { console.warn(e); }
        setLoading(false);
    }, [dev, packageFilter]);

    useEffect(() => { refresh(); }, [refresh]);

    // Auto refresh every 5s
    useEffect(() => {
        const iv = setInterval(refresh, 5000);
        return () => clearInterval(iv);
    }, [refresh]);

    const batteryLevel = parseInt(battery["level"] || "0");
    const batteryColor = batteryLevel > 60 ? "#34c759" : batteryLevel > 20 ? "#ff9f0a" : "#ff3b30";
    const isCharging = battery["status"] === "2" || battery["AC powered"]?.toLowerCase() === "true" || battery["USB powered"]?.toLowerCase() === "true";

    // Parse meminfo for total/free
    const parseMemInfo = () => {
        const lines = memoryRaw.split("\n");
        let totalPss = "";
        for (const l of lines) {
            if (l.includes("TOTAL PSS:") || l.includes("TOTAL:")) {
                const nums = l.match(/[\d,]+/);
                if (nums) totalPss = nums[0];
            }
        }
        // System meminfo
        let memTotal = "", memAvail = "";
        for (const l of lines) {
            if (l.startsWith("MemTotal:")) memTotal = l.replace("MemTotal:", "").trim();
            if (l.startsWith("MemAvailable:")) memAvail = l.replace("MemAvailable:", "").trim();
        }
        return { totalPss, memTotal, memAvail };
    };
    const mem = parseMemInfo();

    if (!dev) return (
        <div style={{ ...STYLES.card, flex: 1, display: "flex", justifyContent: "center", alignItems: "center", color: "#86868b" }}>
            <span>Connect a device to view profiler data</span>
        </div>
    );

    return (
        <div style={{ ...STYLES.card, flex: 1, minHeight: 0, overflowY: "auto" }}>
            <div style={{ maxWidth: "900px", margin: "0 auto", width: "100%" }}>
                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                    <div style={STYLES.cardTitle as any}>📊 Device Profiler</div>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        {loading && <div style={{ width: 14, height: 14, border: "2px solid #d2d2d7", borderTop: "2px solid #0071e3", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />}
                        <button style={STYLES.button} onClick={refresh}>↻ Refresh</button>
                    </div>
                </div>

                {/* Device Info Grid */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "12px", marginBottom: "24px" }}>
                    {Object.entries(deviceInfo).map(([k, v]) => (
                        <div key={k} style={STYLES.statCard}>
                            <div style={STYLES.statLabel as any}>{k}</div>
                            <div style={{ fontSize: "15px", fontWeight: 600, color: "#1d1d1f", marginTop: "4px", wordBreak: "break-all" }}>{v}</div>
                        </div>
                    ))}
                </div>

                {/* Battery + Memory + CPU Cards */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "24px" }}>
                    {/* Battery */}
                    <div style={{ ...STYLES.statCard, background: `linear-gradient(135deg, rgba(${batteryLevel > 60 ? '52,199,89' : batteryLevel > 20 ? '255,159,10' : '255,59,48'},0.08), transparent)` }}>
                        <div style={STYLES.statLabel as any}>🔋 Battery</div>
                        <div style={{ ...STYLES.statValue, color: batteryColor }}>{battery["level"] || "--"}%</div>
                        <div style={{ width: "100%", height: "6px", backgroundColor: "rgba(0,0,0,0.08)", borderRadius: "3px", marginTop: "8px" }}>
                            <div style={{ width: `${batteryLevel}%`, height: "100%", backgroundColor: batteryColor, borderRadius: "3px", transition: "width 0.5s ease" }} />
                        </div>
                        <div style={{ fontSize: "11px", color: "#86868b", marginTop: "6px" }}>
                            {isCharging ? "⚡ Charging" : "🔌 Not Charging"} • {battery["temperature"] ? `${parseInt(battery["temperature"]) / 10}°C` : "--"}
                        </div>
                    </div>

                    {/* Memory */}
                    <div style={{ ...STYLES.statCard, background: "linear-gradient(135deg, rgba(90,200,250,0.08), transparent)" }}>
                        <div style={STYLES.statLabel as any}>🧠 Memory</div>
                        {packageFilter && mem.totalPss ? (
                            <>
                                <div style={STYLES.statValue}>{mem.totalPss} KB</div>
                                <div style={{ fontSize: "11px", color: "#86868b", marginTop: "4px" }}>PSS for {packageFilter.split(".").pop()}</div>
                            </>
                        ) : mem.memTotal ? (
                            <>
                                <div style={{ ...STYLES.statValue, fontSize: "16px" }}>{mem.memAvail || "--"}</div>
                                <div style={{ fontSize: "11px", color: "#86868b", marginTop: "4px" }}>Available of {mem.memTotal}</div>
                            </>
                        ) : (
                            <div style={{ ...STYLES.statValue, fontSize: "14px", color: "#86868b" }}>No data</div>
                        )}
                    </div>

                    {/* CPU */}
                    <div style={{ ...STYLES.statCard, background: "linear-gradient(135deg, rgba(175,82,222,0.08), transparent)" }}>
                        <div style={STYLES.statLabel as any}>⚙️ CPU</div>
                        <div style={{ fontSize: "12px", color: "#1d1d1f", fontFamily: "'SF Mono', Consolas, monospace", whiteSpace: "pre-wrap", maxHeight: "80px", overflow: "hidden", marginTop: "6px" }}>
                            {cpuRaw ? cpuRaw.split("\n").slice(0, 4).join("\n") : "No data"}
                        </div>
                    </div>
                </div>

                {/* Raw CPU output */}
                <div style={{ marginBottom: "16px" }}>
                    <div style={STYLES.cardTitle as any}>📋 Raw Process Info</div>
                    <div style={{
                        backgroundColor: "#1e1e1e", borderRadius: "10px", padding: "14px", color: "#e0e0e0",
                        fontFamily: "'SF Mono', Consolas, monospace", fontSize: "11px", lineHeight: "1.5",
                        maxHeight: "200px", overflowY: "auto", whiteSpace: "pre-wrap"
                    }}>
                        {cpuRaw || "Run a package-filtered scan to see process details here."}
                    </div>
                </div>
            </div>
            <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
        </div>
    );
}
