import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Globe,
  Send,
  Trash2,
  Plus,
  ChevronDown,
  Clock,
  AlertCircle,
  Upload,
  FileJson,
  List,
  FileText,
  Copy,
  Check,
  X,
  RotateCcw,
  HardDrive,
  Eye,
  History,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

type HttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
  time_ms: number;
};

type HistoryEntry = {
  id: string;
  timestamp: number;
  method: string;
  url: string;
  headers: { key: string; value: string }[];
  bodyType: string;
  body: string;
  formData: { key: string; value: string }[];
  fileName: string;
  responseStatus: number;
  responseTimeMs: number;
};

const STORAGE_KEY = "dioptase_http_history";
const MAX_HISTORY = 50;

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

const METHOD_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  GET:    { bg: "rgba(52, 199, 89, 0.12)",  text: "#34c759", border: "rgba(52, 199, 89, 0.25)" },
  POST:   { bg: "rgba(0, 122, 255, 0.12)",  text: "#007aff", border: "rgba(0, 122, 255, 0.25)" },
  PUT:    { bg: "rgba(255, 149, 0, 0.12)",  text: "#ff9500", border: "rgba(255, 149, 0, 0.25)" },
  PATCH:  { bg: "rgba(175, 82, 222, 0.12)", text: "#af52de", border: "rgba(175, 82, 222, 0.25)" },
  DELETE: { bg: "rgba(255, 59, 48, 0.12)",  text: "#ff3b30", border: "rgba(255, 59, 48, 0.25)" },
};

const BODY_TYPE_CT: Record<string, string> = {
  json: "application/json",
  form: "application/x-www-form-urlencoded",
  file: "application/octet-stream",
};

