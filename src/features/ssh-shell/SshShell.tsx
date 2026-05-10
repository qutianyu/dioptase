import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  Edit3,
  Eye,
  EyeOff,
  File,
  FilePlus,
  Folder,
  FolderPlus,
  KeyRound,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  RefreshCw,
  Server,
  Square,
  Terminal as TerminalIcon,
  Trash2,
  Upload,
  X,
} from "lucide-react";

type SshConnection = {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  key_path: string;
};

type SshOutputEvent = {
  session_id: string;
  stream: string;
  data: string;
};

type SftpFile = {
  name: string;
  size: number;
  is_dir: boolean;
  modified: string;
  permissions: string;
};

const emptyConnection: SshConnection = {
  id: "",
  name: "",
  host: "",
  port: 22,
  username: "",
  password: "",
  key_path: "",
};

function formatSftpSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function SshShell() {
  const [connections, setConnections] = useState<SshConnection[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sftpSessionId, setSftpSessionId] = useState<string | null>(null);
  const [activeConnectionLabel, setActiveConnectionLabel] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);

  // Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modalForm, setModalForm] = useState<SshConnection>({ ...emptyConnection });
  const [showPassword, setShowPassword] = useState(false);

  // SFTP
  const [currentPath, setCurrentPath] = useState("/");
  const [files, setFiles] = useState<SftpFile[]>([]);
  const [sftpLoading, setSftpLoading] = useState(false);
  const [sftpError, setSftpError] = useState<string | null>(null);

  // Context menu
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; visible: boolean }>({
    x: 0,
    y: 0,
    visible: false,
  });

  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const pendingSessionIdRef = useRef<string | null>(null);
  const pendingTerminalOutputRef = useRef("");
  const startingSessionRef = useRef(false);

  const selectedConnection = useMemo(
    () => connections.find((c) => c.id === selectedId) || null,
    [connections, selectedId]
  );

  const loadConnections = async () => {
    try {
      const list = await invoke<SshConnection[]>("list_ssh_connections");
      setConnections(list);
      if (!selectedId && list[0]) {
        setSelectedId(list[0].id);
      }
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    loadConnections();
  }, []);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    const unlistenPromise = listen<SshOutputEvent>("ssh-output", (event) => {
      const activeId = sessionIdRef.current;
      const outputSessionId = event.payload.session_id;
      const shouldAccept =
        outputSessionId === activeId ||
        (!activeId && startingSessionRef.current);

      if (!shouldAccept) return;

      if (!activeId) {
        pendingSessionIdRef.current = outputSessionId;
      }

      const terminal = terminalRef.current;
      if (terminal) {
        terminal.write(event.payload.data);
      } else {
        pendingTerminalOutputRef.current += event.payload.data;
      }
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten()).catch(console.error);
    };
  }, []);

  useEffect(() => {
    if (!sessionId || !terminalContainerRef.current) return;

    const terminal = new XTerm({
      cursorBlink: true,
      convertEol: true,
      fontFamily: '"SF Mono", SFMono-Regular, ui-monospace, monospace',
      fontSize: 12,
      lineHeight: 1.35,
      theme: {
        background: "#090b10",
        foreground: "#d7e1ee",
        cursor: "#7ee787",
        selectionBackground: "#264f78",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalContainerRef.current);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    terminal.write(`Connected: ${activeConnectionLabel}\r\n`);
    if (pendingSessionIdRef.current === sessionId && pendingTerminalOutputRef.current) {
      terminal.write(pendingTerminalOutputRef.current);
      pendingTerminalOutputRef.current = "";
      pendingSessionIdRef.current = null;
    }

    const fitAndResize = () => {
      try {
        fitAddon.fit();
        invoke("resize_ssh_session", {
          sessionId,
          rows: terminal.rows,
          cols: terminal.cols,
        }).catch(console.error);
      } catch (e) {
        console.error(e);
      }
    };

    const resizeObserver = new ResizeObserver(fitAndResize);
    resizeObserver.observe(terminalContainerRef.current);
    const resizeTimer = window.setTimeout(fitAndResize, 0);

    const dataDisposable = terminal.onData((data) => {
      invoke("write_ssh_session", { sessionId, data }).catch((e) => {
        setError(String(e));
      });
    });

    terminal.focus();

    return () => {
      window.clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      dataDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId, activeConnectionLabel]);

  // ── Modal ──
  const openModal = (conn?: SshConnection) => {
    if (conn) {
      setEditingId(conn.id);
      setModalForm({ ...conn });
    } else {
      setEditingId(null);
      setModalForm({ ...emptyConnection });
    }
    setIsModalOpen(true);
    setShowPassword(false);
    setError(null);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
    setModalForm({ ...emptyConnection });
    setShowPassword(false);
  };

  const saveModal = async (event: FormEvent) => {
    event.preventDefault();
    if (!modalForm.host.trim() || !modalForm.username.trim()) return;
    setError(null);
    try {
      const saved = await invoke<SshConnection>("save_ssh_connection", {
        connection: { ...modalForm, id: editingId || "" },
      });
      closeModal();
      setSelectedId(saved.id);
      await loadConnections();
    } catch (e) {
      setError(String(e));
    }
  };

  const deleteConnection = async (id: string) => {
    if (!confirm("确认删除此 SSH 连接？")) return;
    try {
      await invoke("delete_ssh_connection", { id });
      if (selectedId === id) {
        setSelectedId("");
        setSessionId(null);
        setSftpSessionId(null);
        setActiveConnectionLabel("");
      }
      await loadConnections();
    } catch (e) {
      setError(String(e));
    }
  };

  // ── Session ──
  const startConnectionSession = async (connection: SshConnection) => {
    setConnecting(true);
    startingSessionRef.current = true;
    setError(null);
    setSessionId(null);
    setSftpSessionId(null);
    setActiveConnectionLabel(`${connection.username}@${connection.host}:${connection.port}`);
    pendingSessionIdRef.current = null;
    pendingTerminalOutputRef.current = "";
    setCurrentPath("/");
    setFiles([]);
    try {
      const id = await invoke<string>("start_ssh_session", { connection });
      setSessionId(id);
      try {
        const sftpId = await invoke<string>("sftp_start_session", { connection });
        setSftpSessionId(sftpId);
        await listSftpDir("/", sftpId);
      } catch (e) {
        setSftpError(String(e));
      }
    } catch (e) {
      setError(String(e));
    } finally {
      startingSessionRef.current = false;
      setConnecting(false);
    }
  };

  const connectFromSidebar = async (connection: SshConnection) => {
    if (connecting) return;
    setSelectedId(connection.id);
    await startConnectionSession(connection);
  };

  const stopSession = async () => {
    if (!sessionId) return;
    try {
      await invoke("stop_ssh_session", { sessionId });
      if (sftpSessionId) {
        await invoke("stop_sftp_session", { sessionId: sftpSessionId });
      }
      terminalRef.current?.write("\r\n[session closed]\r\n");
      setSessionId(null);
      setSftpSessionId(null);
      setActiveConnectionLabel("");
      setFiles([]);
    } catch (e) {
      setError(String(e));
    }
  };

  // ── SFTP ──
  const listSftpDir = async (path: string, sid?: string) => {
    const id = sid || sftpSessionId;
    if (!id) return;
    setSftpLoading(true);
    setSftpError(null);
    try {
      const list = await invoke<SftpFile[]>("sftp_list_dir", { sessionId: id, path });
      setFiles(list);
      setCurrentPath(path);
    } catch (e) {
      setSftpError(String(e));
    } finally {
      setSftpLoading(false);
    }
  };

  const navigateDir = (name: string) => {
    const next = currentPath.endsWith("/") ? `${currentPath}${name}` : `${currentPath}/${name}`;
    listSftpDir(next);
  };

  const navigateUp = () => {
    if (currentPath === "/") return;
    const parts = currentPath.replace(/\/$/, "").split("/");
    parts.pop();
    const next = parts.join("/") || "/";
    listSftpDir(next);
  };

  const sftpRemove = async (name: string, isDir: boolean) => {
    if (!sftpSessionId) return;
    const full = currentPath.endsWith("/") ? `${currentPath}${name}` : `${currentPath}/${name}`;
    if (!confirm(`确认删除 ${name}？`)) return;
    try {
      await invoke("sftp_remove", { sessionId: sftpSessionId, path: full, isDir });
      await listSftpDir(currentPath);
    } catch (e) {
      setSftpError(String(e));
    }
  };

  const sftpMkdir = async () => {
    if (!sftpSessionId) return;
    const name = prompt("输入新文件夹名称：");
    if (!name) return;
    const full = currentPath.endsWith("/") ? `${currentPath}${name}` : `${currentPath}/${name}`;
    try {
      await invoke("sftp_mkdir", { sessionId: sftpSessionId, path: full });
      await listSftpDir(currentPath);
    } catch (e) {
      setSftpError(String(e));
    }
  };

  const sftpCreateFile = async () => {
    if (!sftpSessionId) return;
    const name = prompt("输入新文件名称：");
    if (!name) return;
    const full = currentPath.endsWith("/") ? `${currentPath}${name}` : `${currentPath}/${name}`;
    try {
      await invoke("sftp_create_file", { sessionId: sftpSessionId, path: full });
      await listSftpDir(currentPath);
    } catch (e) {
      setSftpError(String(e));
    }
  };

  const sftpUpload = async () => {
    if (!sftpSessionId) return;
    try {
      const selected = await open({ multiple: false });
      if (!selected) return;
      const localPath = typeof selected === "string" ? selected : selected[0];
      const fileName = localPath.split(/[\\/]/).pop() || "upload";
      const remotePath = currentPath.endsWith("/") ? `${currentPath}${fileName}` : `${currentPath}/${fileName}`;
      await invoke("sftp_upload", { sessionId: sftpSessionId, localPath, remotePath });
      await listSftpDir(currentPath);
    } catch (e) {
      setSftpError(String(e));
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, visible: true });
  };

  const closeContextMenu = () => {
    setContextMenu((prev) => ({ ...prev, visible: false }));
  };

  useEffect(() => {
    if (!contextMenu.visible) return;
    const handleClick = () => closeContextMenu();
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, [contextMenu.visible]);

  const pathParts = useMemo(() => {
    if (currentPath === "/") return [{ label: "根目录", path: "/" }];
    const parts = currentPath.replace(/^\//, "").split("/");
    return [
      { label: "根目录", path: "/" },
      ...parts.map((p, i) => ({
        label: p,
        path: "/" + parts.slice(0, i + 1).join("/"),
      })),
    ];
  }, [currentPath]);

  return (
    <div className="ssh-shell page-content animate-fade-in" style={{ maxWidth: "none" }}>
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title-row">
            <div className="page-icon" style={{ background: "rgba(52, 199, 89, 0.12)" }}>
              <TerminalIcon size={18} color="#34c759" strokeWidth={2} />
            </div>
            <h2 className="page-title">SSH Shell</h2>
            <p className="page-subtitle">管理远程主机连接，运行 SSH 会话与 SFTP 文件管理</p>
          </div>
        </div>
      </div>

      <div className={`ssh-layout ${showSidebar ? "ssh-layout-with-sidebar" : "ssh-layout-full"}`}>
        {/* ── Sidebar ── */}
        {showSidebar ? (
          <aside className="ssh-sidebar panel">
            <div className="ssh-panel-header">
              <div className="flex items-center gap-2">
                <Server size={14} style={{ color: "var(--bg-button)" }} />
                <span className="section-label">连接</span>
                <span className="text-[10px] px-1.5 rounded-full font-medium" style={{ background: "var(--bg-input)", color: "var(--text-muted)" }}>
                  {connections.length}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => openModal()}
                  className="icon-action"
                  style={{ width: 26, height: 26 }}
                  title="新建连接"
                >
                  <Plus size={13} />
                </button>
                <button
                  onClick={() => setShowSidebar(false)}
                  className="icon-action"
                  style={{ width: 26, height: 26 }}
                  title="收起"
                >
                  <PanelLeftClose size={13} />
                </button>
              </div>
            </div>

            <div className="ssh-connection-list">
              {connections.length === 0 && (
                <div className="ssh-empty-state">
                  <Server size={28} />
                  <span>暂无 SSH 连接</span>
                  <button onClick={() => openModal()} className="btn-primary flex items-center gap-1.5 text-[12px] mt-2">
                    <Plus size={12} /> 新建连接
                  </button>
                </div>
              )}
              {connections.map((connection) => {
                const isSelected = selectedId === connection.id;
                const isActiveSession = sessionId !== null && activeConnectionLabel === `${connection.username}@${connection.host}:${connection.port}`;
                return (
                  <div
                    key={connection.id}
                    className={`ssh-connection-card ${isSelected ? "is-selected" : ""}`}
                  >
                    <button
                      className="ssh-connection-info"
                      onClick={() => setSelectedId(connection.id)}
                    >
                      <span className="ssh-connection-name">
                        {connection.name || connection.host}
                      </span>
                      <span className="ssh-connection-meta">
                        {connection.username}@{connection.host}:{connection.port}
                      </span>
                      {connection.key_path && (
                        <span className="text-[10px] flex items-center gap-1 mt-0.5" style={{ color: "var(--text-muted)" }}>
                          <KeyRound size={9} /> 密钥认证
                        </span>
                      )}
                    </button>
                    <div className="ssh-connection-actions">
                      <button
                        onClick={() => connectFromSidebar(connection)}
                        className="ssh-action-btn primary"
                        title={isActiveSession ? "已连接" : "连接"}
                        disabled={connecting || isActiveSession}
                      >
                        {connecting && isSelected ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                      </button>
                      <button
                        onClick={() => openModal(connection)}
                        className="ssh-action-btn"
                        title="编辑"
                      >
                        <Edit3 size={11} />
                      </button>
                      <button
                        onClick={() => deleteConnection(connection.id)}
                        className="ssh-action-btn danger"
                        title="删除"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>
        ) : (
          <div className="ssh-expand-strip" onClick={() => setShowSidebar(true)}>
            <PanelLeftOpen size={14} style={{ color: "var(--text-muted)" }} />
          </div>
        )}

        {/* ── Workspace ── */}
        <main className="ssh-workspace">
          {/* Toolbar */}
          <div className="ssh-toolbar">
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                {selectedConnection ? selectedConnection.name || selectedConnection.host : "选择一个 SSH 连接"}
              </div>
              <div className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
                {selectedConnection
                  ? `${selectedConnection.username}@${selectedConnection.host}:${selectedConnection.port}`
                  : "新建或选择一个连接以开始"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {sessionId && (
                <button className="btn-danger flex items-center gap-1.5" onClick={stopSession}>
                  <Square size={13} />
                  断开
                </button>
              )}
            </div>
          </div>

          {error && (
            <div className="ssh-error">
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}

          {/* Connected: Terminal + SFTP */}
          {sessionId ? (
            <div className="ssh-session-layout">
              {/* Terminal Panel */}
              <div className="ssh-terminal-panel" onClick={() => terminalRef.current?.focus()}>
                <div ref={terminalContainerRef} className="ssh-terminal" />
              </div>

              {/* SFTP Panel */}
              <div className="ssh-sftp-panel" onContextMenu={handleContextMenu}>
                <div className="ssh-sftp-toolbar">
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <button onClick={navigateUp} disabled={currentPath === "/"} className="icon-action" style={{ width: 26, height: 26 }} title="上级目录">
                      <ArrowLeft size={12} />
                    </button>
                    <div className="flex items-center gap-0.5 text-[11px] min-w-0 overflow-hidden">
                      {pathParts.map((part, i) => (
                        <span key={part.path} className="flex items-center gap-0.5">
                          {i > 0 && <ChevronRight size={10} style={{ color: "var(--text-muted)" }} />}
                          <button
                            onClick={() => listSftpDir(part.path)}
                            className="hover:opacity-70 transition-opacity truncate"
                            style={{ color: i === pathParts.length - 1 ? "var(--text-primary)" : "var(--text-secondary)" }}
                          >
                            {part.label}
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={sftpUpload} className="icon-action" style={{ width: 26, height: 26 }} title="上传文件" disabled={!sftpSessionId}>
                      <Upload size={11} />
                    </button>
                    <button onClick={() => listSftpDir(currentPath)} className="icon-action" style={{ width: 26, height: 26 }} title="刷新" disabled={!sftpSessionId}>
                      <RefreshCw size={11} />
                    </button>
                    <button onClick={sftpMkdir} className="icon-action" style={{ width: 26, height: 26 }} title="新建文件夹" disabled={!sftpSessionId}>
                      <Plus size={11} />
                    </button>
                  </div>
                </div>

                {sftpError && (
                  <div className="px-3 py-2 text-[11px]" style={{ color: "var(--bg-danger)", background: "rgba(255,59,48,0.04)" }}>
                    SFTP: {sftpError}
                  </div>
                )}

                <div className={`ssh-sftp-table ${!sftpSessionId && !sftpLoading ? "is-disabled" : ""}`}>
                  {/* Header */}
                  <div className="ssh-sftp-row header">
                    <span className="col-name">名称</span>
                    <span className="col-size">大小</span>
                    <span className="col-date">修改时间</span>
                    <span className="col-perm">权限</span>
                    <span className="col-action">操作</span>
                  </div>
                  {/* Rows */}
                  {!sftpSessionId && !sftpLoading ? (
                    <div className="ssh-sftp-empty">
                      <Folder size={20} style={{ opacity: 0.3 }} />
                      <span>SFTP 未连接</span>
                    </div>
                  ) : sftpLoading ? (
                    <div className="ssh-sftp-empty">
                      <Loader2 size={16} className="animate-spin" />
                      <span>加载中...</span>
                    </div>
                  ) : files.length === 0 ? (
                    <div className="ssh-sftp-empty">
                      <Folder size={20} style={{ opacity: 0.3 }} />
                      <span>空文件夹</span>
                    </div>
                  ) : (
                    files.map((file) => (
                      <div key={file.name} className="ssh-sftp-row">
                        <button
                          className="col-name flex items-center gap-1.5 text-left"
                          onClick={() => file.is_dir && navigateDir(file.name)}
                          disabled={!file.is_dir}
                          style={{ cursor: file.is_dir ? "pointer" : "default" }}
                        >
                          {file.is_dir ? (
                            <Folder size={13} style={{ color: "#ff9500" }} />
                          ) : (
                            <File size={13} style={{ color: "var(--text-muted)" }} />
                          )}
                          <span className="truncate">{file.name}</span>
                        </button>
                        <span className="col-size">{file.is_dir ? "—" : formatSftpSize(file.size)}</span>
                        <span className="col-date">{file.modified}</span>
                        <span className="col-perm">{file.permissions}</span>
                        <span className="col-action">
                          <button
                            onClick={() => sftpRemove(file.name, file.is_dir)}
                            className="icon-action danger"
                            style={{ width: 22, height: 22 }}
                            title="删除"
                          >
                            <Trash2 size={10} />
                          </button>
                        </span>
                      </div>
                    ))
                  )}
                </div>

                {/* Context Menu */}
                {contextMenu.visible && (
                  <div
                    className="ssh-context-menu"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                  >
                    <div className="ssh-context-menu-item" onClick={sftpCreateFile}>
                      <FilePlus size={13} style={{ color: "var(--text-muted)" }} />
                      <span>新建文件</span>
                    </div>
                    <div className="ssh-context-menu-item" onClick={sftpMkdir}>
                      <FolderPlus size={13} style={{ color: "var(--text-muted)" }} />
                      <span>新建目录</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Not connected */
            <div className="ssh-empty-workspace">
              <TerminalIcon size={48} style={{ color: "var(--text-muted)", opacity: 0.2 }} />
              <p style={{ color: "var(--text-muted)" }}>在左侧连接列表点击连接按钮开始会话</p>
              {connections.length === 0 && (
                <button onClick={() => openModal()} className="btn-primary flex items-center gap-1.5 text-[12px] mt-3">
                  <Plus size={12} /> 新建连接
                </button>
              )}
            </div>
          )}
        </main>
      </div>

      {/* ── Modal ── */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
                {editingId ? "编辑 SSH 连接" : "新建 SSH 连接"}
              </h3>
              <button onClick={closeModal} className="icon-action" style={{ width: 28, height: 28 }}>
                <X size={14} />
              </button>
            </div>

            <form onSubmit={saveModal} className="flex flex-col gap-3">
              <div>
                <label className="section-label block mb-1.5">名称</label>
                <input
                  className="macos-input text-[13px]"
                  placeholder="例如：生产服务器"
                  value={modalForm.name}
                  onChange={(e) => setModalForm({ ...modalForm, name: e.target.value })}
                />
              </div>
              <div>
                <label className="section-label block mb-1.5">Host <span style={{ color: "var(--bg-danger)" }}>*</span></label>
                <input
                  className="macos-input text-[13px]"
                  placeholder="例如：192.168.1.1 或 example.com"
                  value={modalForm.host}
                  onChange={(e) => setModalForm({ ...modalForm, host: e.target.value })}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="section-label block mb-1.5">用户名 <span style={{ color: "var(--bg-danger)" }}>*</span></label>
                  <input
                    className="macos-input text-[13px]"
                    placeholder="root"
                    value={modalForm.username}
                    onChange={(e) => setModalForm({ ...modalForm, username: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="section-label block mb-1.5">端口</label>
                  <input
                    className="macos-input text-[13px]"
                    type="number"
                    min={1}
                    max={65535}
                    value={modalForm.port}
                    onChange={(e) => setModalForm({ ...modalForm, port: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div>
                <label className="section-label block mb-1.5">密码</label>
                <div className="ssh-password-field">
                  <input
                    className="macos-input text-[13px]"
                    type={showPassword ? "text" : "password"}
                    placeholder="密码或私钥至少填一项"
                    value={modalForm.password}
                    onChange={(e) => setModalForm({ ...modalForm, password: e.target.value })}
                  />
                  <button
                    type="button"
                    className="ssh-password-toggle"
                    onClick={() => setShowPassword((value) => !value)}
                    title={showPassword ? "隐藏密码" : "显示密码"}
                    aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  >
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="section-label block mb-1.5">私钥路径</label>
                <input
                  className="macos-input text-[13px]"
                  placeholder="~/.ssh/id_rsa（可选）"
                  value={modalForm.key_path}
                  onChange={(e) => setModalForm({ ...modalForm, key_path: e.target.value })}
                />
              </div>

              <div className="flex items-center justify-end gap-2 mt-2">
                <button type="button" onClick={closeModal} className="btn-secondary text-[12px]">
                  取消
                </button>
                <button type="submit" className="btn-primary text-[12px]">
                  {editingId ? "保存修改" : "保存连接"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
