import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save, confirm } from "@tauri-apps/plugin-dialog";
import { STYLES } from "./styles";

interface FileEntry { name: string; is_dir: boolean; permissions: string; size: string; }
interface GalleryItem { path: string; name: string; isVideo: boolean; }

// Concurrency limiter for ADB thumbnail calls
const MAX_CONCURRENT = 3;
let activeCount = 0;
const pendingQueue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
    if (activeCount < MAX_CONCURRENT) {
        activeCount++;
        return Promise.resolve();
    }
    return new Promise(resolve => pendingQueue.push(resolve));
}

function releaseSlot() {
    activeCount--;
    if (pendingQueue.length > 0 && activeCount < MAX_CONCURRENT) {
        activeCount++;
        const next = pendingQueue.shift()!;
        next();
    }
}

// Lazy-loading gallery card with IntersectionObserver
function GalleryCard({ item, dev, onPreview, onSave, cache }: {
    item: GalleryItem; dev: string;
    onPreview: () => void; onSave: () => void;
    cache: React.MutableRefObject<Record<string, string>>;
}) {
    const [thumb, setThumb] = useState<string | null>(cache.current[item.path] || null);
    const [loading, setLoading] = useState(false);
    const [isVisible, setIsVisible] = useState(false);
    const loadAttemptedRef = useRef(false);
    const cardRef = useRef<HTMLDivElement>(null);
    const ext = item.name.split('.').pop()?.toLowerCase() || '';

    // IntersectionObserver for lazy loading — only load when visible
    useEffect(() => {
        const el = cardRef.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setIsVisible(true);
                    observer.unobserve(el);
                }
            },
            { rootMargin: "200px" } // start loading 200px before visible
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    // Load thumbnail only when visible and not already loaded
    useEffect(() => {
        if (!isVisible || item.isVideo || thumb) return;
        if (cache.current[item.path]) { setThumb(cache.current[item.path]); return; }
        if (loadAttemptedRef.current) return;
        loadAttemptedRef.current = true;

        setLoading(true);

        acquireSlot().then(() => {
            invoke<string>("get_media_thumbnail", { deviceId: dev, remotePath: item.path })
                .then(data => {
                    cache.current[item.path] = data;
                    setThumb(data);
                })
                .catch(() => { /* thumbnail load failed, show fallback */ })
                .finally(() => {
                    releaseSlot();
                    setLoading(false);
                });
        });
    }, [isVisible, item.path, item.isVideo, dev, cache, thumb]);

    return (
        <div ref={cardRef} style={{
            borderRadius: "12px", border: "1px solid rgba(0,0,0,0.08)", overflow: "hidden",
            cursor: "pointer", transition: "transform 0.15s, box-shadow 0.15s",
            backgroundColor: "#fff",
        }}
            onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.02)"; e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.12)"; }}
            onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "none"; }}
        >
            {/* Thumbnail */}
            <div
                style={{
                    height: "220px", display: "flex", justifyContent: "center", alignItems: "center",
                    position: "relative", overflow: "hidden",
                    background: thumb ? "#1a1a1a" : (item.isVideo
                        ? "linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
                        : "linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)"),
                }}
                onClick={onPreview}
            >
                {thumb ? (
                    <img src={thumb} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                ) : loading ? (
                    <div style={{ textAlign: "center" }}>
                        <div style={{
                            width: "24px", height: "24px", border: "3px solid rgba(0,0,0,0.1)",
                            borderTopColor: item.isVideo ? "#fff" : "#667eea",
                            borderRadius: "50%", margin: "0 auto 8px",
                            animation: "spin 0.8s linear infinite",
                        }} />
                        <div style={{ fontSize: "11px", color: item.isVideo ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.3)" }}>Loading...</div>
                    </div>
                ) : (
                    <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: "28px", color: item.isVideo ? "#fff" : "#555" }}>
                            {item.isVideo ? "▶" : "🖼️"}
                        </div>
                        <div style={{ fontSize: "10px", fontWeight: 600, color: item.isVideo ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.4)", textTransform: "uppercase", marginTop: "4px" }}>
                            .{ext}
                        </div>
                    </div>
                )}
                {item.isVideo && (
                    <div style={{
                        position: "absolute", bottom: "6px", right: "6px", backgroundColor: "rgba(0,0,0,0.6)",
                        color: "#fff", fontSize: "9px", fontWeight: 700, padding: "2px 6px", borderRadius: "4px",
                    }}>VIDEO</div>
                )}
            </div>
            {/* File info */}
            <div style={{ padding: "8px 10px" }}>
                <div style={{
                    fontSize: "11px", fontWeight: 600, color: "#1d1d1f",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    lineHeight: "16px", minHeight: "16px"
                }} title={item.name}>{item.name}</div>
                <div style={{ display: "flex", gap: "4px", marginTop: "6px" }}>
                    <button style={{ ...STYLES.button, padding: "3px 8px", fontSize: "10px", flex: 1 }} onClick={(e) => { e.stopPropagation(); onSave(); }}>Save</button>
                    {!item.isVideo && (
                        <button style={{ ...STYLES.buttonPrimary, padding: "3px 8px", fontSize: "10px" }} onClick={(e) => { e.stopPropagation(); onPreview(); }}>View</button>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function FileExplorer({ selectedDevices }: { selectedDevices: string[] }) {
    const [mode, setMode] = useState<"files" | "gallery">("files");
    const [currentPath, setCurrentPath] = useState("/sdcard");
    const [files, setFiles] = useState<FileEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [pathInput, setPathInput] = useState("/sdcard");

    // Gallery state
    const [gallery, setGallery] = useState<GalleryItem[]>([]);
    const [galleryLoading, setGalleryLoading] = useState(false);
    const [galleryFilter, setGalleryFilter] = useState<"all" | "photos" | "videos">("all");
    const [previewSrc, setPreviewSrc] = useState<string | null>(null);
    const [previewName, setPreviewName] = useState("");
    const [loadingPreview, setLoadingPreview] = useState(false);
    const thumbnailCache = useRef<Record<string, string>>({});

    const dev = selectedDevices.length > 0 ? selectedDevices[0] : null;

    const browse = useCallback(async (path: string) => {
        if (!dev) return;
        setLoading(true);
        setError("");
        try {
            const res = await invoke<string>("list_device_files", { deviceId: dev, path });
            const parsed: FileEntry[] = JSON.parse(res || "[]");
            setFiles(parsed);
            setCurrentPath(path);
            setPathInput(path);
        } catch (e: any) {
            setError(typeof e === "string" ? e : JSON.stringify(e));
            setFiles([]);
        }
        setLoading(false);
    }, [dev]);

    useEffect(() => {
        if (dev) browse("/sdcard");
    }, [dev, browse]);

    const navigateTo = (name: string) => {
        const newPath = currentPath === "/" ? `/${name}` : `${currentPath}/${name}`;
        browse(newPath);
    };

    const goUp = () => {
        const parts = currentPath.split("/").filter(Boolean);
        parts.pop();
        browse("/" + parts.join("/") || "/");
    };

    const pullFile = async (fileName: string) => {
        const remotePath = `${currentPath}/${fileName}`;
        const savePath = await save({ defaultPath: fileName });
        if (!savePath) return;
        try {
            const res = await invoke<string>("pull_file", { deviceId: dev, remotePath, localPath: savePath });
            alert(res);
        } catch (e: any) { alert("Error: " + (typeof e === "string" ? e : JSON.stringify(e))); }
    };

    const pushFile = async () => {
        const selected = await open({ multiple: false });
        if (!selected || typeof selected !== "string") return;
        const fileName = selected.split("/").pop() || "file";
        const remotePath = `${currentPath}/${fileName}`;
        try {
            const res = await invoke<string>("push_file", { deviceId: dev, localPath: selected, remotePath });
            alert(res);
            browse(currentPath);
        } catch (e: any) { alert("Error: " + (typeof e === "string" ? e : JSON.stringify(e))); }
    };

    const deleteFile = async (fileName: string) => {
        const yes = await confirm(`Delete ${fileName}?`, { kind: "warning" });
        if (!yes) return;
        const remotePath = `${currentPath}/${fileName}`;
        try {
            await invoke<string>("delete_device_file", { deviceId: dev, remotePath });
            browse(currentPath);
        } catch (e: any) { alert("Error: " + (typeof e === "string" ? e : JSON.stringify(e))); }
    };

    const loadGallery = useCallback(async () => {
        if (!dev) return;
        setGalleryLoading(true);
        try {
            const res = await invoke<string>("list_gallery", { deviceId: dev });
            setGallery(JSON.parse(res || "[]"));
        } catch (e: any) {
            setGallery([]);
            setError(typeof e === "string" ? e : JSON.stringify(e));
        }
        setGalleryLoading(false);
    }, [dev]);

    useEffect(() => {
        if (mode === "gallery") loadGallery();
    }, [mode, loadGallery]);

    const openPreview = async (item: GalleryItem) => {
        if (item.isVideo) {
            const savePath = await save({ defaultPath: item.name, filters: [{ name: "Video", extensions: ["mp4", "mkv", "mov"] }] });
            if (!savePath) return;
            try {
                const res = await invoke<string>("pull_file", { deviceId: dev, remotePath: item.path, localPath: savePath });
                alert(res);
            } catch (e: any) { alert("Error: " + (typeof e === "string" ? e : JSON.stringify(e))); }
            return;
        }
        // Check cache first
        if (thumbnailCache.current[item.path]) {
            setPreviewSrc(thumbnailCache.current[item.path]);
            setPreviewName(item.name);
            return;
        }
        setLoadingPreview(true);
        setPreviewName(item.name);
        setPreviewSrc(null);
        try {
            const data = await invoke<string>("get_media_thumbnail", { deviceId: dev, remotePath: item.path });
            thumbnailCache.current[item.path] = data;
            setPreviewSrc(data);
        } catch (e: any) {
            alert("Preview error: " + (typeof e === "string" ? e : JSON.stringify(e)));
        }
        setLoadingPreview(false);
    };

    const pullGalleryItem = async (item: GalleryItem) => {
        const savePath = await save({ defaultPath: item.name });
        if (!savePath) return;
        try {
            const res = await invoke<string>("pull_file", { deviceId: dev, remotePath: item.path, localPath: savePath });
            alert(res);
        } catch (e: any) { alert("Error: " + (typeof e === "string" ? e : JSON.stringify(e))); }
    };

    const filteredGallery = gallery.filter(g => {
        if (galleryFilter === "photos") return !g.isVideo;
        if (galleryFilter === "videos") return g.isVideo;
        return true;
    });

    const sorted = [...files].sort((a, b) => {
        if (a.is_dir && !b.is_dir) return -1;
        if (!a.is_dir && b.is_dir) return 1;
        return a.name.localeCompare(b.name);
    });

    if (!dev) return (
        <div style={{ ...STYLES.card, flex: 1, display: "flex", justifyContent: "center", alignItems: "center", color: "#86868b" }}>
            Connect a device to browse files
        </div>
    );

    return (
        <div style={{ ...STYLES.card, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            {/* Preview overlay */}
            {(previewSrc || loadingPreview) && (
                <div style={{
                    position: "fixed", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.7)",
                    backdropFilter: "blur(10px)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 9999,
                    flexDirection: "column", gap: "16px"
                }} onClick={() => { setPreviewSrc(null); setLoadingPreview(false); }}>
                    {loadingPreview ? (
                        <div style={{ color: "#fff", fontSize: "16px" }}>Loading preview...</div>
                    ) : previewSrc ? (
                        <>
                            <img src={previewSrc} alt={previewName} style={{ maxWidth: "85vw", maxHeight: "75vh", borderRadius: "12px", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }} onClick={e => e.stopPropagation()} />
                            <div style={{ color: "#fff", fontSize: "14px", fontWeight: 600 }}>{previewName}</div>
                            <div style={{ display: "flex", gap: "10px" }}>
                                <button style={{ ...STYLES.buttonPrimary, padding: "10px 20px" }} onClick={(e) => {
                                    e.stopPropagation();
                                    if (previewSrc) {
                                        fetch(previewSrc).then(r => r.blob()).then(blob => {
                                            navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
                                            alert("Copied to clipboard!");
                                        }).catch(() => alert("Clipboard copy failed"));
                                    }
                                }}>Copy to Clipboard</button>
                                <button style={{ ...STYLES.button, padding: "10px 20px", color: "#fff", borderColor: "rgba(255,255,255,0.3)" }} onClick={(e) => {
                                    e.stopPropagation();
                                    setPreviewSrc(null);
                                }}>Close</button>
                            </div>
                        </>
                    ) : null}
                </div>
            )}

            {/* Mode toggle */}
            <div style={{ display: "flex", gap: "4px", marginBottom: "12px", backgroundColor: "rgba(118,118,128,0.12)", padding: "3px", borderRadius: "8px", width: "fit-content" }}>
                {([["files", "File Browser"], ["gallery", "Gallery"]] as const).map(([id, label]) => (
                    <button key={id} onClick={() => setMode(id)} style={{
                        padding: "6px 16px", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer",
                        backgroundColor: mode === id ? "#fff" : "transparent", color: mode === id ? "#1d1d1f" : "#86868b",
                        boxShadow: mode === id ? "0 2px 6px rgba(0,0,0,0.1)" : "none", transition: "all 0.15s"
                    }}>{label}</button>
                ))}
            </div>

            {/* FILE BROWSER MODE */}
            {mode === "files" && (
                <>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "12px" }}>
                        <button style={STYLES.button} onClick={goUp}>Up</button>
                        <input value={pathInput} onChange={e => setPathInput(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && browse(pathInput)}
                            style={{ ...STYLES.input, fontFamily: "'SF Mono', Consolas, monospace", fontSize: "12px" }}
                            placeholder="/sdcard" />
                        <button style={STYLES.buttonPrimary} onClick={() => browse(pathInput)}>Go</button>
                        <div style={{ borderLeft: "1px solid #d2d2d7", height: "24px" }} />
                        <button style={STYLES.buttonSuccess} onClick={pushFile}>Push File</button>
                        <button style={STYLES.button} onClick={() => browse(currentPath)}>Refresh</button>
                    </div>
                    <div style={{ fontSize: "12px", color: "#86868b", marginBottom: "8px", fontFamily: "'SF Mono', monospace" }}>
                        <span style={{ cursor: "pointer", color: "#0071e3" }} onClick={() => browse("/")}>/</span>
                        {currentPath.split("/").filter(Boolean).map((part, i, arr) => (
                            <span key={i}>
                                <span style={{ cursor: "pointer", color: "#0071e3" }} onClick={() => browse("/" + arr.slice(0, i + 1).join("/"))}>{part}</span>
                                {i < arr.length - 1 && <span> / </span>}
                            </span>
                        ))}
                    </div>
                    {error && <div style={{ color: "#ff3b30", fontSize: "12px", marginBottom: "8px", padding: "8px", backgroundColor: "rgba(255,59,48,0.08)", borderRadius: "8px" }}>{error}</div>}
                    <div style={{ flex: 1, overflowY: "auto", borderRadius: "10px", border: "1px solid rgba(0,0,0,0.06)" }}>
                        {loading ? (
                            <div style={{ display: "flex", justifyContent: "center", padding: "40px", color: "#86868b" }}>Loading...</div>
                        ) : sorted.length === 0 ? (
                            <div style={{ display: "flex", justifyContent: "center", padding: "40px", color: "#86868b" }}>Empty directory</div>
                        ) : sorted.map((f, i) => (
                            <div key={f.name + i} style={{
                                display: "flex", alignItems: "center", padding: "8px 14px", gap: "10px",
                                borderBottom: "1px solid rgba(0,0,0,0.04)", cursor: f.is_dir ? "pointer" : "default",
                                transition: "background 0.1s", fontSize: "13px",
                            }}
                                onMouseEnter={e => (e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.03)")}
                                onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
                                onClick={() => f.is_dir && navigateTo(f.name)}
                            >
                                <span style={{ fontSize: "18px", width: "24px", textAlign: "center" }}>{f.is_dir ? "📁" : getFileIcon(f.name)}</span>
                                <span style={{ flex: 1, fontWeight: f.is_dir ? 600 : 400, color: f.is_dir ? "#0071e3" : "#1d1d1f" }}>{f.name}</span>
                                <span style={{ fontSize: "11px", color: "#86868b", fontFamily: "monospace" }}>{f.permissions}</span>
                                {!f.is_dir && <span style={{ fontSize: "11px", color: "#86868b", minWidth: "60px", textAlign: "right" }}>{formatSize(f.size)}</span>}
                                {!f.is_dir && <button style={{ ...STYLES.button, padding: "3px 8px", fontSize: "11px" }} onClick={(e) => { e.stopPropagation(); pullFile(f.name); }}>Pull</button>}
                                <button style={{ ...STYLES.buttonDanger, padding: "3px 8px", fontSize: "11px" }} onClick={(e) => { e.stopPropagation(); deleteFile(f.name); }}>✕</button>
                            </div>
                        ))}
                    </div>
                </>
            )}

            {/* GALLERY MODE */}
            {mode === "gallery" && (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "12px" }}>
                        <div style={{ display: "flex", gap: "4px", backgroundColor: "rgba(118,118,128,0.08)", padding: "3px", borderRadius: "8px" }}>
                            {([["all", "All"], ["photos", "Photos"], ["videos", "Videos"]] as const).map(([id, label]) => (
                                <button key={id} onClick={() => setGalleryFilter(id)} style={{
                                    padding: "4px 12px", border: "none", borderRadius: "6px", fontSize: "11px", fontWeight: 600, cursor: "pointer",
                                    backgroundColor: galleryFilter === id ? "#fff" : "transparent", color: galleryFilter === id ? "#1d1d1f" : "#86868b",
                                    boxShadow: galleryFilter === id ? "0 1px 4px rgba(0,0,0,0.1)" : "none"
                                }}>{label}</button>
                            ))}
                        </div>
                        <button style={STYLES.button} onClick={loadGallery}>Refresh</button>
                        <span style={{ fontSize: "12px", color: "#86868b" }}>{filteredGallery.length} items</span>
                    </div>
                    {galleryLoading ? (
                        <div style={{ display: "flex", justifyContent: "center", padding: "40px", color: "#86868b" }}>Scanning device for media...</div>
                    ) : filteredGallery.length === 0 ? (
                        <div style={{ display: "flex", justifyContent: "center", padding: "40px", color: "#86868b" }}>No media found</div>
                    ) : (
                        <div style={{
                            flex: 1, overflowY: "auto", padding: "4px",
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                            gridAutoRows: "min-content",
                            gap: "12px",
                            alignContent: "start",
                        }}>
                            {filteredGallery.map((item, i) => (
                                <GalleryCard key={item.path + i} item={item} dev={dev!}
                                    onPreview={() => openPreview(item)}
                                    onSave={() => pullGalleryItem(item)}
                                    cache={thumbnailCache}
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function getFileIcon(name: string) {
    const ext = name.split(".").pop()?.toLowerCase() || "";
    if (["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(ext)) return "🖼️";
    if (["mp4", "mkv", "avi", "mov", "3gp"].includes(ext)) return "🎬";
    if (["mp3", "ogg", "wav", "aac", "flac"].includes(ext)) return "🎵";
    if (ext === "apk") return "📦";
    if (["txt", "log", "json", "xml", "csv"].includes(ext)) return "📄";
    if (["zip", "tar", "gz", "rar"].includes(ext)) return "🗜️";
    if (["db", "sqlite"].includes(ext)) return "🗃️";
    return "📄";
}

function formatSize(s: string) {
    const n = parseInt(s);
    if (isNaN(n)) return s;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