const BODY_TYPES = [
  { key: "json", label: "JSON", icon: FileJson },
  { key: "form", label: "Form", icon: List },
  { key: "file", label: "文件", icon: FileText },
];

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const pad = (n: number) => String(n).padStart(2, "0");
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  if (isToday) return time;
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${time}`;
}

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY)));
  } catch {}
}

function truncateUrl(url: string, max: number): string {
  if (url.length <= max) return url;
  try {
    const u = new URL(url);
    const path = u.pathname + u.search;
    const host = u.host;
    if (path.length > max - host.length - 5) {
      return host + path.slice(0, max - host.length - 5) + "...";
    }
    return url.slice(0, max) + "...";
  } catch {
    return url.slice(0, max) + "...";
  }
}

export default function HttpClient() {
  const [method, setMethod] = useState<string>("GET");
  const [url, setUrl] = useState("");
  const [body, setBody] = useState("");
  const [bodyType, setBodyType] = useState("json");
  const [headers, setHeaders] = useState<{ key: string; value: string }[]>([
    { key: "Content-Type", value: "application/json" },
  ]);
  const [formData, setFormData] = useState<{ key: string; value: string }[]>([
    { key: "", value: "" },
  ]);
  const [fileName, setFileName] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [response, setResponse] = useState<HttpResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"body" | "headers">("body");
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [showHistory, setShowHistory] = useState(true);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const historyListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    saveHistory(history);
  }, [history]);

  const addHeader = () => setHeaders([...headers, { key: "", value: "" }]);
  const removeHeader = (i: number) => setHeaders(headers.filter((_, idx) => idx !== i));
  const updateHeader = (i: number, field: "key" | "value", val: string) => {
    const updated = [...headers];
    updated[i][field] = val;
    setHeaders(updated);
  };

  const addFormData = () => setFormData([...formData, { key: "", value: "" }]);
  const removeFormData = (i: number) => setFormData(formData.filter((_, idx) => idx !== i));
  const updateFormData = (i: number, field: "key" | "value", val: string) => {
    const updated = [...formData];
    updated[i][field] = val;
    setFormData(updated);
  };

  const updateBodyType = (nextType: string) => {
    setBodyType(nextType);
    const ct = BODY_TYPE_CT[nextType];
    setHeaders((prev) => {
      const withoutContentType = prev.filter((h) => h.key.toLowerCase() !== "content-type");
      if (!ct) return withoutContentType;
      return [{ key: "Content-Type", value: ct }, ...withoutContentType];
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setFileContent(reader.result as string);
    reader.readAsText(file);
  };

  const sendRequest = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setResponse(null);
    try {
      const hdrs: Record<string, string> = {};
      headers.forEach((h) => {
        if (h.key.trim()) hdrs[h.key] = h.value;
      });

      let reqBody = "";
      if (bodyType === "json") {
        reqBody = body;
      } else if (bodyType === "form") {
        const params = new URLSearchParams();
        formData.forEach((f) => {
          if (f.key.trim()) params.append(f.key, f.value);
        });
        reqBody = params.toString();
      } else if (bodyType === "file") {
        reqBody = fileContent;
      } else {
        reqBody = body;
      }

      const res = await invoke<HttpResponse>("send_http_request", {
        method,
        url,
        headers: hdrs,
        body: reqBody,
      });
      setResponse(res);

      const entry: HistoryEntry = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        timestamp: Date.now(),
        method,
        url,
        headers: headers.filter((h) => h.key.trim()),
        bodyType,
        body,
        formData: formData.filter((f) => f.key.trim()),
        fileName,
        responseStatus: res.status,
        responseTimeMs: res.time_ms,
      };
      setHistory((prev) => [entry, ...prev].slice(0, MAX_HISTORY));
      setSelectedHistoryId(entry.id);
    } catch (e) {
      setError(String(e));
      const entry: HistoryEntry = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        timestamp: Date.now(),
        method,
        url,
        headers: headers.filter((h) => h.key.trim()),
        bodyType,
        body,
        formData: formData.filter((f) => f.key.trim()),
        fileName,
        responseStatus: 0,
        responseTimeMs: 0,
      };
      setHistory((prev) => [entry, ...prev].slice(0, MAX_HISTORY));
      setSelectedHistoryId(entry.id);
    } finally {
      setLoading(false);
    }
  };

  const loadFromHistory = useCallback((entry: HistoryEntry) => {
    setMethod(entry.method);
    setUrl(entry.url);
    setHeaders(entry.headers.length > 0 ? entry.headers : [{ key: "Content-Type", value: "application/json" }]);
    setBodyType(entry.bodyType);
    setBody(entry.body);
    setFormData(entry.formData.length > 0 ? entry.formData : [{ key: "", value: "" }]);
    setFileName(entry.fileName || "");
    setResponse(null);
    setError(null);
    setSelectedHistoryId(entry.id);
  }, []);

  const deleteHistoryEntry = (id: string) => {
    setHistory((prev) => prev.filter((e) => e.id !== id));
    if (selectedHistoryId === id) setSelectedHistoryId(null);
  };

  const clearHistory = () => {
    setHistory([]);
    setSelectedHistoryId(null);
  };

  const formatJson = (text: string): string => {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  };

  const handleCopy = async () => {
    if (!response?.body) return;
    await navigator.clipboard.writeText(response.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const clearResponse = () => {
    setResponse(null);
    setError(null);
  };

  const statusOk = response ? response.status < 400 : false;
  const statusColor = statusOk ? "var(--bg-success)" : "var(--bg-danger)";
  const bodySize = response ? formatBytes(new Blob([response.body]).size) : "";

  return (
    <div className="page-content animate-fade-in" style={{ maxWidth: "none" }}>
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title-row">
            <div className="page-icon" style={{ background: "rgba(0, 122, 255, 0.12)" }}>
              <Globe size={18} color="#007aff" strokeWidth={2} />
            </div>
            <h2 className="page-title">HTTP 客户端</h2>
            <p className="page-subtitle">发送 HTTP 请求并查看响应</p>
          </div>
        </div>
      </div>

      <div className={`http-layout ${showHistory ? "http-layout-with-sidebar" : "http-layout-full"}`}>
        {/* History Sidebar or Expand Strip */}
        {showHistory ? (
          <div className="http-history-sidebar">
            <div className="http-history-header">
              <div className="flex items-center gap-2">
                <History size={13} style={{ color: "var(--text-muted)" }} />
                <span className="text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>
                  历史记录
                </span>
                {history.length > 0 && (
                  <span className="text-[10px] px-1.5 py-0 rounded-full font-medium" style={{ background: "var(--bg-input)", color: "var(--text-muted)" }}>
                    {history.length}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {history.length > 0 && (
                  <button onClick={clearHistory} className="text-[10px] hover:opacity-70 transition-opacity" style={{ color: "var(--text-muted)" }}>
                    清空
                  </button>
                )}
                <button
                  onClick={() => setShowHistory(false)}
                  className="icon-action"
                  style={{ width: 26, height: 26 }}
                  title="隐藏历史"
                >
                  <PanelLeftClose size={13} />
                </button>
              </div>
            </div>
            <div className="http-history-list" ref={historyListRef}>
              {history.length === 0 ? (
                <div className="http-history-empty">
                  <Globe size={20} style={{ color: "var(--text-muted)", opacity: 0.3 }} />
                  <p>暂无请求记录</p>
                </div>
              ) : (
                history.map((entry) => {
                  const isSelected = selectedHistoryId === entry.id;
                  const entryOk = entry.responseStatus > 0 && entry.responseStatus < 400;
                  return (
                    <div
                      key={entry.id}
                      onClick={() => loadFromHistory(entry)}
                      className={`http-history-item ${isSelected ? "is-selected" : ""}`}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === "Enter") loadFromHistory(entry); }}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className="text-[10px] font-bold px-1.5 py-0 rounded"
                          style={{ background: METHOD_COLORS[entry.method]?.bg, color: METHOD_COLORS[entry.method]?.text }}
                        >
                          {entry.method}
                        </span>
                        {entry.responseStatus > 0 && (
                          <span className="text-[10px] font-semibold" style={{ color: entryOk ? "var(--bg-success)" : "var(--bg-danger)" }}>
                            {entry.responseStatus}
                          </span>
                        )}
                        <span className="text-[10px] ml-auto" style={{ color: "var(--text-muted)" }}>
                          {entry.responseTimeMs > 0 ? `${entry.responseTimeMs}ms` : ""}
                        </span>
                      </div>
                      <div className="http-history-url text-[11px]" style={{ color: "var(--text-primary)" }}>
                        {truncateUrl(entry.url, 36)}
                      </div>
                      <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                        {formatTime(entry.timestamp)}
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteHistoryEntry(entry.id); }}
                        className="http-history-delete"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          <div className="http-expand-strip" onClick={() => setShowHistory(true)}>
            <PanelLeftOpen size={14} style={{ color: "var(--text-muted)" }} />
          </div>
        )}

        {/* Main Content */}
        <div className="http-main">
          {/* URL Bar Card */}
          <div className="panel mb-4" style={{ padding: "14px 16px" }}>
            <div className="http-url-bar flex gap-2 items-stretch">
              <div className="relative">
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  className="appearance-none pr-7 font-bold text-[13px] tracking-wide h-full"
                  style={{
                    background: METHOD_COLORS[method]?.bg || "var(--bg-input)",
                    color: METHOD_COLORS[method]?.text || "var(--text-primary)",
                    border: `1.5px solid ${METHOD_COLORS[method]?.border || "var(--border-color)"}`,
                    borderRadius: "var(--radius-md)",
                    padding: "0 28px 0 12px",
                    cursor: "pointer",
                    minWidth: 88,
                  }}
                >
                  {METHODS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <ChevronDown
                  size={13}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: METHOD_COLORS[method]?.text || "var(--text-primary)" }}
                />
              </div>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !loading) sendRequest(); }}
                className="macos-input flex-1 font-mono text-[13px]"
                placeholder="输入 URL，例如 https://api.example.com/users"
                spellCheck={false}
                style={{ minHeight: 40 }}
              />
              <button
                onClick={sendRequest}
                disabled={loading || !url.trim()}
                className="btn-primary flex items-center gap-1.5 shrink-0 font-semibold"
                style={{ minHeight: 40, padding: "0 18px" }}
              >
                <Send size={14} />
                {loading ? "发送中..." : "发送"}
              </button>
            </div>
          </div>

          {/* Request Body & Headers */}
          <div className="panel panel-pad mb-4">
            {/* Headers */}
            <div className="mb-5">
              <div className="flex items-center justify-between mb-2.5">
                <label className="section-label">请求头 (Headers)</label>
                <button
                  onClick={addHeader}
                  className="text-[11px] flex items-center gap-1 hover:opacity-70 transition-opacity font-medium"
                  style={{ color: "var(--bg-button)" }}
                >
                  <Plus size={12} strokeWidth={2.5} /> 添加
                </button>
              </div>
              {headers.length > 0 ? (
                <div className="border rounded-lg overflow-hidden" style={{ borderColor: "var(--border-color)" }}>
                  {headers.map((h, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2"
                      style={{
                        padding: "6px 10px",
                        borderBottom: i < headers.length - 1 ? "1px solid var(--border-color)" : "none",
                        background: i % 2 === 0 ? "transparent" : "rgba(127,127,127,0.02)",
                      }}
                    >
                      <input
                        value={h.key}
                        onChange={(e) => updateHeader(i, "key", e.target.value)}
                        className="macos-input font-mono text-[12px]"
                        placeholder="Header"
                        spellCheck={false}
                        style={{ minHeight: 30, padding: "4px 8px", flex: "0 0 35%" }}
                      />
                      <input
                        value={h.value}
                        onChange={(e) => updateHeader(i, "value", e.target.value)}
                        className="macos-input font-mono text-[12px]"
                        placeholder="Value"
                        spellCheck={false}
                        style={{ minHeight: 30, padding: "4px 8px", flex: 1 }}
                      />
                      <button onClick={() => removeHeader(i)} className="icon-action shrink-0" style={{ width: 28, height: 28, color: "var(--bg-danger)" }} title="删除">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <button
                  onClick={addHeader}
                  className="w-full text-center py-5 rounded-lg border border-dashed transition-colors hover:opacity-80"
                  style={{ borderColor: "var(--border-color)", color: "var(--text-muted)", fontSize: 12 }}
                >
                  <Plus size={14} className="inline mr-1" /> 添加请求头
                </button>
              )}
            </div>

            {/* Body */}
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <label className="section-label">请求体 (Body)</label>
                <div className="flex items-center gap-0.5 p-0.5 rounded-lg" style={{ background: "var(--bg-input)" }}>
                  {BODY_TYPES.map(({ key, label, icon: Icon }) => (
                    <button
                      key={key}
                      onClick={() => updateBodyType(key)}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all"
                      style={{
                        background: bodyType === key ? "var(--bg-card)" : "transparent",
                        color: bodyType === key ? "var(--text-primary)" : "var(--text-muted)",
                        boxShadow: bodyType === key ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                      }}
                    >
                      <Icon size={11} />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {bodyType === "json" && (
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="macos-input font-mono text-[13px] resize-none"
                  placeholder={'{\n  "key": "value"\n}'}
                  spellCheck={false}
                  style={{ minHeight: 160, lineHeight: 1.6 }}
                />
              )}

              {bodyType === "form" && (
                <div>
                  <div className="border rounded-lg overflow-hidden" style={{ borderColor: "var(--border-color)" }}>
                    {formData.map((f, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2"
                        style={{
                          padding: "6px 10px",
                          borderBottom: i < formData.length - 1 ? "1px solid var(--border-color)" : "none",
                          background: i % 2 === 0 ? "transparent" : "rgba(127,127,127,0.02)",
                        }}
                      >
                        <input value={f.key} onChange={(e) => updateFormData(i, "key", e.target.value)} className="macos-input font-mono text-[12px]" placeholder="Key" spellCheck={false} style={{ minHeight: 30, padding: "4px 8px", flex: "0 0 35%" }} />
                        <input value={f.value} onChange={(e) => updateFormData(i, "value", e.target.value)} className="macos-input font-mono text-[12px]" placeholder="Value" spellCheck={false} style={{ minHeight: 30, padding: "4px 8px", flex: 1 }} />
                        <button onClick={() => removeFormData(i)} className="icon-action shrink-0" style={{ width: 28, height: 28, color: "var(--bg-danger)" }} title="删除"><Trash2 size={12} /></button>
                      </div>
                    ))}
                  </div>
                  <button onClick={addFormData} className="mt-2 text-[11px] flex items-center gap-1 hover:opacity-70 transition-opacity font-medium" style={{ color: "var(--bg-button)" }}>
                    <Plus size={12} strokeWidth={2.5} /> 添加字段
                  </button>
                </div>
              )}

              {bodyType === "file" && (
                <div>
                  <input ref={fileInputRef} type="file" onChange={handleFileChange} className="hidden" />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed transition-all"
                    style={{
                      borderColor: fileName ? "var(--bg-button)" : "var(--border-color)",
                      background: fileName ? "rgba(0,122,255,0.03)" : "transparent",
                      minHeight: 100,
                      padding: "20px",
                    }}
                  >
                    <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: fileName ? "rgba(0,122,255,0.1)" : "var(--bg-input)" }}>
                      <Upload size={18} style={{ color: fileName ? "var(--bg-button)" : "var(--text-muted)" }} />
                    </div>
                    <span className="text-[13px] font-medium" style={{ color: fileName ? "var(--text-primary)" : "var(--text-muted)" }}>
                      {fileName || "点击选择文件"}
                    </span>
                    {fileName && <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>点击更换文件</span>}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="panel p-4 mb-4 animate-fade-in flex items-start gap-3" style={{ borderColor: "rgba(255, 59, 48, 0.2)", background: "rgba(255, 59, 48, 0.04)" }}>
              <AlertCircle size={16} className="shrink-0 mt-0.5" style={{ color: "var(--bg-danger)" }} />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium" style={{ color: "var(--bg-danger)" }}>请求失败</p>
                <p className="text-[12px] mt-0.5 break-all" style={{ color: "var(--text-secondary)" }}>{error}</p>
              </div>
              <button onClick={() => setError(null)} className="icon-action shrink-0" style={{ width: 26, height: 26 }}><X size={13} /></button>
            </div>
          )}

          {/* Response */}
          {response && (
            <div className="panel p-0 overflow-hidden animate-fade-in">
              <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--border-color)", background: "rgba(127,127,127,0.02)" }}>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 px-3 py-1 rounded-lg" style={{ background: statusOk ? "rgba(52,199,89,0.1)" : "rgba(255,59,48,0.1)" }}>
                    <span className="w-2 h-2 rounded-full" style={{ background: statusColor }} />
                    <span className="text-[13px] font-bold" style={{ color: statusColor }}>{response.status}</span>
                    <span className="text-[11px] font-medium" style={{ color: statusOk ? "#34c759" : "#ff3b30", opacity: 0.7 }}>{statusOk ? "OK" : "Error"}</span>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: METHOD_COLORS[method]?.bg, color: METHOD_COLORS[method]?.text }}>{method}</span>
                  <div className="flex items-center gap-1">
                    <Clock size={12} style={{ color: "var(--text-muted)" }} />
                    <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>{response.time_ms}ms</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <HardDrive size={12} style={{ color: "var(--text-muted)" }} />
                    <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>{bodySize}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={handleCopy} className="icon-action" style={{ width: 28, height: 28 }} title={copied ? "已复制" : "复制响应体"}>
                    {copied ? <Check size={13} style={{ color: "var(--bg-success)" }} /> : <Copy size={13} />}
                  </button>
                  <button onClick={clearResponse} className="icon-action" style={{ width: 28, height: 28 }} title="清除"><RotateCcw size={13} /></button>
                </div>
              </div>

              <div className="flex border-b" style={{ borderColor: "var(--border-color)" }}>
                {(["body", "headers"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className="flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium transition-colors relative"
                    style={{ color: activeTab === tab ? "var(--text-primary)" : "var(--text-muted)" }}
                  >
                    {tab === "body" ? <Eye size={13} /> : <List size={13} />}
                    {tab === "body" ? "响应体" : "响应头"}
                    {tab === "body" && <span className="text-[10px] px-1.5 py-0 rounded-full font-semibold" style={{ background: activeTab === tab ? "var(--bg-input)" : "transparent", color: "var(--text-muted)" }}>{bodySize}</span>}
                    {tab === "headers" && <span className="text-[10px] px-1.5 py-0 rounded-full font-semibold" style={{ background: activeTab === tab ? "var(--bg-input)" : "transparent", color: "var(--text-muted)" }}>{Object.keys(response.headers).length}</span>}
                    {activeTab === tab && <div className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full" style={{ background: "var(--bg-button)" }} />}
                  </button>
                ))}
              </div>

              <div className="p-4">
                {activeTab === "body" ? (
                  <pre className="code-block text-[13px]" style={{ color: "var(--text-primary)", maxHeight: 480 }}>{formatJson(response.body)}</pre>
                ) : (
                  <div className="border rounded-lg overflow-hidden" style={{ borderColor: "var(--border-color)" }}>
                    {Object.entries(response.headers).map(([key, value], i, arr) => (
                      <div key={key} className="flex gap-3 text-[13px]" style={{ padding: "7px 12px", borderBottom: i < arr.length - 1 ? "1px solid var(--border-color)" : "none", background: i % 2 === 0 ? "transparent" : "rgba(127,127,127,0.02)" }}>
                        <span className="font-mono font-semibold w-44 shrink-0" style={{ color: "var(--text-secondary)" }}>{key}</span>
                        <span className="font-mono break-all" style={{ color: "var(--text-primary)" }}>{value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}