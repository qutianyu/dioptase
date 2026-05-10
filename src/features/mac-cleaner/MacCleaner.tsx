import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  FolderOpen,
  HardDrive,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";

type CleanerCategory = {
  id: string;
  name: string;
  description: string;
  size: number;
  item_count: number;
  safe_by_default: boolean;
};

type CleanerItem = {
  id: string;
  category_id: string;
  name: string;
  path: string;
  size: number;
  modified_at: number | null;
  removable: boolean;
  selected_by_default: boolean;
};

type CleanerScanResult = {
  total_size: number;
  reclaimable_size: number;
  categories: CleanerCategory[];
  items: CleanerItem[];
};

type DeleteResult = {
  deleted_size: number;
  deleted_count: number;
  failed: { path: string; reason: string }[];
};

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatDate(timestamp: number | null): string {
  if (!timestamp) return "未知";
  return new Date(timestamp * 1000).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export default function MacCleaner() {
  const [scan, setScan] = useState<CleanerScanResult | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [lastScannedAt, setLastScannedAt] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedItems = useMemo(() => {
    if (!scan) return [];
    return scan.items.filter((item) => selectedPaths.has(item.path));
  }, [scan, selectedPaths]);

  const selectedSize = selectedItems.reduce((sum, item) => sum + item.size, 0);

  const itemsByCategory = useMemo(() => {
    const groups = new Map<string, CleanerItem[]>();
    scan?.items.forEach((item) => {
      const items = groups.get(item.category_id) ?? [];
      items.push(item);
      groups.set(item.category_id, items);
    });
    return groups;
  }, [scan]);

  const runScan = async (options?: { preserveMessage?: boolean }) => {
    setScanning(true);
    setError(null);
    if (!options?.preserveMessage) setMessage(null);
    try {
      setScan(null);
      setSelectedPaths(new Set());
      setExpandedCategories(new Set());
      await waitForNextPaint();
      const result = await invoke<CleanerScanResult>("scan_mac_cleanup");
      setScan(result);
      setSelectedPaths(new Set(result.items.filter((item) => item.selected_by_default).map((item) => item.path)));
      setExpandedCategories(new Set(result.categories.slice(0, 2).map((category) => category.id)));
      setLastScannedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  };

  const toggleCategory = (categoryId: string) => {
    if (!scan) return;
    const categoryItems = scan.items.filter((item) => item.category_id === categoryId);
    const allSelected = categoryItems.every((item) => selectedPaths.has(item.path));
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      categoryItems.forEach((item) => {
        if (allSelected) next.delete(item.path);
        else next.add(item.path);
      });
      return next;
    });
  };

  const toggleCategoryExpanded = (categoryId: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  };

  const expandAll = () => {
    if (!scan) return;
    setExpandedCategories(new Set(scan.categories.map((category) => category.id)));
  };

  const collapseAll = () => {
    setExpandedCategories(new Set());
  };

  const toggleItem = (item: CleanerItem) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(item.path)) next.delete(item.path);
      else next.add(item.path);
      return next;
    });
  };

  const cleanSelected = async () => {
    if (selectedItems.length === 0) return;
    const confirmed = window.confirm(`将永久删除 ${selectedItems.length} 项，预计释放 ${formatBytes(selectedSize)}。是否继续？`);
    if (!confirmed) return;

    setCleaning(true);
    setError(null);
    setMessage(null);
    try {
      const result = await invoke<DeleteResult>("delete_mac_cleanup_items", {
        request: { paths: selectedItems.map((item) => item.path) },
      });
      const suffix = result.failed.length > 0 ? `，${result.failed.length} 项失败` : "";
      setMessage(`已清理 ${result.deleted_count} 项，释放 ${formatBytes(result.deleted_size)}${suffix}`);
      await runScan({ preserveMessage: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCleaning(false);
    }
  };

  useEffect(() => {
    runScan();
  }, []);

  return (
    <div className="page-content animate-fade-in">
      <div className="page-header">
        <div>
          <div className="page-title-row">
            <div className="page-icon" style={{ background: "rgba(52, 199, 89, 0.12)" }}>
              <Sparkles size={18} color="#34c759" strokeWidth={2} />
            </div>
            <h2 className="page-title">Mac 清理</h2>
            <p className="page-subtitle">扫描缓存、日志、废纸篓、开发缓存和大文件</p>
          </div>
        </div>
      </div>

      <div className="cleaner-summary-bar mb-4">
        <div className="cleaner-summary-metrics">
          <div className="cleaner-summary-item">
            <HardDrive size={14} color="#007aff" />
            <span className="cleaner-summary-label">发现</span>
            <strong>{formatBytes(scan?.total_size ?? 0)}</strong>
          </div>
          <div className="cleaner-summary-item">
            <ShieldCheck size={14} color="#34c759" />
            <span className="cleaner-summary-label">建议</span>
            <strong>{formatBytes(scan?.reclaimable_size ?? 0)}</strong>
          </div>
          <div className="cleaner-summary-item">
            <Trash2 size={14} color="#ff9500" />
            <span className="cleaner-summary-label">已选</span>
            <strong>{formatBytes(selectedSize)}</strong>
            <span className="cleaner-summary-muted">{selectedItems.length} 项</span>
          </div>
          <span className="cleaner-summary-muted">
            {scanning ? "扫描中" : lastScannedAt ? `更新 ${new Date(lastScannedAt).toLocaleTimeString("zh-CN", { hour12: false })}` : "未扫描"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => runScan()} disabled={scanning || cleaning} className="btn-secondary flex items-center gap-1.5">
            {scanning ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {scanning ? "扫描中..." : "重新扫描"}
          </button>
          <button onClick={cleanSelected} disabled={cleaning || selectedItems.length === 0} className="btn-primary flex items-center gap-1.5">
            {cleaning ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            清理所选
          </button>
        </div>
      </div>

      {error && (
        <div className="panel panel-pad mb-4 flex items-center gap-2" style={{ color: "var(--bg-danger)" }}>
          <AlertTriangle size={15} />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {message && (
        <div className="panel panel-pad mb-4 flex items-center gap-2" style={{ color: "var(--bg-success)" }}>
          <CheckCircle2 size={15} />
          <span className="text-sm">{message}</span>
        </div>
      )}

      <div className="panel overflow-hidden">
        <div className="cleaner-list-header">
          <span>项目</span>
          <span>大小</span>
          <span>修改日期</span>
        </div>
        <div className="cleaner-list">
          {scanning && !scan ? (
            <div className="cleaner-empty">
              <Loader2 size={18} className="animate-spin" />
              <span>正在扫描...</span>
            </div>
          ) : !scan || scan.categories.length === 0 ? (
            <div className="cleaner-empty">
              <FolderOpen size={18} />
              <span>没有发现可清理项目</span>
            </div>
          ) : (
            <div className="cleaner-groups">
              <div className="cleaner-group-toolbar">
                <span>{scan.categories.length} 个分类 · {scan.items.length} 项</span>
                <div className="flex items-center gap-1.5">
                  <button className="cleaner-mini-button" onClick={expandAll}>展开全部</button>
                  <button className="cleaner-mini-button" onClick={collapseAll}>收起全部</button>
                </div>
              </div>
              {scan.categories.map((category) => {
              const categoryItems = itemsByCategory.get(category.id) ?? [];
              const expanded = expandedCategories.has(category.id);
              const checked = scan.items
                .filter((item) => item.category_id === category.id)
                .every((item) => selectedPaths.has(item.path));
              const selectedCount = categoryItems.filter((item) => selectedPaths.has(item.path)).length;
              return (
                <div key={category.id} className="cleaner-group">
                  <button
                    className="cleaner-group-header"
                    onClick={() => toggleCategoryExpanded(category.id)}
                    data-expanded={expanded}
                  >
                    <span className="cleaner-group-title">
                      {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                      <span className="min-w-0">
                        <span className="block truncate">{category.name}</span>
                        <span className="block truncate text-[11px]" style={{ color: "var(--text-muted)" }}>
                          {category.description}
                        </span>
                      </span>
                    </span>
                    <span className="cleaner-group-meta">
                      {!category.safe_by_default && (
                        <span className="cleaner-category-badge">手动</span>
                      )}
                      <span>{selectedCount}/{category.item_count} 项</span>
                      <strong>{formatBytes(category.size)}</strong>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCategory(category.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </span>
                  </button>
                  {expanded && (
                    <div className="cleaner-group-items">
                      {categoryItems.slice(0, 120).map((item) => (
                        <label key={item.id} className="cleaner-item-row">
                          <span className="flex items-center gap-3 min-w-0">
                            <input
                              type="checkbox"
                              checked={selectedPaths.has(item.path)}
                              onChange={() => toggleItem(item)}
                            />
                            <span className="min-w-0">
                              <span className="block truncate text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>
                                {item.name}
                              </span>
                              <span className="block truncate text-[11px]" style={{ color: "var(--text-muted)" }}>
                                {item.path}
                              </span>
                            </span>
                          </span>
                          <span className="tabular-nums" style={{ color: "var(--text-secondary)" }}>{formatBytes(item.size)}</span>
                          <span style={{ color: "var(--text-muted)" }}>{formatDate(item.modified_at)}</span>
                        </label>
                      ))}
                    </div>
                  )}
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
