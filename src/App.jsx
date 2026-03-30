import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { getStatus, register, refreshAuth, listDocs, splitNotes } from "./api";

// --- Utility ---
const relTime = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const typeIcon = (ft) => {
  if (ft === "notebook") return { bg: "var(--color-background-success)", color: "var(--color-text-success)", label: "NB" };
  if (ft === "epub") return { bg: "var(--color-background-info)", color: "var(--color-text-info)", label: "EP" };
  return { bg: "var(--color-background-warning)", color: "var(--color-text-warning)", label: "PDF" };
};

// Normalize reMarkable API item to a consistent shape
function normalizeItem(item) {
  return {
    id: item.ID,
    visibleName: item.VissibleName || item.visibleName || "Untitled",
    parent: item.Parent || "",
    type: item.Type,
    lastModified: item.ModifiedClient || item.lastModified,
    hash: item.hash || "",
    blobUrl: item.BlobURLGet || "",
    version: item.Version || 1,
    // Guess file type from metadata (reMarkable API doesn't always expose this directly)
    fileType: item.fileType || "notebook",
    pages: item.pages || null,
  };
}

// --- Icons ---
const FolderIcon = ({ open }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
    {open ? (
      <path d="M1.5 3.5C1.5 2.95 1.95 2.5 2.5 2.5H6L7.5 4H13.5C14.05 4 14.5 4.45 14.5 5V5.5H3.5L1.5 12.5V3.5Z" fill="var(--color-text-secondary)" opacity="0.6" />
    ) : (
      <path d="M2 3C1.45 3 1 3.45 1 4V12C1 12.55 1.45 13 2 13H14C14.55 13 15 12.55 15 12V5C15 4.45 14.55 4 14 4H8L6.5 2.5H2Z" fill="var(--color-text-secondary)" opacity="0.5" />
    )}
  </svg>
);

const DocIcon = ({ fileType }) => {
  const t = typeIcon(fileType);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: 28, height: 28, borderRadius: "var(--border-radius-md)",
      background: t.bg, color: t.color, fontSize: 10, fontWeight: 500, flexShrink: 0,
    }}>
      {t.label}
    </span>
  );
};

const Badge = ({ children, variant = "default" }) => {
  const colors = {
    default: { bg: "var(--color-background-secondary)", color: "var(--color-text-secondary)" },
    info: { bg: "var(--color-background-info)", color: "var(--color-text-info)" },
    success: { bg: "var(--color-background-success)", color: "var(--color-text-success)" },
    warning: { bg: "var(--color-background-warning)", color: "var(--color-text-warning)" },
  };
  const c = colors[variant] || colors.default;
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: "var(--border-radius-md)",
      fontSize: 11, fontWeight: 500, background: c.bg, color: c.color,
    }}>
      {children}
    </span>
  );
};

const SplitIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M7 1V13M3 5L7 1L11 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M2 7H5M9 7H12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

// --- Registration Screen ---
function RegisterScreen({ onRegistered }) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await register(code);
      onRegistered();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      minHeight: "100vh", padding: 24,
    }}>
      <div style={{
        maxWidth: 400, width: "100%", padding: 32,
        background: "var(--color-background-primary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: "var(--border-radius-lg)",
      }}>
        <h1 style={{ fontSize: 22, margin: "0 0 8px", fontWeight: 600 }}>my.remarkable</h1>
        <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: "0 0 24px" }}>
          Connect your reMarkable tablet to get started.
        </p>
        <ol style={{ fontSize: 13, color: "var(--color-text-secondary)", paddingLeft: 20, margin: "0 0 20px", lineHeight: 1.8 }}>
          <li>Go to <strong>my.remarkable.com/device/browser/connect</strong></li>
          <li>Enter the one-time code shown there below</li>
        </ol>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Enter 8-letter code"
            maxLength={8}
            style={{
              width: "100%", padding: "10px 12px", fontSize: 16, textAlign: "center",
              letterSpacing: 4, fontFamily: "var(--font-mono)", textTransform: "lowercase",
              borderRadius: "var(--border-radius-md)",
              border: "1px solid var(--color-border-primary)",
              background: "var(--color-background-secondary)",
              color: "var(--color-text-primary)",
              marginBottom: 12, outline: "none",
            }}
          />
          <button
            type="submit"
            disabled={code.length < 8 || loading}
            style={{
              width: "100%", padding: "10px 0", fontSize: 14, fontWeight: 500,
              borderRadius: "var(--border-radius-md)", border: "none", cursor: "pointer",
              background: code.length >= 8 ? "var(--color-text-info)" : "var(--color-border-tertiary)",
              color: "#fff", opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? "Connecting..." : "Connect"}
          </button>
        </form>
        {error && (
          <p style={{ fontSize: 13, color: "var(--color-text-warning)", marginTop: 12 }}>{error}</p>
        )}
      </div>
    </div>
  );
}

