import { FormEvent, useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  GitBranch,
  GitCommitHorizontal,
  GitCompareArrows,
  ArrowUpFromLine,
  ArrowDownToLine,
  FileCode,
  Plus,
  FolderOpen,
  RefreshCw,
  Loader2,
  ChevronRight,
  Check,
  X,
  Circle,
  Dot,
  File,
  FilePlus,
  FileX2,
  ArrowRight,
  List,
  ListTree,
  PanelLeftClose,
  PanelLeftOpen,
  ArrowLeftRight,
} from "lucide-react";

interface GitStatusEntry {
  status: string;
  staged: boolean;
  path: string;
  kind: string;
}

interface GitStatusResult {
  branch: string;
  ahead: number;
  behind: number;
  entries: GitStatusEntry[];
  has_remote: boolean;
}

interface GitLogEntry {
  hash: string;
  author: string;
  date: string;
  message: string;
}

interface GitBranch {
  name: string;
  current: boolean;
  remote: string | null;
}

interface GitBranchDiffFile {
  filename: string;
  added: number;
  deleted: number;
}

interface GitDiffResult {
  filename: string;
  diff: string;
}

interface DiffLine {
  type: "context" | "add" | "delete";
  content: string;
  oldLineNum: number | null;
  newLineNum: number | null;
}

interface DiffHunk {
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

type Tab = "status" | "log" | "branches" | "compare";

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function shortenHash(hash: string): string {
  return hash.length > 7 ? hash.substring(0, 7) : hash;
}

function kindIcon(kind: string) {
  switch (kind) {
    case "modified": return <FileCode size={13} style={{ color: "#ff9500" }} />;
    case "added": return <FilePlus size={13} style={{ color: "#34c759" }} />;
    case "deleted": return <FileX2 size={13} style={{ color: "#ff3b30" }} />;
    case "untracked": return <File size={13} style={{ color: "#86868b" }} />;
    case "renamed": return <ArrowRight size={13} style={{ color: "#007aff" }} />;
    default: return <File size={13} style={{ color: "var(--text-muted)" }} />;
  }
}

function kindLabel(kind: string): string {
  switch (kind) {
    case "modified": return "修改";
    case "added": return "新增";
    case "deleted": return "删除";
    case "untracked": return "未跟踪";
    case "renamed": return "重命名";
    default: return kind;
  }
}

function parseUnifiedDiff(raw: string): DiffHunk[] {
  if (!raw.trim()) return [];

  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of raw.split('\n')) {
    if (line.startsWith('@@ ')) {
      const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (match) {
        if (currentHunk) hunks.push(currentHunk);
        oldLine = parseInt(match[1]);
        newLine = parseInt(match[3]);
        currentHunk = { oldStart: oldLine, newStart: newLine, lines: [] };
      }
      continue;
    }
    if (!currentHunk) continue;
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('diff --git') || line.startsWith('index ')) continue;

    if (line.startsWith(' ')) {
      currentHunk.lines.push({ type: 'context', content: line.substring(1), oldLineNum: oldLine++, newLineNum: newLine++ });
    } else if (line.startsWith('-')) {
      currentHunk.lines.push({ type: 'delete', content: line.substring(1), oldLineNum: oldLine++, newLineNum: null });
    } else if (line.startsWith('+')) {
      currentHunk.lines.push({ type: 'add', content: line.substring(1), oldLineNum: null, newLineNum: newLine++ });
    } else {
      currentHunk.lines.push({ type: 'context', content: line, oldLineNum: null, newLineNum: null });
    }
  }
  if (currentHunk) hunks.push(currentHunk);
  return hunks;
}

