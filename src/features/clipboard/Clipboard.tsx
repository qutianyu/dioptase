import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ClipboardList,
  Trash2,
  Copy,
  Type,
  FileText,
  Pin,
  PinOff,
  Settings2,
} from "lucide-react";

type ClipboardItem = {
  id: string;
  content: string;
  content_type: string;
  timestamp: number;
  pinned: boolean;
};

export default function Clipboard() {
  const [items, setItems] = useState<ClipboardItem[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [maxItems, setMaxItems] = useState(50);
  const [maxItemsDraft, setMaxItemsDraft] = useState("50");

  const fetchItems = async () => {
    try {
      const list = await invoke<ClipboardItem[]>("get_clipboard_items");
      setItems(list);
    } catch (e) {
      console.error(e);
    }
  };

  const clearItems = async () => {
    try {
      await invoke("clear_clipboard_items");
      setItems([]);
    } catch (e) {
      console.error(e);
    }
  };

  const deleteItem = async (id: string) => {
    try {
      await invoke("delete_clipboard_item", { id });
      setItems((prev) => prev.filter((item) => item.id !== id));
    } catch (e) {
      console.error(e);
    }
  };

  const togglePin = async (item: ClipboardItem) => {
    try {
      const list = await invoke<ClipboardItem[]>("toggle_clipboard_item_pin", {
        id: item.id,
        pinned: !item.pinned,
      });
      setItems(list);
    } catch (e) {
      console.error(e);
    }
  };

  const updateMaxItems = async (value: string) => {
    const parsed = Number(value);
    const next = Number.isFinite(parsed) ? Math.max(1, Math.min(500, Math.trunc(parsed))) : maxItems;
    setMaxItems(next);
    setMaxItemsDraft(String(next));
    try {
      const list = await invoke<ClipboardItem[]>("set_clipboard_max_items", { maxItems: next });
      setItems(list);
    } catch (e) {
      console.error(e);
    }
  };

  const writeItem = async (item: ClipboardItem) => {
    try {
      if (item.content_type.startsWith("image/")) {
        await invoke("write_clipboard_item", { content: item.content, contentType: item.content_type });
      } else {
        await invoke("write_clipboard", { content: item.content });
      }
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    invoke("start_clipboard_watch").catch(console.error);
    invoke<number>("get_clipboard_config").then((value) => {
      setMaxItems(value);
      setMaxItemsDraft(String(value));
    }).catch(console.error);
    fetchItems();
    const interval = setInterval(fetchItems, 1000);
    return () => clearInterval(interval);
  }, []);

  const pinnedCount = items.filter((item) => item.pinned).length;
  const unpinnedCount = items.length - pinnedCount;

  return (
    <div className="page-content animate-fade-in">
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title-row">
            <div className="page-icon" style={{ background: "rgba(0, 122, 255, 0.12)" }}>
              <ClipboardList size={18} color="#007aff" strokeWidth={2} />
            </div>
            <h2 className="page-title">
              剪贴板管理
            </h2>
            <p className="page-subtitle">
              监控剪贴板变化，记录历史内容
            </p>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="toolbar-panel clipboard-toolbar flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full animate-pulse-slow" style={{ background: "var(--bg-success)" }} />
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            常驻监听 · {pinnedCount} 条置顶 · {unpinnedCount}/{maxItems} 条普通记录
          </span>
        </div>
        <div className="flex items-center gap-2">
          <label className="clipboard-limit-control flex items-center gap-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
            <Settings2 size={12} />
            保留
            <input
              type="number"
              min={1}
              max={500}
              value={maxItemsDraft}
              onChange={(e) => setMaxItemsDraft(e.target.value)}
              onBlur={() => updateMaxItems(maxItemsDraft)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                }
              }}
              className="macos-input py-1 text-xs"
              style={{ width: 68 }}
            />
            条
          </label>
          <button onClick={clearItems} className="btn-secondary flex items-center gap-1.5" style={{ color: "var(--bg-danger)" }}>
            <Trash2 size={12} />
            清空
          </button>
        </div>
      </div>

      {/* Items */}
      <div className="space-y-2">
        {items.length === 0 && (
          <div className="panel p-8 text-center">
            <ClipboardList size={32} className="mx-auto mb-3" style={{ color: "var(--text-muted)" }} />
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              暂无剪贴板记录
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              复制文本后会自动记录
            </p>
          </div>
        )}
        {items.map((item, index) => (
          <div
            key={item.id}
            className={`clipboard-item panel p-4 flex items-start gap-3 animate-slide-in ${item.pinned ? "is-pinned" : ""}`}
            style={{
              animationDelay: `${index * 30}ms`,
              opacity: 0,
            }}
          >
            <div
              className="clipboard-item-icon w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
            >
              {item.content_type === "text" ? (
                <Type size={14} style={{ color: "var(--text-secondary)" }} />
              ) : item.content_type.startsWith("image/") ? (
                <FileText size={14} style={{ color: "var(--text-secondary)" }} />
              ) : (
                <FileText size={14} style={{ color: "var(--text-secondary)" }} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              {item.content_type.startsWith("image/") ? (
                <div className="clipboard-image-preview mb-2">
                  <img
                    src={item.content}
                    alt="剪贴板图片"
                    className="rounded-lg max-h-40 object-contain bg-black/5"
                    style={{ maxWidth: "100%" }}
                  />
                </div>
              ) : (
                <p className="clipboard-content text-[13px] leading-relaxed break-all" style={{ color: "var(--text-primary)" }}>
                  {item.content.length > 300 ? item.content.slice(0, 300) + "..." : item.content}
                </p>
              )}
              <div className="flex items-center gap-2 mt-1">
                {item.pinned && (
                  <span className="clipboard-pin-badge">
                    <Pin size={10} />
                    置顶
                  </span>
                )}
                <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {new Date(item.timestamp * 1000).toLocaleString()}
                </p>
              </div>
            </div>
            <div className="clipboard-actions flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => togglePin(item)}
                className="icon-action"
                style={{
                  background: item.pinned ? "rgba(255, 149, 0, 0.12)" : undefined,
                  color: item.pinned ? "var(--bg-warning)" : undefined,
                }}
                title={item.pinned ? "取消置顶" : "置顶"}
              >
                {item.pinned ? <PinOff size={13} /> : <Pin size={13} />}
              </button>
              <button
                onClick={() => writeItem(item)}
                className="icon-action"
                style={{
                  background: copiedId === item.id ? "rgba(52, 199, 89, 0.12)" : undefined,
                  color: copiedId === item.id ? "var(--bg-success)" : undefined,
                }}
                title={copiedId === item.id ? "已复制" : "复制"}
              >
                <Copy size={13} />
              </button>
              <button
                onClick={() => deleteItem(item.id)}
                className="icon-action danger"
                style={{ color: "var(--bg-danger)" }}
                title="删除"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