// --- Main Library ---
export default function App() {
  const [authState, setAuthState] = useState("checking"); // checking | register | ready
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [currentFolder, setCurrentFolder] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDocs, setSelectedDocs] = useState(new Set());
  const [sortBy, setSortBy] = useState("lastModified");
  const [sortDir, setSortDir] = useState("desc");
  const [view, setView] = useState("grid");
  const [toast, setToast] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [splitting, setSplitting] = useState(null); // doc ID being split
  const searchRef = useRef(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Check auth status on mount
  useEffect(() => {
    getStatus()
      .then((s) => setAuthState(s.registered ? "ready" : "register"))
      .catch(() => setAuthState("register"));
  }, []);

  // Fetch docs when ready
  const fetchDocs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await listDocs();
      setItems(raw.map(normalizeItem));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authState === "ready") fetchDocs();
  }, [authState, fetchDocs]);

  // Keyboard shortcut
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const folders = useMemo(() => items.filter((i) => i.type === "CollectionType"), [items]);
  const docs = useMemo(() => items.filter((i) => i.type === "DocumentType"), [items]);

  // Build folder tree for sidebar
  const folderTree = useMemo(() => {
    const roots = folders.filter((f) => !f.parent);
    const getChildren = (parentId) =>
      folders
        .filter((f) => f.parent === parentId)
        .map((f) => ({ ...f, children: getChildren(f.id) }));
    return roots.map((f) => ({ ...f, children: getChildren(f.id) }));
  }, [folders]);

  // Breadcrumbs
  const breadcrumbs = useMemo(() => {
    const path = [{ id: null, visibleName: "My files" }];
    let fid = currentFolder;
    while (fid) {
      const folder = folders.find((f) => f.id === fid);
      if (folder) {
        path.splice(1, 0, folder);
        fid = folder.parent;
      } else break;
    }
    return path;
  }, [currentFolder, folders]);

  // Filter + sort current view
  const currentContent = useMemo(() => {
    let curFolders = folders.filter((f) => (f.parent || "") === (currentFolder || ""));
    let curDocs = docs.filter((d) => (d.parent || "") === (currentFolder || ""));

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      curFolders = folders.filter((f) => f.visibleName.toLowerCase().includes(q));
      curDocs = docs.filter((d) => d.visibleName.toLowerCase().includes(q));
    }

    const sortFn = (a, b) => {
      let va, vb;
      if (sortBy === "lastModified") {
        va = a.lastModified || "";
        vb = b.lastModified || "";
      } else {
        va = a.visibleName.toLowerCase();
        vb = b.visibleName.toLowerCase();
      }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    };

    return { folders: [...curFolders].sort(sortFn), docs: [...curDocs].sort(sortFn) };
  }, [currentFolder, searchQuery, sortBy, sortDir, folders, docs]);

  const totalItems = currentContent.folders.length + currentContent.docs.length;

  const toggleSelect = (id) => {
    setSelectedDocs((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSort = (field) => {
    if (sortBy === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(field);
      setSortDir(field === "name" ? "asc" : "desc");
    }
  };

  // Split notes handler
  const handleSplitNotes = async (doc) => {
    if (!confirm(`Split "${doc.visibleName}" into ${doc.pages || "multiple"} individual page notebooks?`)) return;
    setSplitting(doc.id);
    try {
      const result = await splitNotes(doc.id);
      showToast(`Split into ${result.count} notebooks!`);
      await fetchDocs(); // Refresh
    } catch (err) {
      showToast(`Split failed: ${err.message}`);
    } finally {
      setSplitting(null);
    }
  };

  // Stats
  const stats = useMemo(() => {
    const notebooks = docs.filter((d) => d.fileType === "notebook").length;
    const pdfs = docs.filter((d) => d.fileType === "pdf").length;
    const epubs = docs.filter((d) => d.fileType === "epub").length;
    return { total: docs.length, notebooks, pdfs, epubs, folders: folders.length };
  }, [docs, folders]);

  // Sidebar tree renderer
  const renderTree = (nodes, depth = 0) =>
    nodes.map((node) => (
      <div key={node.id}>
        <div
          onClick={() => {
            setCurrentFolder(node.id);
            setSearchQuery("");
            setSelectedDocs(new Set());
          }}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: `5px 8px 5px ${12 + depth * 16}px`,
            borderRadius: "var(--border-radius-md)", cursor: "pointer", fontSize: 13,
            background: currentFolder === node.id ? "var(--color-background-secondary)" : "transparent",
            color: currentFolder === node.id ? "var(--color-text-primary)" : "var(--color-text-secondary)",
            fontWeight: currentFolder === node.id ? 500 : 400,
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => {
            if (currentFolder !== node.id) e.currentTarget.style.background = "var(--color-background-secondary)";
          }}
          onMouseLeave={(e) => {
            if (currentFolder !== node.id) e.currentTarget.style.background = "transparent";
          }}
        >
          <FolderIcon open={currentFolder === node.id} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {node.visibleName}
          </span>
        </div>
        {node.children?.length > 0 && renderTree(node.children, depth + 1)}
      </div>
    ));

  // --- Auth gate ---
  if (authState === "checking") {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", color: "var(--color-text-secondary)", fontSize: 14 }}>
        Connecting...
      </div>
    );
  }
  if (authState === "register") {
    return <RegisterScreen onRegistered={() => setAuthState("ready")} />;
  }

  // --- Main library UI ---
  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "var(--font-sans)", color: "var(--color-text-primary)", position: "relative" }}>
      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 100,
          background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-info)",
          borderRadius: "var(--border-radius-md)", padding: "10px 20px", fontSize: 13,
          color: "var(--color-text-info)", fontWeight: 500, boxShadow: "0 2px 12px rgba(0,0,0,0.1)",
        }}>
          {toast}
        </div>
      )}

      {/* Sidebar */}
      {sidebarOpen && (
        <div style={{
          width: 220, flexShrink: 0,
          borderRight: "0.5px solid var(--color-border-tertiary)",
          padding: "16px 8px", display: "flex", flexDirection: "column", gap: 4,
          overflowY: "auto",
        }}>
          <div
            onClick={() => {
              setCurrentFolder(null);
              setSearchQuery("");
              setSelectedDocs(new Set());
            }}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "5px 8px",
              borderRadius: "var(--border-radius-md)", cursor: "pointer", fontSize: 13,
              background: currentFolder === null && !searchQuery ? "var(--color-background-secondary)" : "transparent",
              color: currentFolder === null ? "var(--color-text-primary)" : "var(--color-text-secondary)",
              fontWeight: currentFolder === null ? 500 : 400, marginBottom: 4,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 6L8 2L14 6V13C14 13.55 13.55 14 13 14H3C2.45 14 2 13.55 2 13V6Z" fill="var(--color-text-secondary)" opacity="0.5" />
            </svg>
            My files
          </div>
          {renderTree(folderTree)}

          <div style={{ marginTop: "auto", padding: "12px 8px", borderTop: "0.5px solid var(--color-border-tertiary)" }}>
            <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", lineHeight: 1.6 }}>
              {stats.total} documents, {stats.folders} folders
              <br />
              {stats.notebooks} notebooks, {stats.pdfs} PDFs, {stats.epubs} ePubs
            </div>
            <button
              onClick={fetchDocs}
              disabled={loading}
              style={{
                marginTop: 8, padding: "4px 10px", fontSize: 11, cursor: "pointer",
                background: "var(--color-background-secondary)",
                border: "0.5px solid var(--color-border-tertiary)",
                borderRadius: "var(--border-radius-md)",
                color: "var(--color-text-secondary)",
              }}
            >
              {loading ? "Syncing..." : "Sync"}
            </button>
          </div>
        </div>
      )}

      {/* Main content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Header bar */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "10px 16px",
          borderBottom: "0.5px solid var(--color-border-tertiary)",
          flexWrap: "wrap",
        }}>
          <button
            onClick={() => setSidebarOpen((p) => !p)}
            style={{
              background: "none", border: "none", cursor: "pointer", padding: 4,
              color: "var(--color-text-secondary)", display: "flex", alignItems: "center",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M2 4H16M2 9H16M2 14H16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>

          {/* Breadcrumbs */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, overflow: "hidden" }}>
            {breadcrumbs.map((b, i) => (
              <span key={b.id ?? "root"} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {i > 0 && <span style={{ color: "var(--color-text-tertiary)" }}>/</span>}
                <span
                  onClick={() => {
                    setCurrentFolder(b.id);
                    setSearchQuery("");
                  }}
                  style={{
                    cursor: "pointer",
                    color: i === breadcrumbs.length - 1 ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                    fontWeight: i === breadcrumbs.length - 1 ? 500 : 400,
                    whiteSpace: "nowrap",
                  }}
                >
                  {b.visibleName}
                </span>
              </span>
            ))}
          </div>

          <div style={{ flex: 1 }} />

          {/* Search */}
          <div style={{ position: "relative", width: 200 }}>
            <input
              ref={searchRef}
              type="text"
              placeholder="Search... (\u2318K)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: "100%", padding: "6px 10px 6px 28px", fontSize: 13,
                borderRadius: "var(--border-radius-md)",
                border: "0.5px solid var(--color-border-tertiary)",
                background: "var(--color-background-secondary)",
                color: "var(--color-text-primary)",
                outline: "none", boxSizing: "border-box",
              }}
            />
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
              <circle cx="6" cy="6" r="4.5" stroke="var(--color-text-tertiary)" strokeWidth="1.2" />
              <path d="M9.5 9.5L13 13" stroke="var(--color-text-tertiary)" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </div>

          {/* View toggle */}
          <div style={{ display: "flex", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-md)", overflow: "hidden" }}>
            {["grid", "list"].map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  padding: "5px 10px",
                  background: view === v ? "var(--color-background-secondary)" : "transparent",
                  border: "none", cursor: "pointer", fontSize: 12,
                  color: "var(--color-text-secondary)",
                }}
              >
                {v === "grid" ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <rect x="1" y="1" width="5" height="5" rx="1" fill="currentColor" />
                    <rect x="8" y="1" width="5" height="5" rx="1" fill="currentColor" />
                    <rect x="1" y="8" width="5" height="5" rx="1" fill="currentColor" />
                    <rect x="8" y="8" width="5" height="5" rx="1" fill="currentColor" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M1 3H13M1 7H13M1 11H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Toolbar */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "6px 16px", fontSize: 12, color: "var(--color-text-secondary)",
          borderBottom: "0.5px solid var(--color-border-tertiary)",
        }}>
          <span>
            {totalItems} item{totalItems !== 1 ? "s" : ""}
          </span>
          <span style={{ color: "var(--color-text-tertiary)" }}>|</span>
          <span style={{ cursor: "pointer" }} onClick={() => toggleSort("name")}>
            Name {sortBy === "name" ? (sortDir === "asc" ? "\u2191" : "\u2193") : ""}
          </span>
          <span style={{ cursor: "pointer" }} onClick={() => toggleSort("lastModified")}>
            Modified {sortBy === "lastModified" ? (sortDir === "asc" ? "\u2191" : "\u2193") : ""}
          </span>
          {selectedDocs.size > 0 && (
            <>
              <span style={{ color: "var(--color-text-tertiary)" }}>|</span>
              <span style={{ color: "var(--color-text-info)", fontWeight: 500 }}>
                {selectedDocs.size} selected
              </span>
              <button
                onClick={() => setSelectedDocs(new Set())}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: "var(--color-text-secondary)", fontSize: 12, padding: 0,
                }}
              >
                Clear
              </button>
            </>
          )}
        </div>

        {/* Error banner */}
        {error && (
          <div style={{
            padding: "10px 16px", fontSize: 13, background: "var(--color-background-danger)",
            color: "var(--color-text-warning)", borderBottom: "0.5px solid var(--color-border-tertiary)",
          }}>
            {error}
            <button
              onClick={fetchDocs}
              style={{
                marginLeft: 12, background: "none", border: "none", cursor: "pointer",
                color: "var(--color-text-info)", fontSize: 12, fontWeight: 500,
              }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Content */}
        <div style={{ flex: 1, padding: 16, overflowY: "auto" }}>
          {loading && items.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: "var(--color-text-tertiary)", fontSize: 14 }}>
              Loading your library...
            </div>
          ) : searchQuery ? (
            <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 12 }}>
              Results for &ldquo;<span style={{ fontWeight: 500, color: "var(--color-text-primary)" }}>{searchQuery}</span>&rdquo;
            </div>
          ) : null}

          {!loading && totalItems === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: "var(--color-text-tertiary)", fontSize: 14 }}>
              {searchQuery ? "No documents match your search." : "This folder is empty."}
            </div>
          ) : view === "grid" ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
              {/* Folders */}
              {currentContent.folders.map((f) => (
                <div
                  key={f.id}
                  onDoubleClick={() => {
                    setCurrentFolder(f.id);
                    setSearchQuery("");
                  }}
                  style={{
                    background: "var(--color-background-primary)",
                    border: "0.5px solid var(--color-border-tertiary)",
                    borderRadius: "var(--border-radius-lg)", padding: "14px 12px",
                    cursor: "pointer", transition: "border-color 0.15s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--color-border-secondary)")}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = "")}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <FolderIcon />
                    <Badge>Folder</Badge>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {f.visibleName}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 4 }}>
                    {relTime(f.lastModified)}
                  </div>
                </div>
              ))}
              {/* Documents */}
              {currentContent.docs.map((d) => {
                const sel = selectedDocs.has(d.id);
                const isSplitting = splitting === d.id;
                const canSplit = d.fileType === "notebook" && (d.pages === null || d.pages > 1);
                return (
                  <div
                    key={d.id}
                    onClick={() => toggleSelect(d.id)}
                    style={{
                      background: sel ? "var(--color-background-info)" : "var(--color-background-primary)",
                      border: sel ? "1.5px solid var(--color-border-info)" : "0.5px solid var(--color-border-tertiary)",
                      borderRadius: "var(--border-radius-lg)", padding: "14px 12px",
                      cursor: "pointer", transition: "border-color 0.15s, background 0.15s",
                      position: "relative",
                    }}
                    onMouseEnter={(e) => {
                      if (!sel) e.currentTarget.style.borderColor = "var(--color-border-secondary)";
                    }}
                    onMouseLeave={(e) => {
                      if (!sel) e.currentTarget.style.borderColor = "";
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <DocIcon fileType={d.fileType} />
                      <Badge variant={d.fileType === "notebook" ? "success" : d.fileType === "epub" ? "info" : "warning"}>
                        {d.pages ? `${d.pages}p` : d.fileType}
                      </Badge>
                      {canSplit && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSplitNotes(d);
                          }}
                          disabled={isSplitting}
                          title="Split into individual page notebooks"
                          style={{
                            marginLeft: "auto", background: "var(--color-background-secondary)",
                            border: "0.5px solid var(--color-border-tertiary)",
                            borderRadius: "var(--border-radius-sm)", padding: "3px 6px",
                            cursor: isSplitting ? "wait" : "pointer",
                            color: "var(--color-text-secondary)", display: "flex",
                            alignItems: "center", gap: 3, fontSize: 10, opacity: isSplitting ? 0.5 : 1,
                          }}
                        >
                          <SplitIcon />
                          {isSplitting ? "..." : "Split"}
                        </button>
                      )}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {d.visibleName}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 4 }}>
                      {relTime(d.lastModified)}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* List view */
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {currentContent.folders.map((f) => (
                <div
                  key={f.id}
                  onDoubleClick={() => {
                    setCurrentFolder(f.id);
                    setSearchQuery("");
                  }}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                    borderRadius: "var(--border-radius-md)", cursor: "pointer",
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-background-secondary)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <FolderIcon />
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{f.visibleName}</span>
                  <Badge>Folder</Badge>
                  <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", minWidth: 50, textAlign: "right" }}>
                    {relTime(f.lastModified)}
                  </span>
                </div>
              ))}
              {currentContent.docs.map((d) => {
                const sel = selectedDocs.has(d.id);
                const isSplitting = splitting === d.id;
                const canSplit = d.fileType === "notebook" && (d.pages === null || d.pages > 1);
                return (
                  <div
                    key={d.id}
                    onClick={() => toggleSelect(d.id)}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                      borderRadius: "var(--border-radius-md)", cursor: "pointer",
                      background: sel ? "var(--color-background-info)" : "transparent",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={(e) => {
                      if (!sel) e.currentTarget.style.background = "var(--color-background-secondary)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = sel ? "var(--color-background-info)" : "transparent";
                    }}
                  >
                    <DocIcon fileType={d.fileType} />
                    <span style={{ flex: 1, fontSize: 13, fontWeight: sel ? 500 : 400 }}>
                      {d.visibleName}
                    </span>
                    {canSplit && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSplitNotes(d);
                        }}
                        disabled={isSplitting}
                        title="Split into individual page notebooks"
                        style={{
                          background: "var(--color-background-secondary)",
                          border: "0.5px solid var(--color-border-tertiary)",
                          borderRadius: "var(--border-radius-sm)", padding: "3px 8px",
                          cursor: isSplitting ? "wait" : "pointer",
                          color: "var(--color-text-secondary)", display: "flex",
                          alignItems: "center", gap: 4, fontSize: 11,
                          opacity: isSplitting ? 0.5 : 1,
                        }}
                      >
                        <SplitIcon />
                        {isSplitting ? "Splitting..." : "Split Pages"}
                      </button>
                    )}
                    <Badge variant={d.fileType === "notebook" ? "success" : d.fileType === "epub" ? "info" : "warning"}>
                      {d.fileType}
                    </Badge>
                    <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", minWidth: 60, textAlign: "right" }}>
                      {d.pages ? `${d.pages}p` : ""}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", minWidth: 50, textAlign: "right" }}>
                      {relTime(d.lastModified)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
