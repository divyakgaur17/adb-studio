// ================= PREMIUM APPLE STYLE CSS ================= //
export const STYLES: Record<string, React.CSSProperties> = {
    container: {
        padding: "24px", display: "flex", flexDirection: "column", height: "100vh",
        boxSizing: "border-box", backgroundColor: "#f5f5f7",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif",
        overflow: "hidden"
    },
    card: {
        backgroundColor: "rgba(255, 255, 255, 0.7)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
        padding: "20px", borderRadius: "16px", boxShadow: "0 4px 14px rgba(0,0,0,0.04), 0 1px 4px rgba(0,0,0,0.02)",
        border: "1px solid rgba(255,255,255,0.4)"
    },
    cardTitle: {
        fontSize: "14px", fontWeight: 600, color: "#86868b", textTransform: "uppercase",
        letterSpacing: "0.5px", marginBottom: "16px"
    } as React.CSSProperties,
    row: {
        display: "flex", alignItems: "center", flexWrap: "wrap", gap: "10px", marginBottom: "12px"
    } as React.CSSProperties,
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
    label: { fontSize: "13px", color: "#1d1d1f", fontWeight: 500 },
    terminal: {
        flex: 1, backgroundColor: "#1e1e1e", border: "1px solid rgba(0,0,0,0.2)", borderRadius: "12px",
        overflow: "hidden", marginTop: "10px", boxShadow: "inset 0 2px 10px rgba(0,0,0,0.5), 0 4px 12px rgba(0,0,0,0.1)"
    },
    buildOverlay: {
        position: "fixed", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.4)",
        backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
        display: "flex", justifyContent: "center", alignItems: "center", zIndex: 9999
    } as React.CSSProperties,
    buildModal: {
        width: "70%", height: "70%", backgroundColor: "rgba(30,30,30,0.9)", backdropFilter: "blur(20px)",
        borderRadius: "16px", display: "flex", flexDirection: "column", overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 20px 40px rgba(0,0,0,0.3)"
    } as React.CSSProperties,
    buildHeader: {
        padding: "16px 20px", backgroundColor: "rgba(0,0,0,0.3)", borderBottom: "1px solid rgba(255,255,255,0.1)",
        display: "flex", justifyContent: "space-between", alignItems: "center"
    },
    buildLogsView: {
        flex: 1, padding: "20px", overflowY: "auto", color: "#f5f5f7", fontFamily: "'SF Mono', Consolas, monospace",
        fontSize: "13px", lineHeight: "1.6"
    } as React.CSSProperties,
    tabContainer: {
        display: "flex", gap: "4px", backgroundColor: "rgba(118,118,128,0.12)", padding: "4px", borderRadius: "10px", marginBottom: "20px", width: "fit-content"
    },
    tabButton: {
        padding: "8px 24px", border: "none", borderRadius: "8px", fontSize: "14px", fontWeight: 600, cursor: "pointer",
        backgroundColor: "transparent", color: "#86868b", transition: "all 0.2s ease"
    },
    tabButtonActive: {
        backgroundColor: "#fff", color: "#1d1d1f", boxShadow: "0 3px 8px rgba(0,0,0,0.12), 0 3px 1px rgba(0,0,0,0.04)"
    },
    // Mini stat card
    statCard: {
        backgroundColor: "rgba(255,255,255,0.9)", borderRadius: "12px", padding: "16px",
        border: "1px solid rgba(0,0,0,0.06)", flex: 1, minWidth: "140px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.04)"
    },
    statLabel: { fontSize: "11px", fontWeight: 600, color: "#86868b", textTransform: "uppercase", letterSpacing: "0.5px" } as React.CSSProperties,
    statValue: { fontSize: "22px", fontWeight: 700, color: "#1d1d1f", marginTop: "4px" },
};
