import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Coffee,
  ClipboardList,
  Camera,
  Activity,
  Globe,
  Database,
  Terminal,
  Paintbrush,
  StickyNote,
  Sparkles,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  Moon,
  Monitor,
  X,
  Check,
} from "lucide-react";
import { getStoredTheme, setStoredTheme, type ThemeMode } from "./hooks/useTheme";
import Caffeinate from "./features/caffeinate";
import Clipboard from "./features/clipboard";
import Screenshot from "./features/screenshot";
import Performance from "./features/performance";
import HttpClient from "./features/http-client";
import DatabasePage from "./features/database";
import SshShell from "./features/ssh-shell";
import TextBeautifier from "./features/text-beautifier";
import Notes from "./features/notes";
import MacCleaner from "./features/mac-cleaner";

const navGroups = [
  {
    label: "系统工具",
    items: [
      { id: "performance", to: "/performance", label: "性能监控", icon: Activity },
      { id: "mac-cleaner", to: "/mac-cleaner", label: "Mac 清理", icon: Paintbrush },
      { id: "caffeinate", to: "/caffeinate", label: "防休眠", icon: Coffee },
      { id: "clipboard", to: "/clipboard", label: "剪贴板", icon: ClipboardList },
      { id: "screenshot", to: "/screenshot", label: "截图", icon: Camera },
    ],
  },
  {
    label: "开发工具",
    items: [
      { id: "http-client", to: "/http-client", label: "HTTP 客户端", icon: Globe },
      { id: "text-beautifier", to: "/text-beautifier", label: "文本美化器", icon: Sparkles },
      { id: "ssh-shell", to: "/ssh-shell", label: "SSH Shell", icon: Terminal },
      { id: "database", to: "/database", label: "数据库", icon: Database },
      { id: "notes", to: "/notes", label: "便签", icon: StickyNote },
    ],
  },
];

function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(getStoredTheme);
  const location = useLocation();

  const handleThemeChange = (mode: ThemeMode) => {
    setTheme(mode);
    setStoredTheme(mode);
  };

  const themeOptions: { mode: ThemeMode; label: string; icon: typeof Sun }[] = [
    { mode: "light", label: "浅色", icon: Sun },
    { mode: "dark", label: "深色", icon: Moon },
    { mode: "system", label: "跟随系统", icon: Monitor },
  ];
  const activePath = location.pathname === "/" ? "/caffeinate" : location.pathname;
  const featurePanels = [
    { path: "/caffeinate", element: <Caffeinate /> },
    { path: "/clipboard", element: <Clipboard /> },
    { path: "/screenshot", element: <Screenshot /> },
    { path: "/performance", element: <Performance /> },
    { path: "/mac-cleaner", element: <MacCleaner /> },
    { path: "/http-client", element: <HttpClient /> },
    { path: "/text-beautifier", element: <TextBeautifier /> },
    { path: "/ssh-shell", element: <SshShell /> },
    { path: "/database", element: <DatabasePage /> },
    { path: "/notes", element: <Notes /> },
  ];

  return (
    <div className={`app-shell flex h-screen select-none ${sidebarCollapsed ? "sidebar-collapsed" : ""}`} style={{ background: "var(--bg-primary)" }}>
      {/* Sidebar */}
      <aside
        className="app-sidebar flex flex-col"
        style={{
          background: "var(--bg-sidebar)",
          borderColor: "var(--border-color)",
          backdropFilter: "saturate(180%) blur(20px)",
          WebkitBackdropFilter: "saturate(180%) blur(20px)",
        }}
      >
        {/* Logo */}
        <div className="sidebar-brand px-5 pt-5 pb-3">
          <div className="sidebar-brand-inner flex items-center gap-2.5 min-w-0">
            <button
              className="brand-mark flex items-center justify-center shrink-0 cursor-pointer"
              onClick={() => setShowSettings(true)}
              title="设置"
            >
              <img src="/icon.png" alt="Dioptase" />
            </button>
            <div className="sidebar-text min-w-0">
              <h1 className="text-[15px] font-semibold tracking-tight leading-none" style={{ color: "var(--text-primary)" }}>
                Dioptase
              </h1>
              <p className="text-[10px] font-medium tracking-wide" style={{ color: "var(--text-muted)" }}>
                Mac 工具箱
              </p>
            </div>
          </div>
          <button
            className="sidebar-toggle icon-action"
            onClick={() => setSidebarCollapsed((value) => !value)}
            title={sidebarCollapsed ? "展开侧边栏" : "收拢侧边栏"}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          </button>
        </div>

        <div className="px-3 pb-2">
          <div className="h-px" style={{ background: "var(--border-color)" }} />
        </div>

        {/* Nav */}
        <nav className="flex flex-col gap-4 px-3 py-2 flex-1 overflow-auto">
          {navGroups.map((group) => (
            <div key={group.label} className="nav-group">
              <div className="nav-group-label">{group.label}</div>
              <div className="flex flex-col gap-0.5">
                {group.items.map(({ id, to, label, icon: Icon }) => (
                  <NavLink
                    key={id}
                    to={to}
                    className="nav-item flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-200"
                    style={({ isActive }) => ({
                      backgroundColor: isActive ? "var(--bg-button)" : "transparent",
                      color: isActive ? "#fff" : "var(--text-secondary)",
                    })}
                  >
                    <Icon className="shrink-0" size={16} strokeWidth={2} />
                    <span className="sidebar-text">{label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="sidebar-footer px-5 py-3">
          <p className="sidebar-text text-[10px]" style={{ color: "var(--text-muted)" }}>
            Dioptase v0.1.0
          </p>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-hidden" style={{ background: "var(--bg-primary)" }}>
        {featurePanels.map((panel) => (
          <section
            key={panel.path}
            className="h-full overflow-auto"
            style={{ display: activePath === panel.path ? "block" : "none" }}
          >
            {panel.element}
          </section>
        ))}
      </main>

      {/* Settings Modal */}
      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 360, width: "100%" }}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
                设置
              </h3>
              <button onClick={() => setShowSettings(false)} className="icon-action" style={{ width: 28, height: 28 }}>
                <X size={14} />
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <div className="section-label mb-1">外观主题</div>
              <div className="flex flex-col gap-1.5">
                {themeOptions.map(({ mode, label, icon: Icon }) => (
                  <button
                    key={mode}
                    onClick={() => handleThemeChange(mode)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-200"
                    style={{
                      background: theme === mode ? "var(--bg-button)" : "transparent",
                      color: theme === mode ? "#fff" : "var(--text-secondary)",
                      border: theme === mode ? "none" : "1px solid var(--border-color)",
                    }}
                  >
                    <Icon size={16} strokeWidth={2} />
                    <span className="flex-1 text-left">{label}</span>
                    {theme === mode && <Check size={14} strokeWidth={2.5} />}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