export default function GitUI() {
  const [repoPath, setRepoPath] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Status
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [commitMsg, setCommitMsg] = useState("");
  const [committing, setCommitting] = useState(false);

  // Log
  const [log, setLog] = useState<GitLogEntry[]>([]);
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);

  // Branches
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [newBranchName, setNewBranchName] = useState("");

  // UI state
  const [activeTab, setActiveTab] = useState<Tab>("status");
  const [showSidebar, setShowSidebar] = useState(true);
  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [fetching, setFetching] = useState(false);

  // Compare
  const [baseBranch, setBaseBranch] = useState("");
  const [compareBranch, setCompareBranch] = useState("");
  const [diffFiles, setDiffFiles] = useState<GitBranchDiffFile[]>([]);
  const [selectedDiffFile, setSelectedDiffFile] = useState<string | null>(null);

  // Diff modal
  const [diffModal, setDiffModal] = useState<{
    open: boolean;
    title: string;
    leftLabel: string;
    rightLabel: string;
    hunks: DiffHunk[];
    loading: boolean;
  }>({ open: false, title: "", leftLabel: "", rightLabel: "", hunks: [], loading: false });

  // Load status
  const loadStatus = useCallback(async (path: string) => {
    try {
      setError(null);
      const result = await invoke<GitStatusResult>("git_status", { repoPath: path });
      setStatus(result);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const loadLog = useCallback(async (path: string) => {
    try {
      const result = await invoke<GitLogEntry[]>("git_log", { repoPath: path, maxCount: 50 });
      setLog(result);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const loadBranches = useCallback(async (path: string) => {
    try {
      const result = await invoke<GitBranch[]>("git_branches", { repoPath: path });
      setBranches(result);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const refreshAll = useCallback(async (path: string) => {
    setLoading(true);
    await Promise.all([
      loadStatus(path),
      loadLog(path),
      loadBranches(path),
    ]);
    setLoading(false);
  }, [loadStatus, loadLog, loadBranches]);

  // Pick repo
  const pickRepo = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择 Git 仓库目录（.git 目录所在的根目录）",
      });
      if (!selected) return;
      const dir = typeof selected === "string" ? selected : selected[0];
      await openRepo(dir);
    } catch (e) {
      setError(String(e));
    }
  };

  const openRepo = async (dir: string) => {
    try {
      setError(null);
      setLoading(true);
      const root = await invoke<string>("git_check_repo", { path: dir });
      setRepoPath(root);
      await invoke("git_set_repo_path", { path: root });
      await refreshAll(root);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const initRepo = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择初始化 Git 仓库的目录",
      });
      if (!selected) return;
      const dir = typeof selected === "string" ? selected : selected[0];
      setError(null);
      setLoading(true);
      await invoke("git_init", { path: dir });
      await openRepo(dir);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  // Stage/Unstage
  const stageFiles = async (files: string[]) => {
    if (!repoPath) return;
    try {
      setError(null);
      await invoke("git_stage", { repoPath, files });
      await loadStatus(repoPath);
    } catch (e) {
      setError(String(e));
    }
  };

  const stageAll = async () => {
    if (!repoPath) return;
    try {
      setError(null);
      await invoke("git_stage_all", { repoPath });
      await loadStatus(repoPath);
    } catch (e) {
      setError(String(e));
    }
  };

  const unstageFiles = async (files: string[]) => {
    if (!repoPath) return;
    try {
      setError(null);
      await invoke("git_unstage", { repoPath, files });
      await loadStatus(repoPath);
    } catch (e) {
      setError(String(e));
    }
  };

  // Commit
  const commit = async (e: FormEvent) => {
    e.preventDefault();
    if (!repoPath || !commitMsg.trim()) return;
    setCommitting(true);
    try {
      setError(null);
      await invoke("git_commit", { repoPath, message: commitMsg.trim() });
      setCommitMsg("");
      await refreshAll(repoPath);
    } catch (e) {
      setError(String(e));
    } finally {
      setCommitting(false);
    }
  };

  // Push/Pull/Fetch
  const doPush = async () => {
    if (!repoPath) return;
    setPushing(true);
    try {
      setError(null);
      await invoke("git_push", { repoPath, branch: null as unknown as undefined });
      await loadStatus(repoPath);
    } catch (e) {
      setError(String(e));
    } finally {
      setPushing(false);
    }
  };

  const doPull = async () => {
    if (!repoPath) return;
    setPulling(true);
    try {
      setError(null);
      await invoke("git_pull", { repoPath, branch: null as unknown as undefined });
      await refreshAll(repoPath);
    } catch (e) {
      setError(String(e));
    } finally {
      setPulling(false);
    }
  };

  const doFetch = async () => {
    if (!repoPath) return;
    setFetching(true);
    try {
      setError(null);
      await invoke("git_fetch", { repoPath });
      await loadBranches(repoPath);
    } catch (e) {
      setError(String(e));
    } finally {
      setFetching(false);
    }
  };

  // Compare
  const loadDiffFiles = useCallback(async (path: string, base: string, compare: string) => {
    if (!base || !compare) return;
    try {
      setError(null);
      const result = await invoke<GitBranchDiffFile[]>("git_branch_diff_files", {
        repoPath: path, base, compare,
      });
      setDiffFiles(result);
      setSelectedDiffFile(null);
    } catch (e) {
      setError(String(e));
      setDiffFiles([]);
    }
  }, []);

  const loadDiffContent = useCallback(async (path: string, base: string, compare: string, file: string) => {
    setDiffModal({ open: true, title: file, leftLabel: base, rightLabel: compare, hunks: [], loading: true });
    try {
      const raw = await invoke<string>("git_branch_diff_content", { repoPath: path, base, compare, file });
      setDiffModal({ open: true, title: file, leftLabel: base, rightLabel: compare, hunks: parseUnifiedDiff(raw), loading: false });
    } catch (e) {
      setDiffModal({ open: true, title: file, leftLabel: base, rightLabel: compare, hunks: [], loading: false });
    }
  }, []);

  const loadCommitDiff = useCallback(async (hash: string, msg?: string) => {
    if (!repoPath) return;
    const title = msg ? `${shortenHash(hash)} ${msg}` : `提交: ${shortenHash(hash)}`;
    setDiffModal({ open: true, title, leftLabel: "旧 / Parent", rightLabel: "新 / Commit", hunks: [], loading: true });
    try {
      const raw = await invoke<string>("git_commit_diff", { repoPath, hash });
      setDiffModal({ open: true, title, leftLabel: "旧 / Parent", rightLabel: "新 / Commit", hunks: parseUnifiedDiff(raw), loading: false });
    } catch (e) {
      setDiffModal({ open: true, title, leftLabel: "旧 / Parent", rightLabel: "新 / Commit", hunks: [], loading: false });
    }
  }, [repoPath]);

  const loadStatusDiff = useCallback(async (entry: GitStatusEntry, staged: boolean) => {
    if (!repoPath) return;
    const leftLabel = staged ? "HEAD" : entry.kind === "untracked" ? "未跟踪" : "工作区";
    const rightLabel = staged ? "暂存区" : "当前文件";
    setDiffModal({ open: true, title: entry.path, leftLabel, rightLabel, hunks: [], loading: true });
    try {
      const result = await invoke<GitDiffResult[]>("git_diff", {
        repoPath,
        file: entry.path,
        staged,
      });
      const raw = result.map((item) => item.diff).join("\n");
      setDiffModal({ open: true, title: entry.path, leftLabel, rightLabel, hunks: parseUnifiedDiff(raw), loading: false });
    } catch (e) {
      setDiffModal({ open: true, title: entry.path, leftLabel, rightLabel, hunks: [], loading: false });
      setError(String(e));
    }
  }, [repoPath]);

  // Branch ops
  const switchBranch = async (name: string) => {
    if (!repoPath) return;
    try {
      setError(null);
      await invoke("git_checkout", { repoPath, branch: name });
      await refreshAll(repoPath);
    } catch (e) {
      setError(String(e));
    }
  };

  const createBranch = async (e: FormEvent) => {
    e.preventDefault();
    if (!repoPath || !newBranchName.trim()) return;
    try {
      setError(null);
      await invoke("git_create_branch", { repoPath, branch: newBranchName.trim() });
      setNewBranchName("");
      await refreshAll(repoPath);
    } catch (e) {
      setError(String(e));
    }
  };

  // Diff
  const toggleCommit = (hash: string, msg: string) => {
    if (selectedCommit === hash) {
      setSelectedCommit(null);
    } else {
      setSelectedCommit(hash);
      loadCommitDiff(hash, msg);
    }
  };

  const restoreFile = async (file: string) => {
    if (!repoPath || !confirm(`确认回滚 ${file}？\n\n这将丢弃该文件的所有本地修改。`)) return;
    try {
      setError(null);
      await invoke("git_restore_file", { repoPath, file });
      await loadStatus(repoPath);
    } catch (e) {
      setError(String(e));
    }
  };

  const stagedFiles = status?.entries.filter((e) => e.staged) || [];
  const unstagedFiles = status?.entries.filter((e) => !e.staged && e.kind !== "untracked") || [];
  const untrackedFiles = status?.entries.filter((e) => e.kind === "untracked") || [];

  const hasStaged = stagedFiles.length > 0;
  const hasChanges = status && (stagedFiles.length > 0 || unstagedFiles.length > 0 || untrackedFiles.length > 0);

  return (
    <div className="page-content animate-fade-in" style={{ maxWidth: "none" }}>
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title-row">
            <div className="page-icon" style={{ background: "rgba(0, 122, 255, 0.12)" }}>
              <GitBranch size={18} color="#007aff" strokeWidth={2} />
            </div>
            <h2 className="page-title">Git</h2>
            <p className="page-subtitle">Git 仓库管理</p>
          </div>
        </div>
      </div>

      {/* Repo path bar */}
      <div className="panel mb-4" style={{ padding: "10px 12px" }}>
        {!repoPath ? (
          <div className="flex items-center justify-between">
            <span style={{ color: "var(--text-muted)", fontSize: 13 }}>未选择 Git 仓库</span>
            <button onClick={pickRepo} className="btn-primary flex items-center gap-1.5 text-[12px]">
              <FolderOpen size={12} /> 打开仓库
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="shrink-0" style={{ color: "var(--text-muted)", fontSize: 13, fontWeight: 500 }}>仓库</span>
              <span className="truncate text-[13px]" style={{ color: "var(--text-secondary)", fontFamily: '"SF Mono", SFMono-Regular, ui-monospace, monospace' }}>
                {repoPath}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={pickRepo} className="icon-action" style={{ width: 28, height: 28 }} title="更换仓库">
                <FolderOpen size={12} />
              </button>
              <button onClick={() => refreshAll(repoPath)} className="icon-action" style={{ width: 28, height: 28 }} title="刷新" disabled={loading}>
                <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
              </button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg text-[12px]" style={{ color: "var(--bg-danger)", background: "rgba(255,59,48,0.08)", border: "1px solid rgba(255,59,48,0.16)" }}>
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="icon-action" style={{ width: 22, height: 22, border: "none", background: "transparent", color: "var(--bg-danger)" }}>
            <X size={12} />
          </button>
        </div>
      )}

      {!repoPath ? (
        <div className="ssh-empty-workspace" style={{ minHeight: 320 }}>
          <GitBranch size={48} style={{ color: "var(--text-muted)", opacity: 0.2 }} />
          <p style={{ color: "var(--text-muted)", marginBottom: 4 }}>选择一个 Git 仓库目录开始使用</p>
          <p className="text-[12px] mb-4" style={{ color: "var(--text-secondary)", textAlign: "center" }}>
            文件对话框中按 <kbd style={{ padding: "1px 5px", borderRadius: 4, background: "var(--bg-input)", border: "1px solid var(--border-color)", fontWeight: 700 }}>Cmd+Shift+.</kbd> 可显示隐藏目录（如 .git）
          </p>
          <div className="flex items-center gap-2">
            <button onClick={pickRepo} className="btn-primary flex items-center gap-1.5 text-[12px]">
              <FolderOpen size={12} /> 打开仓库
            </button>
            <button onClick={initRepo} className="btn-secondary flex items-center gap-1.5 text-[12px]">
              <Plus size={12} /> 初始化仓库
            </button>
          </div>
        </div>
      ) : (
        <div className={`ssh-layout ${showSidebar ? "ssh-layout-with-sidebar" : "ssh-layout-full"}`} style={{ minHeight: 0 }}>
          {/* Sidebar */}
          {showSidebar ? (
            <aside className="ssh-sidebar panel">
              {/* Tabs */}
              <div className="ssh-panel-header git-sidebar-header">
                <div className="git-sidebar-title">
                  <span className="git-sidebar-title-icon">
                    <ListTree size={14} />
                  </span>
                  <span className="section-label">功能</span>
                </div>
                <button onClick={() => setShowSidebar(false)} className="icon-action" style={{ width: 26, height: 26 }} title="收起">
                  <PanelLeftClose size={13} />
                </button>
              </div>

              {/* Branch indicator */}
              {status && (
                <div className="git-branch-card">
                  <div className="git-branch-name">
                    <span className="git-branch-icon">
                      <GitBranch size={13} />
                    </span>
                    <span className="truncate">{status.branch}</span>
                  </div>
                  <div className="git-branch-meta">
                    {status.ahead > 0 && <span className="flex items-center gap-0.5"><ArrowUpFromLine size={9} /> {status.ahead}</span>}
                    {status.behind > 0 && <span className="flex items-center gap-0.5"><ArrowDownToLine size={9} /> {status.behind}</span>}
                    {status.ahead === 0 && status.behind === 0 && <span>已同步</span>}
                  </div>
                </div>
              )}

              {/* Tab list */}
              <div className="git-sidebar-nav">
                {([
                  { id: "status" as Tab, label: "变更", icon: List },
                  { id: "log" as Tab, label: "历史", icon: GitCommitHorizontal },
                  { id: "branches" as Tab, label: "分支", icon: GitBranch },
                  { id: "compare" as Tab, label: "分支比较", icon: GitCompareArrows },
                ]).map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setActiveTab(id)}
                    className={`git-sidebar-nav-item ${activeTab === id ? "is-active" : ""}`}
                  >
                    <span className="git-sidebar-nav-icon">
                      <Icon size={15} />
                    </span>
                    <span className="git-sidebar-nav-label">{label}</span>
                    {id === "status" && hasChanges && (
                      <span className="git-sidebar-badge">
                        {stagedFiles.length + unstagedFiles.length + untrackedFiles.length}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </aside>
          ) : (
            <div className="ssh-expand-strip" onClick={() => setShowSidebar(true)} style={{ height: "auto", minHeight: 200 }}>
              <PanelLeftOpen size={14} style={{ color: "var(--text-muted)" }} />
            </div>
          )}

          {/* Main content */}
          <main className="ssh-workspace panel" style={{ overflow: "hidden" }}>
            {/* Toolbar */}
            <div className="ssh-toolbar">
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
                  {activeTab === "status" && "变更"}
                  {activeTab === "log" && "提交历史"}
                  {activeTab === "branches" && "分支管理"}
                  {activeTab === "compare" && "分支比较"}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {activeTab === "status" && repoPath && (
                  <>
                    {status?.has_remote && (
                      <>
                        <button onClick={doFetch} disabled={fetching} className="icon-action" style={{ width: 28, height: 28 }} title="拉取远程变更">
                          {fetching ? <Loader2 size={11} className="animate-spin" /> : <ArrowDownToLine size={11} />}
                        </button>
                        <button onClick={doPull} disabled={pulling} className="btn-secondary flex items-center gap-1 text-[11px] px-2.5 font-mono" style={{ minHeight: 28 }}>
                          {pulling ? <Loader2 size={11} className="animate-spin" /> : <ArrowDownToLine size={11} />}
                          git pull
                        </button>
                        <button onClick={doPush} disabled={pushing || !hasStaged} className="btn-primary flex items-center gap-1 text-[11px] px-2.5 font-mono" style={{ minHeight: 28 }}>
                          {pushing ? <Loader2 size={11} className="animate-spin" /> : <ArrowUpFromLine size={11} />}
                          git push
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-auto" style={{ minHeight: 0 }}>
              {/* ───── STATUS TAB ───── */}
              {activeTab === "status" && (
                <div className="flex flex-col h-full">
                  {!hasChanges ? (
                    <div className="ssh-sftp-empty flex-1">
                      <Check size={24} style={{ color: "#34c759" }} />
                      <span style={{ color: "var(--text-secondary)" }}>工作区干净，没有未提交的变更</span>
                    </div>
                  ) : (
                    <div className="flex flex-col flex-1">
                      {/* Staged */}
                      {stagedFiles.length > 0 && (
                        <div>
                          <div className="ssh-sftp-toolbar">
                            <span className="section-label">暂存的变更 ({stagedFiles.length})</span>
                            <button
                              onClick={() => unstageFiles(stagedFiles.map((f) => f.path))}
                              className="cleaner-mini-button text-[10px]"
                            >
                              全部取消暂存
                            </button>
                          </div>
                          <div>
                            {stagedFiles.map((entry) => (
                              <div
                                key={`staged-${entry.path}`}
                                className="flex items-center gap-3 px-3 py-2 border-b text-[12px] cursor-pointer"
                                style={{ borderColor: "var(--border-color)" }}
                                onClick={() => loadStatusDiff(entry, true)}
                              >
                                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                  {kindIcon(entry.kind)}
                                  <span className="truncate">{entry.path}</span>
                                </div>
                                <span className="text-[11px]" style={{ color: "#34c759" }}>{kindLabel(entry.kind)}</span>
                                <span>
                                  <button onClick={(e) => { e.stopPropagation(); unstageFiles([entry.path]); }} className="icon-action" style={{ width: 22, height: 22 }} title="取消暂存">
                                    <X size={10} />
                                  </button>
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Unstaged */}
                      {unstagedFiles.length > 0 && (
                        <div>
                          <div className="ssh-sftp-toolbar">
                            <span className="section-label">未暂存的变更 ({unstagedFiles.length})</span>
                          </div>
                          <div>
                            {unstagedFiles.map((entry) => (
                              <div
                                key={`unstaged-${entry.path}`}
                                className="flex items-center gap-3 px-3 py-2 border-b text-[12px] cursor-pointer"
                                style={{ borderColor: "var(--border-color)" }}
                                onClick={() => loadStatusDiff(entry, false)}
                              >
                                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                  {kindIcon(entry.kind)}
                                  <span className="truncate">{entry.path}</span>
                                </div>
                                <span className="text-[11px]" style={{ color: "#ff9500" }}>{kindLabel(entry.kind)}</span>
                                <span className="flex items-center gap-1">
                                  <button onClick={(e) => { e.stopPropagation(); stageFiles([entry.path]); }} className="icon-action" style={{ width: 22, height: 22 }} title="暂存">
                                    <Plus size={10} />
                                  </button>
                                  <button onClick={(e) => { e.stopPropagation(); restoreFile(entry.path); }} className="icon-action danger" style={{ width: 22, height: 22 }} title="回滚">
                                    <ArrowRight size={10} style={{ transform: "rotate(180deg)" }} />
                                  </button>
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Untracked */}
                      {untrackedFiles.length > 0 && (
                        <div>
                          <div className="ssh-sftp-toolbar">
                            <span className="section-label">未跟踪的文件 ({untrackedFiles.length})</span>
                            <button onClick={() => stageFiles(untrackedFiles.map((f) => f.path))} className="cleaner-mini-button text-[10px]">
                              全部暂存
                            </button>
                          </div>
                          <div>
                            {untrackedFiles.map((entry) => (
                              <div
                                key={`untracked-${entry.path}`}
                                className="flex items-center gap-3 px-3 py-2 border-b text-[12px] cursor-pointer"
                                style={{ borderColor: "var(--border-color)" }}
                                onClick={() => loadStatusDiff(entry, false)}
                              >
                                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                  {kindIcon(entry.kind)}
                                  <span className="truncate">{entry.path}</span>
                                </div>
                                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{kindLabel(entry.kind)}</span>
                                <span>
                                  <button onClick={(e) => { e.stopPropagation(); stageFiles([entry.path]); }} className="icon-action" style={{ width: 22, height: 22 }} title="暂存">
                                    <Plus size={10} />
                                  </button>
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Commit area */}
                      <div className="border-t p-3" style={{ borderColor: "var(--border-color)", background: "rgba(127,127,127,0.02)" }}>
                        <form onSubmit={commit} className="flex gap-2 items-start">
                          <input
                            className="macos-input text-[13px] flex-1"
                            placeholder="输入提交信息..."
                            value={commitMsg}
                            onChange={(e) => setCommitMsg(e.target.value)}
                            disabled={committing}
                            autoFocus
                          />
                          <div className="flex gap-1.5">
                            {stagedFiles.length > 0 && (
                              <button
                                type="button"
                                onClick={stageAll}
                                className="btn-secondary flex items-center gap-1 text-[11px]"
                                style={{ minHeight: 32 }}
                                title="暂存所有变更（包括未跟踪文件）"
                              >
                                <Plus size={11} /> 全部暂存
                              </button>
                            )}
                            <button
                              type="submit"
                              className="btn-primary flex items-center gap-1 text-[11px]"
                              disabled={committing || !commitMsg.trim() || !hasStaged}
                              style={{ minHeight: 32 }}
                            >
                              {committing ? <Loader2 size={11} className="animate-spin" /> : <GitCommitHorizontal size={11} />}
                              git commit
                            </button>
                          </div>
                        </form>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ───── LOG TAB ───── */}
              {activeTab === "log" && (
                <div className="flex-1 overflow-auto">
                  {log.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-10" style={{ color: "var(--text-muted)" }}>
                      <GitCommitHorizontal size={20} style={{ opacity: 0.3 }} />
                      <span className="text-[12px]">暂无提交历史，点击某次提交查看修改内容</span>
                    </div>
                  ) : (
                    log.map((entry) => (
                      <div
                        key={entry.hash}
                        className="flex items-center gap-3 px-4 py-2.5 border-b cursor-pointer text-[12px]"
                        style={{
                          borderColor: "var(--border-color)",
                          background: selectedCommit === entry.hash ? "rgba(0,122,255,0.06)" : undefined,
                        }}
                        onClick={() => toggleCommit(entry.hash, entry.message)}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <Circle size={6} style={{ color: "var(--text-muted)", fill: "var(--text-muted)" }} />
                          <div className="min-w-0">
                            <div className="truncate font-medium" style={{ color: "var(--text-primary)" }}>
                              {entry.message}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] font-mono" style={{ color: "var(--bg-button)" }}>
                                {shortenHash(entry.hash)}
                              </span>
                              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{entry.author}</span>
                              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{formatDate(entry.date)}</span>
                            </div>
                          </div>
                        </div>
                        <ChevronRight size={11} style={{
                          color: "var(--text-muted)",
                          transform: selectedCommit === entry.hash ? "rotate(90deg)" : undefined,
                          transition: "transform 0.15s ease",
                        }} />
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* ───── BRANCHES TAB ───── */}
              {activeTab === "branches" && (
                <div className="flex flex-col h-full">
                  <div className="ssh-sftp-toolbar">
                    <span className="section-label">分支列表</span>
                  </div>
                  <div className="flex-1 overflow-auto">
                    {branches
                      .filter((b) => !b.name.startsWith("remotes/"))
                      .map((branch) => (
                        <div key={branch.name} className="flex items-center gap-3 px-4 py-2.5 border-b text-[12px]" style={{ borderColor: "var(--border-color)" }}>
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            {branch.current ? (
                              <Dot size={16} style={{ color: "var(--bg-button)" }} />
                            ) : (
                              <GitBranch size={12} style={{ color: "var(--text-muted)" }} />
                            )}
                            <span style={{
                              color: branch.current ? "var(--text-primary)" : "var(--text-secondary)",
                              fontWeight: branch.current ? 600 : 400,
                            }}>
                              {branch.name}
                            </span>
                            {branch.current && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{
                                background: "rgba(0,122,255,0.1)",
                                color: "var(--bg-button)",
                              }}>当前</span>
                            )}
                          </div>
                          {!branch.current && (
                            <button
                              onClick={() => switchBranch(branch.name)}
                              className="icon-action"
                              style={{ width: 22, height: 22 }}
                              title="切换到该分支"
                            >
                              <ArrowRight size={10} />
                            </button>
                          )}
                        </div>
                      ))}
                  </div>

                  {/* Create branch */}
                  <div className="border-t p-3" style={{ borderColor: "var(--border-color)", background: "rgba(127,127,127,0.02)" }}>
                    <form onSubmit={createBranch} className="flex gap-2 items-center">
                      <input
                        className="macos-input text-[13px] flex-1"
                        placeholder="新分支名称..."
                        value={newBranchName}
                        onChange={(e) => setNewBranchName(e.target.value)}
                      />
                      <button
                        type="submit"
                        className="btn-primary flex items-center gap-1 text-[11px]"
                        disabled={!newBranchName.trim()}
                        style={{ minHeight: 32 }}
                      >
                        <GitBranch size={11} /> 创建分支
                      </button>
                    </form>
                  </div>
                </div>
              )}

              {/* ───── COMPARE TAB ───── */}
              {activeTab === "compare" && (
                <div className="flex flex-col h-full">
                  {/* Branch selector toolbar */}
                  <div className="ssh-sftp-toolbar flex items-center gap-2">
                    <div className="flex items-center gap-1.5 flex-1">
                      <span className="section-label">Base</span>
                      <select
                        className="macos-input text-[12px] font-mono"
                        style={{ maxWidth: 180, minHeight: 28 }}
                        value={baseBranch}
                        onChange={(e) => {
                          setBaseBranch(e.target.value);
                          loadDiffFiles(repoPath, e.target.value, compareBranch);
                        }}
                      >
                        <option value="">-- 选择 --</option>
                        {branches
                          .filter((b) => b.name !== compareBranch && !b.name.startsWith("remotes/"))
                          .map((b) => (
                            <option key={b.name} value={b.name}>{b.name}</option>
                          ))
                        }
                      </select>
                      <button
                        className="icon-action"
                        style={{ width: 26, height: 26 }}
                        title="交换分支"
                        onClick={() => {
                          const tmp = baseBranch;
                          setBaseBranch(compareBranch);
                          setCompareBranch(tmp);
                          loadDiffFiles(repoPath, compareBranch, baseBranch);
                        }}
                        disabled={!baseBranch || !compareBranch}
                      >
                        <ArrowLeftRight size={11} />
                      </button>
                      <span className="section-label">Compare</span>
                      <select
                        className="macos-input text-[12px] font-mono"
                        style={{ maxWidth: 180, minHeight: 28 }}
                        value={compareBranch}
                        onChange={(e) => {
                          setCompareBranch(e.target.value);
                          loadDiffFiles(repoPath, baseBranch, e.target.value);
                        }}
                      >
                        <option value="">-- 选择 --</option>
                        {branches
                          .filter((b) => b.name !== baseBranch && !b.name.startsWith("remotes/"))
                          .map((b) => (
                            <option key={b.name} value={b.name}>{b.name}</option>
                          ))
                        }
                      </select>
                    </div>
                  </div>

                  {/* File list (full width) */}
                  {!baseBranch || !compareBranch ? (
                    <div className="ssh-sftp-empty flex-1">
                      <GitCompareArrows size={24} style={{ opacity: 0.3 }} />
                      <span style={{ fontSize: 12 }}>请选择两个分支进行比较</span>
                    </div>
                  ) : diffFiles.length === 0 ? (
                    <div className="ssh-sftp-empty flex-1">
                      <Check size={24} style={{ color: "#34c759", opacity: 0.5 }} />
                      <span style={{ fontSize: 12 }}>两个分支没有差异</span>
                    </div>
                  ) : (
                    <div className="flex-1 overflow-auto">
                      <div className="ssh-sftp-toolbar">
                        <span className="section-label">变更文件 ({diffFiles.length})</span>
                      </div>
                      {diffFiles.map((file) => (
                        <div
                          key={file.filename}
                          className="flex items-center gap-3 px-4 py-2.5 border-b cursor-pointer text-[12px]"
                          style={{
                            borderColor: "var(--border-color)",
                            background: selectedDiffFile === file.filename ? "rgba(0,122,255,0.06)" : undefined,
                          }}
                          onClick={() => {
                            setSelectedDiffFile(file.filename);
                            loadDiffContent(repoPath, baseBranch, compareBranch, file.filename);
                          }}
                        >
                          <span className="flex-1 truncate" style={{ color: "var(--text-primary)" }}>
                            {file.filename}
                          </span>
                          <span className="flex items-center gap-1.5 shrink-0">
                            {file.added > 0 && (
                              <span className="text-[11px] font-mono" style={{ color: "#34c759" }}>+{file.added}</span>
                            )}
                            {file.deleted > 0 && (
                              <span className="text-[11px] font-mono" style={{ color: "#ff3b30" }}>-{file.deleted}</span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </main>
        </div>
      )}

      {/* Diff Modal */}
      {diffModal.open && (
        <div className="modal-overlay" onClick={() => setDiffModal((p) => ({ ...p, open: false }))}>
          <div
            className="modal-panel"
            onClick={(e) => e.stopPropagation()}
            style={{ width: "calc(100vw - 120px)", maxWidth: 1400, maxHeight: "88vh", overflow: "hidden", display: "flex", flexDirection: "column" }}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[14px] font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                {diffModal.title}
              </h3>
              <button
                onClick={() => setDiffModal((p) => ({ ...p, open: false }))}
                className="icon-action"
                style={{ width: 28, height: 28 }}
              >
                <X size={14} />
              </button>
            </div>

            {diffModal.loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={20} className="animate-spin" style={{ color: "var(--text-muted)" }} />
              </div>
            ) : diffModal.hunks.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-[12px]" style={{ color: "var(--text-muted)" }}>
                无差异
              </div>
            ) : (
              <div className="flex-1 overflow-auto font-mono text-[12px]" style={{ lineHeight: 1.6 }}>
                {/* Column headers */}
                <div className="flex border-b sticky top-0 z-10" style={{ borderColor: "var(--border-color)", background: "var(--bg-secondary)", minWidth: "fit-content" }}>
                  <div className="flex-1 px-3 py-1.5 text-[10px] font-semibold uppercase" style={{ color: "var(--text-muted)", borderRight: "1px solid var(--border-color)" }}>
                    {diffModal.leftLabel}
                  </div>
                  <div className="flex-1 px-3 py-1.5 text-[10px] font-semibold uppercase" style={{ color: "var(--text-muted)" }}>
                    {diffModal.rightLabel}
                  </div>
                </div>
                {/* Diff lines — single scrollbar on outer container */}
                <div className="overflow-x-auto">
                  <div style={{ minWidth: "max-content" }}>
                    {diffModal.hunks.map((hunk, hi) => (
                      <div key={hi}>
                        <div className="flex px-3 py-0.5 text-[11px] font-semibold" style={{
                          background: "rgba(127,127,127,0.04)",
                          borderBottom: "1px solid var(--border-color)",
                          color: "var(--text-muted)",
                          fontFamily: "var(--font-sans)",
                        }}>
                          @@ -{hunk.oldStart} +{hunk.newStart} @@
                        </div>
                        {hunk.lines.map((line, li) => (
                          <div key={li} className="flex">
                            {/* Left */}
                            <div className="flex" style={{
                              width: "50%",
                              overflow: "hidden",
                              borderRight: "1px solid var(--border-color)",
                              background: line.type === 'delete' ? "rgba(255,59,48,0.06)" : line.type === 'add' ? "rgba(0,0,0,0.02)" : "transparent",
                            }}>
                              <span className="shrink-0 text-right px-1.5 py-px select-none" style={{ width: 40, color: "var(--text-muted)", fontSize: 11 }}>
                                {line.oldLineNum ?? ''}
                              </span>
                              <span className="shrink-0 w-3 select-none py-px" style={{ color: line.type === 'delete' ? "#ff3b30" : "transparent" }}>
                                {line.type === 'delete' ? '-' : ''}
                              </span>
                              <span className="whitespace-pre px-1 py-px" style={{
                                background: line.type === 'delete' ? "rgba(255,59,48,0.1)" : "transparent",
                                color: "var(--text-primary)",
                              }}>
                                {line.type !== 'add' ? line.content : ''}
                              </span>
                            </div>
                            {/* Right */}
                            <div className="flex" style={{
                              width: "50%",
                              overflow: "hidden",
                              background: line.type === 'add' ? "rgba(52,199,89,0.06)" : line.type === 'delete' ? "rgba(0,0,0,0.02)" : "transparent",
                            }}>
                              <span className="shrink-0 text-right px-1.5 py-px select-none" style={{ width: 40, color: "var(--text-muted)", fontSize: 11 }}>
                                {line.newLineNum ?? ''}
                              </span>
                              <span className="shrink-0 w-3 select-none py-px" style={{ color: line.type === 'add' ? "#34c759" : "transparent" }}>
                                {line.type === 'add' ? '+' : ''}
                              </span>
                              <span className="whitespace-pre px-1 py-px" style={{
                                background: line.type === 'add' ? "rgba(52,199,89,0.1)" : "transparent",
                                color: "var(--text-primary)",
                              }}>
                                {line.type !== 'delete' ? line.content : ''}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
