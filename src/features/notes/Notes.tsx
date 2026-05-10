import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import hljs from "highlight.js";
import Editor from "react-simple-code-editor";
import {
  StickyNote,
  Plus,
  Trash2,
  Code2,
  ListTodo,
  FileText,
  Check,
  X,
  ChevronDown,
  Copy,
  Clock,
  Hash,
  Sparkles,
  Archive,
  ArchiveRestore,
} from "lucide-react";
import {
  type CompletionItem,
  TYPE_COLORS,
  TYPE_ICONS,
  getCompletions,
  applyCompletion,
  getCursorPosition,
} from "./completions";

type TodoStatus = "pending" | "done" | "cancelled" | "deferred";

type TodoItem = {
  text: string;
  status: TodoStatus;
  done?: boolean; // legacy compat
};

type NoteItem = {
  id: string;
  note_type: "note" | "code" | "todo";
  title: string;
  content: string;
  language: string | null;
  todos: TodoItem[] | null;
  created_at: number;
  updated_at: number;
  archived: boolean;
};

const LANGUAGES = [
  "JavaScript", "TypeScript", "Python", "Go", "Rust", "Java",
  "SQL", "JSON", "HTML", "CSS", "Bash", "YAML", "XML",
  "C", "C++", "Ruby", "PHP", "Swift", "Kotlin", "Plain Text",
];

interface TypeConfig {
  icon: typeof StickyNote;
  color: string;
  bg: string;
  label: string;
  gradient: string;
  borderGradient: string;
  desc: string;
}

const TYPE_INFO: Record<string, TypeConfig> = {
  note: {
    icon: FileText,
    color: "#007aff",
    bg: "rgba(0,122,255,0.1)",
    label: "便签",
    gradient: "linear-gradient(135deg, rgba(0,122,255,0.08), transparent)",
    borderGradient: "linear-gradient(90deg, #007aff, #5ac8fa)",
    desc: "随手记录想法",
  },
  code: {
    icon: Code2,
    color: "#af52de",
    bg: "rgba(175,82,222,0.1)",
    label: "代码",
    gradient: "linear-gradient(135deg, rgba(175,82,222,0.08), transparent)",
    borderGradient: "linear-gradient(90deg, #af52de, #5856d6)",
    desc: "保存代码片段",
  },
  todo: {
    icon: ListTodo,
    color: "#ff9500",
    bg: "rgba(255,149,0,0.1)",
    label: "待办",
    gradient: "linear-gradient(135deg, rgba(255,149,0,0.08), transparent)",
    borderGradient: "linear-gradient(90deg, #ff9500, #ffcc00)",
    desc: "追踪任务进度",
  },
};

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
  });
}

function highlightCode(code: string, language: string | null): string {
  if (!code) return "";
  try {
    const lang = language && language !== "Plain Text" ? hljs.getLanguage(language) : null;
    if (lang) {
      return hljs.highlight(code, { language: language! }).value;
    }
    return hljs.highlightAuto(code).value;
  } catch {
    return code
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
}

// Progress ring component
function ProgressRing({ done, total, color }: { done: number; total: number; color: string }) {
  const radius = 14;
  const circumference = 2 * Math.PI * radius;
  const progress = total > 0 ? done / total : 0;
  const offset = circumference - progress * circumference;

  return (
    <div className="notes-progress-ring">
      <svg width="36" height="36" viewBox="0 0 36 36">
        <circle className="notes-progress-ring-bg" cx="18" cy="18" r={radius} />
        <circle
          className="notes-progress-ring-fill"
          cx="18"
          cy="18"
          r={radius}
          stroke={color}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div
        className="absolute inset-0 flex items-center justify-center text-[9px] font-bold tabular-nums"
        style={{ color: progress === 1 && total > 0 ? "var(--bg-success)" : "var(--text-muted)" }}
      >
        {done}
      </div>
    </div>
  );
}

export default function Notes() {
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [selected, setSelected] = useState<NoteItem | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editLanguage, setEditLanguage] = useState("Plain Text");
  const [editTodos, setEditTodos] = useState<TodoItem[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const [completions, setCompletions] = useState<CompletionItem[]>([]);
  const [completionIndex, setCompletionIndex] = useState(0);
  const [completionPos, setCompletionPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [cursorPos, setCursorPos] = useState(0);
  const [viewTab, setViewTab] = useState<"active" | "archived">("active");

  const fetchNotes = async () => {
    try {
      setNotes(await invoke<NoteItem[]>("list_notes"));
    } catch (e) { console.error(e); }
  };

  useEffect(() => { fetchNotes(); }, []);

  useEffect(() => {
    if (!showCreateMenu) return;
    const handler = () => setShowCreateMenu(false);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [showCreateMenu]);

  // ---- CRUD ----

  const createNote = async (noteType: "note" | "code" | "todo") => {
    setShowCreateMenu(false);
    const language = noteType === "code" ? "Plain Text" : null;
    const todos = noteType === "todo" ? [{ text: "", status: "pending" as TodoStatus }] : null;
    try {
      const list = await invoke<NoteItem[]>("create_note", {
        noteType, title: "", content: "", language, todos,
      });
      setNotes(list);
      openModal(list[list.length - 1]);
    } catch (e) { console.error(e); }
  };

  const deleteNote = async (id: string) => {
    try {
      const list = await invoke<NoteItem[]>("delete_note", { id });
      setNotes(list);
      if (selected?.id === id) setSelected(null);
    } catch (e) { console.error(e); }
  };

  const archiveNote = async (id: string) => {
    try {
      const list = await invoke<NoteItem[]>("archive_note", { id });
      setNotes(list);
    } catch (e) { console.error(e); }
  };

  const unarchiveNote = async (id: string) => {
    try {
      const list = await invoke<NoteItem[]>("unarchive_note", { id });
      setNotes(list);
    } catch (e) { console.error(e); }
  };

  const doSave = useCallback(
    async (id: string, updates: Partial<NoteItem>) => {
      const note = notes.find((n) => n.id === id);
      if (!note) return;
      const merged = { ...note, ...updates };
      try {
        const list = await invoke<NoteItem[]>("update_note", {
          id,
          title: merged.title,
          content: merged.content,
          language: merged.language,
          todos: merged.todos,
        });
        setNotes(list);
        return list;
      } catch (e) { console.error(e); }
    },
    [notes]
  );

  const debouncedSave = useCallback(
    (id: string, field: string, value: unknown) => {
      if (saveTimers.current[id]) clearTimeout(saveTimers.current[id]);
      saveTimers.current[id] = setTimeout(() => doSave(id, { [field]: value }), 600);
    },
    [doSave]
  );

  // Bind keydown to editor textarea for completions
  useEffect(() => {
    const textarea = editorRef.current;
    if (!textarea) return;
    const handler = (e: KeyboardEvent) => {
      if (completions.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setCompletionIndex((i) => (i + 1) % completions.length);
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setCompletionIndex((i) => (i - 1 + completions.length) % completions.length);
        return;
      }

      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const item = completions[completionIndex];
        const result = applyCompletion(editContent, cursorPos, item);
        setEditContent(result.text);
        setCursorPos(result.cursorPos);
        setCompletions([]);
        if (selected) {
          setTimeout(() => {
            doSave(selected.id, { content: result.text });
          }, 0);
        }
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        setCompletions([]);
        return;
      }
    };
    textarea.addEventListener("keydown", handler, true);
    return () => textarea.removeEventListener("keydown", handler, true);
  }, [completions, completionIndex, editContent, cursorPos, selected, doSave]);

  // ---- Modal ----

  const openModal = (note: NoteItem) => {
    setSelected(note);
    setEditTitle(note.title);
    setEditContent(note.content);
    setEditLanguage(note.language ?? "Plain Text");
    setEditTodos(note.todos ?? []);
  };

  const closeModal = () => {
    if (!selected) return;
    doSave(selected.id, {
      title: editTitle, content: editContent,
      language: editLanguage, todos: editTodos,
    });
    setSelected(null);
  };

  const commitModal = async () => {
    if (!selected) return;
    await doSave(selected.id, {
      title: editTitle, content: editContent,
      language: editLanguage, todos: editTodos,
    });
    setSelected(null);
  };

  const copyContent = async (id: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch { /* noop */ }
  };

  const highlighted = useMemo(
    () => (selected?.note_type === "code" ? highlightCode(editContent, editLanguage) : ""),
    [selected, editContent, editLanguage]
  );

  // ---- Completion helpers ----

  const CHAR_WIDTH = 7.8;
  const LINE_HEIGHT = 13 * 1.7;

  const handleEditorChange = useCallback((code: string) => {
    setEditContent(code);
    if (selected) debouncedSave(selected.id, "content", code);
    const textarea = editorRef.current;
    if (!textarea) return;
    const pos = textarea.selectionStart;
    setCursorPos(pos);
    const items = getCompletions(editLanguage, code, pos);
    setCompletions(items);
    setCompletionIndex(0);
    if (items.length > 0) {
      const safePos = Math.min(pos, code.length);
      const posInfo = getCursorPosition(code, safePos, LINE_HEIGHT, CHAR_WIDTH, 20, 20);
      setCompletionPos({ top: posInfo.top, left: posInfo.left });
    }
  }, [selected, editLanguage, debouncedSave]);

  const handleCompletionClick = useCallback((item: CompletionItem) => {
    const result = applyCompletion(editContent, cursorPos, item);
    setEditContent(result.text);
    setCursorPos(result.cursorPos);
    setCompletions([]);
    if (selected) {
      doSave(selected.id, { content: result.text });
    }
  }, [editContent, cursorPos, selected, doSave]);

  // ---- Todo helpers ----

  const getStatus = (t: TodoItem): TodoStatus => {
    if (t.status && t.status !== "pending") return t.status;
    if (t.done === true) return "done";
    return t.status || "pending";
  };

  const STATUS_CYCLE: Record<TodoStatus, TodoStatus> = {
    pending: "done",
    done: "cancelled",
    cancelled: "deferred",
    deferred: "pending",
  };

  const cycleTodoStatus = (t: TodoItem): TodoStatus => {
    return STATUS_CYCLE[getStatus(t)];
  };

  const STATUS_CONFIG: Record<TodoStatus, { label: string; color: string; bg: string; icon: typeof Check }> = {
    pending: { label: "待办", color: "var(--text-muted)", bg: "transparent", icon: Check },
    done: { label: "完成", color: "var(--bg-success)", bg: "rgba(52,199,89,0.12)", icon: Check },
    cancelled: { label: "取消", color: "var(--bg-danger)", bg: "rgba(255,59,48,0.10)", icon: X },
    deferred: { label: "延后", color: "var(--bg-warning)", bg: "rgba(255,149,0,0.10)", icon: Clock },
  };

  const todoToggle = (i: number) => {
    const next = editTodos.map((t, idx) => idx === i ? { ...t, status: cycleTodoStatus(t), done: undefined } : t);
    setEditTodos(next);
    if (selected) doSave(selected.id, { todos: next });
  };

  const todoText = (i: number, text: string) => {
    const next = editTodos.map((t, idx) => idx === i ? { ...t, text } : t);
    setEditTodos(next);
    if (selected) debouncedSave(selected.id, "todos", next);
  };

  const todoAdd = () => {
    const next = [...editTodos, { text: "", status: "pending" as TodoStatus }];
    setEditTodos(next);
    if (selected) doSave(selected.id, { todos: next });
  };

  const todoDelete = (i: number) => {
    const next = editTodos.filter((_, idx) => idx !== i);
    setEditTodos(next);
    if (selected) doSave(selected.id, { todos: next });
  };

  const todoDone = editTodos.filter((t) => getStatus(t) === "done").length;
  const todoCancelled = editTodos.filter((t) => getStatus(t) === "cancelled").length;
  const todoDeferred = editTodos.filter((t) => getStatus(t) === "deferred").length;
  const todoActive = editTodos.filter((t) => getStatus(t) === "pending").length;
  const todoTotal = editTodos.length;

  // ---- Counts ----

  const activeNotes = useMemo(() => notes.filter((n) => !n.archived), [notes]);
  const archivedNotes = useMemo(() => notes.filter((n) => n.archived), [notes]);

  const counts = useMemo(() => {
    let n = 0, c = 0, t = 0;
    for (const note of activeNotes) {
      if (note.note_type === "note") n++;
      else if (note.note_type === "code") c++;
      else t++;
    }
    return { note: n, code: c, todo: t };
  }, [activeNotes]);

  const sortedNotes = useMemo(() => {
    const list = viewTab === "active" ? activeNotes : archivedNotes;
    return [...list].sort((a, b) => b.updated_at - a.updated_at);
  }, [activeNotes, archivedNotes, viewTab]);

  return (
    <div className="page-content animate-fade-in">
      {/* ===== Header ===== */}
      <div className="page-header" style={{ marginBottom: 16 }}>
        <div>
          <div className="page-title-row">
            <div
              className="page-icon"
              style={{
                background: "linear-gradient(135deg, rgba(255, 204, 0, 0.18), rgba(255, 149, 0, 0.1))",
                border: "none",
              }}
            >
              <StickyNote size={18} color="#ff9500" strokeWidth={2.2} />
            </div>
            <h2 className="page-title">便签</h2>
            <p className="page-subtitle">随手记录代码片段、待办事项和日常笔记</p>
          </div>
        </div>
        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setShowCreateMenu(!showCreateMenu); }}
            className="btn-primary flex items-center gap-1.5"
          >
            <Plus size={14} strokeWidth={2.5} />
            新建便签
            <ChevronDown
              size={12}
              className="transition-transform duration-200"
              style={{ transform: showCreateMenu ? "rotate(180deg)" : "rotate(0deg)" }}
            />
          </button>
          {showCreateMenu && (
            <div className="notes-create-menu">
              {(
                [
                  ["note", "普通便签", FileText, "#007aff", "随手记录想法"],
                  ["code", "代码片段", Code2, "#af52de", "保存代码片段"],
                  ["todo", "待办清单", ListTodo, "#ff9500", "追踪任务进度"],
                ] as const
              ).map(([type, label, Icon, color, desc]) => (
                <button
                  key={type}
                  onClick={() => createNote(type)}
                  className="notes-create-item"
                >
                  <div
                    className="notes-create-icon"
                    style={{
                      background: `rgba(${color === "#007aff" ? "0,122,255" : color === "#af52de" ? "175,82,222" : "255,149,0"}, 0.1)`,
                    }}
                  >
                    <Icon size={15} color={color} strokeWidth={2} />
                  </div>
                  <div>
                    <div className="text-[13px] font-semibold">{label}</div>
                    <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>{desc}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ===== Stats ===== */}
      {notes.length > 0 && (
        <div className="notes-stats">
          <div className="notes-stat-item">
            <StickyNote size={13} style={{ color: "var(--text-muted)" }} />
            <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              活跃 <span className="font-bold" style={{ color: "var(--text-primary)" }}>{activeNotes.length}</span> 条
            </span>
          </div>
          {counts.note > 0 && (
            <div className="notes-stat-item">
              <div className="w-2 h-2 rounded-full" style={{ background: "#007aff" }} />
              <span className="text-[11px] font-semibold" style={{ color: "#007aff" }}>
                {counts.note} 笔记
              </span>
            </div>
          )}
          {counts.code > 0 && (
            <div className="notes-stat-item">
              <div className="w-2 h-2 rounded-full" style={{ background: "#af52de" }} />
              <span className="text-[11px] font-semibold" style={{ color: "#af52de" }}>
                {counts.code} 代码
              </span>
            </div>
          )}
          {counts.todo > 0 && (
            <div className="notes-stat-item">
              <div className="w-2 h-2 rounded-full" style={{ background: "#ff9500" }} />
              <span className="text-[11px] font-semibold" style={{ color: "#ff9500" }}>
                {counts.todo} 待办
              </span>
            </div>
          )}
          {archivedNotes.length > 0 && (
            <div className="notes-stat-item">
              <Archive size={11} style={{ color: "var(--text-muted)" }} />
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                归档 <span className="font-bold" style={{ color: "var(--text-primary)" }}>{archivedNotes.length}</span> 条
              </span>
            </div>
          )}
        </div>
      )}

      {/* ===== Tab Switcher ===== */}
      {notes.length > 0 && (
        <div className="notes-tabs">
          <button
            className={`notes-tab ${viewTab === "active" ? "active" : ""}`}
            onClick={() => setViewTab("active")}
          >
            活跃 ({activeNotes.length})
          </button>
          <button
            className={`notes-tab ${viewTab === "archived" ? "active" : ""}`}
            onClick={() => setViewTab("archived")}
          >
            <Archive size={12} />
            已归档 ({archivedNotes.length})
          </button>
        </div>
      )}

      {/* ===== Empty State ===== */}
      {notes.length === 0 ? (
        <div className="panel">
          <div className="notes-empty">
            <div className="notes-empty-icon">
              <Sparkles size={32} color="#ff9500" strokeWidth={1.5} />
            </div>
            <p className="text-[15px] font-semibold" style={{ color: "var(--text-primary)", marginBottom: 6 }}>
              还没有便签
            </p>
            <p className="text-[13px]" style={{ color: "var(--text-muted)", maxWidth: 280, lineHeight: 1.6 }}>
              创建你的第一条便签，记录灵感、保存代码片段或管理待办事项
            </p>
            <div className="flex items-center gap-3 mt-5">
              {(
                [
                  ["note" as const, "写笔记", FileText, "#007aff"],
                  ["code" as const, "存代码", Code2, "#af52de"],
                  ["todo" as const, "列待办", ListTodo, "#ff9500"],
                ] as const
              ).map(([type, label, Icon, color]) => (
                <button
                  key={type}
                  onClick={() => createNote(type)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium transition-all"
                  style={{
                    background: `rgba(${color === "#007aff" ? "0,122,255" : color === "#af52de" ? "175,82,222" : "255,149,0"}, 0.08)`,
                    color,
                    border: `1px solid rgba(${color === "#007aff" ? "0,122,255" : color === "#af52de" ? "175,82,222" : "255,149,0"}, 0.15)`,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = `rgba(${color === "#007aff" ? "0,122,255" : color === "#af52de" ? "175,82,222" : "255,149,0"}, 0.14)`;
                    e.currentTarget.style.transform = "translateY(-1px)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = `rgba(${color === "#007aff" ? "0,122,255" : color === "#af52de" ? "175,82,222" : "255,149,0"}, 0.08)`;
                    e.currentTarget.style.transform = "translateY(0)";
                  }}
                >
                  <Icon size={14} strokeWidth={2} />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : sortedNotes.length === 0 ? (
        <div className="panel">
          <div className="notes-empty">
            <div className="notes-empty-icon">
              <Archive size={32} color="var(--text-muted)" strokeWidth={1.5} />
            </div>
            <p className="text-[15px] font-semibold" style={{ color: "var(--text-primary)", marginBottom: 6 }}>
              {viewTab === "archived" ? "没有已归档的便签" : "没有活跃的便签"}
            </p>
            <p className="text-[13px]" style={{ color: "var(--text-muted)", maxWidth: 280, lineHeight: 1.6 }}>
              {viewTab === "archived" ? "归档便签后会显示在这里" : "创建新便签或取消归档"}
            </p>
          </div>
        </div>
      ) : (
        /* ===== Card Grid ===== */
        <div className="notes-grid">
          {sortedNotes.map((note, idx) => {
            const info = TYPE_INFO[note.note_type];
            const Icon = info.icon;
            const isCode = note.note_type === "code";
            const isTodo = note.note_type === "todo";
            const todoItems = isTodo ? (note.todos ?? []) : [];
            const todoDoneCount = isTodo ? todoItems.filter(t => getStatus(t) === "done").length : 0;
            const todoCancelledCount = isTodo ? todoItems.filter(t => getStatus(t) === "cancelled").length : 0;
            const todoDeferredCount = isTodo ? todoItems.filter(t => getStatus(t) === "deferred").length : 0;
            const todoTotalCount = isTodo ? todoItems.length : 0;
            const todoActiveCount = isTodo ? todoTotalCount - todoCancelledCount : 0;
            const todoProgress = todoActiveCount > 0 ? todoDoneCount / todoActiveCount : 0;

            // Get first few lines of code for preview
            const codePreview = isCode
              ? note.content.split("\n").slice(0, 5).join("\n")
              : "";
            const highlightedPreview = isCode && codePreview
              ? highlightCode(codePreview, note.language)
              : "";

            return (
              <div
                key={note.id}
                className="notes-card notes-card-appear"
                style={{ animationDelay: `${Math.min(idx * 40, 400)}ms` }}
                onClick={() => openModal(note)}
              >
                {/* Top accent bar */}
                <div
                  className="notes-card-accent"
                  style={{ background: info.borderGradient }}
                />

                {/* Card content */}
                <div className="notes-card-header">
                  <div
                    className="notes-card-icon"
                    style={{ background: info.bg }}
                  >
                    <Icon size={14} color={info.color} strokeWidth={2} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div
                      className="notes-card-title"
                      style={{
                        color: note.title ? "var(--text-primary)" : "var(--text-muted)",
                      }}
                    >
                      {note.title || "未命名"}
                    </div>
                    <div
                      className="flex items-center gap-1 mt-0.5"
                      style={{ color: "var(--text-muted)" }}
                    >
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                        style={{
                          background: info.bg,
                          color: info.color,
                        }}
                      >
                        {info.label}
                      </span>
                      {isCode && note.language && (
                        <span className="text-[10px]">{note.language}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Body preview */}
                <div className="notes-card-body">
                  {isCode && highlightedPreview ? (
                    <pre
                      className="notes-card-code-preview hljs"
                      dangerouslySetInnerHTML={{ __html: highlightedPreview }}
                    />
                  ) : isTodo ? (
<div className="flex items-center gap-3">
                       <ProgressRing
                         done={todoDoneCount}
                         total={todoActiveCount}
                         color={todoProgress >= 1 && todoActiveCount > 0 ? "#34c759" : "#ff9500"}
                       />
                       <div>
                         <div
                           className="text-[13px] font-semibold"
                           style={{
                             color: todoProgress >= 1 && todoActiveCount > 0
                               ? "var(--bg-success)"
                               : "var(--text-primary)",
                           }}
                         >
                           {todoDoneCount}/{todoActiveCount}
                         </div>
                         <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
                           {todoProgress >= 1 && todoActiveCount > 0
                             ? "全部完成"
                             : todoActiveCount > 0
                               ? `${Math.round(todoProgress * 100)}% 已完成`
                               : "无待办任务"}
                           {todoCancelledCount > 0 && (
                             <span style={{ color: "var(--bg-danger)", opacity: 0.8 }}>{todoCancelledCount} 取消</span>
                           )}
                           {todoDeferredCount > 0 && (
                             <span style={{ color: "var(--bg-warning)", opacity: 0.8 }}>{todoDeferredCount} 延后</span>
                           )}
                         </div>
                       </div>
                     </div>
                  ) : (
                    <div className="notes-card-preview">
                      {note.content || "空内容"}
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="notes-card-footer">
                  <div className="flex items-center gap-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
                    <Clock size={10} />
                    <span>{formatDate(note.updated_at)}</span>
                  </div>
                  <div className="notes-card-actions">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        copyContent(
                          note.id,
                          isTodo
                            ? (note.todos ?? []).map(t => `${t.done ? "☑" : "☐"} ${t.text}`).join("\n")
                            : note.content
                        );
                      }}
                      className="notes-card-action-btn"
                      title="复制内容"
                    >
                      {copiedId === note.id ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        note.archived ? unarchiveNote(note.id) : archiveNote(note.id);
                      }}
                      className="notes-card-action-btn"
                      title={note.archived ? "取消归档" : "归档"}
                    >
                      {note.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteNote(note.id); }}
                      className="notes-card-action-btn danger"
                      title="删除"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ============================================
          MODAL (rendered via Portal to avoid ancestor transform issues)
          ============================================ */}
      {selected &&
        createPortal(
          <div className="notes-modal-overlay" onClick={closeModal}>
            <div className="notes-modal" onClick={(e) => e.stopPropagation()}>
              {/* ---- Modal Header ---- */}
              <div
                className="notes-modal-header"
                style={{ background: TYPE_INFO[selected.note_type].gradient }}
              >
                {/* Type badge */}
                <div
                  className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg shrink-0"
                  style={{
                    background: TYPE_INFO[selected.note_type].bg,
                    color: TYPE_INFO[selected.note_type].color,
                  }}
                >
                  {(() => { const I = TYPE_INFO[selected.note_type].icon; return <I size={12} strokeWidth={2.2} />; })()}
                  {selected.note_type === "code"
                    ? (editLanguage || "Text")
                    : TYPE_INFO[selected.note_type].label}
                </div>

                {/* Title input */}
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={() => {
                    if (selected && editTitle !== selected.title) doSave(selected.id, { title: editTitle });
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  placeholder="输入标题..."
                  className="flex-1 text-[15px] font-semibold bg-transparent border-none outline-none"
                  style={{ color: "var(--text-primary)" }}
                />

                {/* Actions */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => copyContent(
                      selected.id,
                      selected.note_type === "todo"
                        ? editTodos.map(t => `${t.done ? "☑" : "☐"} ${t.text}`).join("\n")
                        : editContent
                    )}
                    className="btn-secondary flex items-center gap-1.5 text-xs"
                  >
                    {copiedId === selected.id ? <Check size={12} /> : <Copy size={12} />}
                    {copiedId === selected.id ? "已复制" : "复制"}
                  </button>
                  <button
                    onClick={() => {
                      selected.archived ? unarchiveNote(selected.id) : archiveNote(selected.id);
                    }}
                    className="btn-secondary flex items-center gap-1.5 text-xs"
                    title={selected.archived ? "取消归档" : "归档"}
                  >
                    {selected.archived ? <ArchiveRestore size={12} /> : <Archive size={12} />}
                    {selected.archived ? "取消归档" : "归档"}
                  </button>
                  <button onClick={commitModal} className="btn-primary flex items-center gap-1.5 text-xs">
                    <Check size={13} strokeWidth={2.5} />完成
                  </button>
                  <button
                    onClick={closeModal}
                    className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
                    style={{ color: "var(--text-muted)" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-input)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              {/* ======== NOTE body ======== */}
              {selected.note_type === "note" && (
                <div className="notes-modal-body" style={{ minHeight: 380 }}>
                  <div
                    className="flex items-center gap-2 px-5 py-2.5 text-[10px] shrink-0"
                    style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border-color)" }}
                  >
                    <FileText size={11} />
                    <span>纯文本便签</span>
                    <span className="opacity-40">·</span>
                    <span>{editContent.length} 字</span>
                  </div>
                  <textarea
                    value={editContent}
                    onChange={(e) => {
                      setEditContent(e.target.value);
                      debouncedSave(selected.id, "content", e.target.value);
                    }}
                    placeholder="写点什么..."
                    className="flex-1 w-full text-[15px] leading-relaxed bg-transparent border-none outline-none resize-none p-5"
                    style={{ color: "var(--text-primary)" }}
                    autoFocus
                  />
                </div>
              )}

              {/* ======== CODE body ======== */}
              {selected.note_type === "code" && (
                <div className="flex flex-col flex-1 overflow-hidden">
                  {/* Toolbar */}
                  <div
                    className="flex items-center gap-3 px-5 py-2 shrink-0 text-[10px]"
                    style={{ borderBottom: "1px solid var(--border-color)", color: "var(--text-muted)" }}
                  >
                    <label className="flex items-center gap-1">
                      <Hash size={10} />
                      语言
                    </label>
                    <select
                      value={editLanguage}
                      onChange={(e) => {
                        setEditLanguage(e.target.value);
                        debouncedSave(selected.id, "language", e.target.value);
                      }}
                      className="macos-input text-[11px] py-0.5 w-28"
                      style={{ minHeight: 24, padding: "3px 8px" }}
                    >
                      {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                    <span className="opacity-40">·</span>
                    <span>{editContent.split("\n").length} 行</span>
                    <span className="opacity-40">·</span>
                    <span>{editContent.length} 字符</span>
                    <span className="opacity-40">·</span>
                    <span
                      className="flex items-center gap-1"
                      style={{ color: editLanguage !== "Plain Text" ? "var(--bg-success)" : "var(--text-muted)" }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{
                          background: editLanguage !== "Plain Text" ? "var(--bg-success)" : "var(--text-muted)",
                        }}
                      />
                      {editLanguage !== "Plain Text" ? "语法高亮" : "自动检测"}
                    </span>
                  </div>
                  {/* Single editor with syntax highlighting + completions */}
                  <div
                    ref={editorContainerRef}
                    className="flex-1 overflow-auto p-5"
                    style={{
                      background: "rgba(0,0,0,0.02)",
                      minHeight: 380,
                      position: "relative",
                    }}
                  >
                    <Editor
                      value={editContent}
                      onValueChange={handleEditorChange}
                      highlight={(code) =>
                        code
                          ? highlightCode(code, editLanguage)
                          : ""
                      }
                      padding={0}
                      tabSize={2}
                      insertSpaces
                      textareaId="notes-code-editor"
                      style={{
                        fontFamily:
                          '"SF Mono", SFMono-Regular, ui-monospace, monospace',
                        fontSize: 13,
                        lineHeight: "1.7",
                        minHeight: 320,
                      }}
                      textareaClassName="code-editor-textarea"
                      preClassName="code-editor-pre hljs"
                    />
                    {completions.length > 0 && (
                      <div
                        className="notes-completion-popup"
                        style={{
                          top: completionPos.top + LINE_HEIGHT + 4,
                          left: completionPos.left,
                        }}
                      >
                        {completions.map((item, i) => (
                          <div
                            key={item.label}
                            className={`notes-completion-item ${i === completionIndex ? "active" : ""}`}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              handleCompletionClick(item);
                            }}
                          >
                            <span
                              className="notes-completion-icon"
                              style={{ color: TYPE_COLORS[item.type] }}
                            >
                              {TYPE_ICONS[item.type]}
                            </span>
                            <span className="notes-completion-label">{item.label}</span>
                            {item.detail && (
                              <span className="notes-completion-detail">{item.detail}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ======== TODO body ======== */}
              {selected.note_type === "todo" && (
                <div className="notes-modal-body" style={{ minHeight: 380 }}>
                  {/* Progress header */}
                  <div
                    className="flex items-center gap-4 px-5 py-3.5 shrink-0"
                    style={{ borderBottom: "1px solid var(--border-color)" }}
                  >
                    <div className="flex-1 flex items-center gap-3">
                      <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: "var(--bg-input)" }}>
                        <div
                          className="h-full rounded-full transition-all duration-500 ease-out"
                          style={{
                            width: `${todoTotal > 0 ? (todoDone / todoTotal) * 100 : 0}%`,
                            background: todoDone === todoTotal && todoTotal > 0
                              ? "linear-gradient(90deg, #34c759, #30d158)"
                              : "linear-gradient(90deg, #ff9500, #ff9f0a)",
                          }}
                        />
                      </div>
                      <span
                        className="text-sm font-bold tabular-nums shrink-0"
                        style={{
                          color: todoDone === todoTotal && todoTotal > 0
                            ? "var(--bg-success)"
                            : "var(--text-muted)",
                        }}
                      >
                        {todoDone}/{todoTotal}
                      </span>
                    </div>
                    {todoTotal > 0 && todoDone === todoTotal && (
                      <span
                        className="text-[11px] font-semibold px-2.5 py-1 rounded-full flex items-center gap-1"
                        style={{ background: "rgba(52,199,89,0.12)", color: "var(--bg-success)" }}
                      >
                        <Check size={11} strokeWidth={2.5} />
                        全部完成
                      </span>
                    )}
                  </div>

                  {/* Todo items */}
                  <div className="flex-1 overflow-auto p-4">
                    <div className="flex flex-col gap-1">
                      {editTodos.map((todo, i) => (
                        <div key={i} className="notes-todo-item group/todo">
                          <button
                            onClick={() => todoToggle(i)}
                            className={`notes-todo-checkbox ${todo.done ? "checked" : ""}`}
                          >
                            {todo.done && <Check size={12} strokeWidth={3} />}
                          </button>
                          <input
                            type="text"
                            value={todo.text}
                            onChange={(e) => todoText(i, e.target.value)}
                            placeholder="输入任务内容..."
                            className="flex-1 text-[14px] bg-transparent border-none outline-none py-0.5"
                            style={{
                              color: todo.done ? "var(--text-muted)" : "var(--text-primary)",
                              textDecoration: todo.done ? "line-through" : "none",
                            }}
                            autoFocus={i === editTodos.length - 1 && todo.text === ""}
                          />
                          <button
                            onClick={() => todoDelete(i)}
                            className="shrink-0 w-6 h-6 rounded flex items-center justify-center opacity-0 group-hover/todo:opacity-100 transition-all"
                            style={{ color: "var(--text-muted)" }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = "rgba(255,59,48,0.1)";
                              e.currentTarget.style.color = "var(--bg-danger)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = "transparent";
                              e.currentTarget.style.color = "var(--text-muted)";
                            }}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>

                    {/* Add task button */}
                    <button
                      onClick={todoAdd}
                      className="flex items-center gap-2 mt-2 px-3 py-2.5 rounded-lg w-full text-[13px] transition-all border border-dashed"
                      style={{
                        color: "var(--text-muted)",
                        borderColor: "var(--border-color)",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "var(--bg-elevated)";
                        e.currentTarget.style.color = "var(--text-primary)";
                        e.currentTarget.style.borderStyle = "solid";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "transparent";
                        e.currentTarget.style.color = "var(--text-muted)";
                        e.currentTarget.style.borderStyle = "dashed";
                      }}
                    >
                      <Plus size={14} />
                      添加新任务
                    </button>
                  </div>
                </div>
              )}

              {/* ---- Footer ---- */}
              <div className="notes-modal-footer">
                <div className="flex items-center gap-1 text-[9px] leading-none" style={{ color: "var(--text-muted)" }}>
                  <Clock size={9} />
                  <span>
                    创建于 {formatTime(selected.created_at)}
                    {selected.updated_at !== selected.created_at && ` · 更新于 ${formatTime(selected.updated_at)}`}
                  </span>
                </div>
                <button
                  onClick={() => { deleteNote(selected.id); }}
                  className="flex items-center gap-1 px-2 py-1 rounded transition-colors text-[11px]"
                  style={{ color: "var(--text-muted)" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(255,59,48,0.1)";
                    e.currentTarget.style.color = "var(--bg-danger)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "var(--text-muted)";
                  }}
                >
                  <Trash2 size={10} />
                  删除此便签
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
