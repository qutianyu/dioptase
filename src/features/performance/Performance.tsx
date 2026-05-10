import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Activity, Cpu, HardDrive, Clock, RotateCcw, ArrowDown, ArrowUp, Layers, Network, Zap, ListTree } from "lucide-react";

type ProcessInfo = {
  pid: number;
  name: string;
  cpu_usage: number;
  memory: number;
  memory_percent: number;
  disk_read_rate: number;
  disk_write_rate: number;
  run_time: number;
  status: string;
  energy_impact: number;
};

type SystemStats = {
  cpu_usage: number;
  memory_total: number;
  memory_used: number;
  memory_percent: number;
  cpu_name: string;
  cpu_cores: number;
  uptime: number;
  disk_total: number;
  disk_available: number;
  disk_used: number;
  disk_percent: number;
  disk_count: number;
  disk_read_rate: number;
  disk_write_rate: number;
  process_count: number;
  thread_count: number;
  network_received_rate: number;
  network_transmitted_rate: number;
  network_total_received: number;
  network_total_transmitted: number;
  energy_impact: number;
  processes: ProcessInfo[];
};

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb.toFixed(1)} GB`;
}

function formatDataSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${Math.round(bytes)} B`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}天 ${hours}时`;
  return `${hours}时 ${mins}分`;
}

type CpuDataPoint = {
  value: number;
  time: number;
};

function clampCpuValue(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function buildCpuLinePoints(history: CpuDataPoint[]): string {
  if (history.length === 0) return "";
  if (history.length === 1) {
    return `50,${100 - clampCpuValue(history[0].value)}`;
  }

  return history
    .map((pt, i) => {
      const x = (i / (history.length - 1)) * 100;
      const y = 100 - clampCpuValue(pt.value);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function formatSystemTimeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export default function Performance() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [cpuHistory, setCpuHistory] = useState<CpuDataPoint[]>([]);
  const intervalRef = useRef<number | null>(null);

  const fetchStats = async () => {
    try {
      const s = await invoke<SystemStats>("get_system_stats");
      setStats(s);
      setCpuHistory((prev) => {
        const next = [...prev, { value: s.cpu_usage, time: Date.now() }];
        if (next.length > 80) next.shift();
        return next;
      });
    } catch (e) {
      console.error(e);
    }
  };

  const startMonitoring = () => {
    fetchStats();
    intervalRef.current = window.setInterval(fetchStats, 1500);
  };

  useEffect(() => {
    startMonitoring();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const formatIoRate = (rate: number): string => {
    if (rate >= 1024 * 1024) return `${(rate / (1024 * 1024)).toFixed(1)} MB/s`;
    if (rate >= 1024) return `${(rate / 1024).toFixed(1)} KB/s`;
    return `${Math.round(rate)} B/s`;
  };

  return (
    <div className="page-content animate-fade-in">
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title-row">
            <div className="page-icon" style={{ background: "rgba(52, 199, 89, 0.12)" }}>
              <Activity size={18} color="#34c759" strokeWidth={2} />
            </div>
            <h2 className="page-title">
              性能监控
            </h2>
            <p className="page-subtitle">
              实时监控 macOS 系统性能指标
            </p>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="toolbar-panel flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full animate-pulse-slow" style={{ background: "var(--bg-success)" }} />
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>常驻监控 · 每 1.5 秒刷新</span>
        </div>
        <button onClick={fetchStats} className="btn-secondary flex items-center gap-1.5">
          <RotateCcw size={12} />
          刷新
        </button>
      </div>

      {stats && (
        <div className="grid grid-cols-4 gap-4">
          {/* CPU Card */}
          <div className="metric-card">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(0, 122, 255, 0.1)" }}>
                <Cpu size={14} color="#007aff" />
              </div>
              <div>
                <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>CPU</p>
                <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>{stats.cpu_name}</p>
              </div>
            </div>
            <div className="flex items-end gap-2 mb-3">
              <span className="text-3xl font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>
                {stats.cpu_usage.toFixed(1)}
              </span>
              <span className="text-lg font-medium mb-1" style={{ color: "var(--text-muted)" }}>%</span>
            </div>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {stats.cpu_cores > 0 ? `${stats.cpu_cores} 核心` : "核心数未知"}
            </p>
          </div>

          {/* Memory Card */}
          <div className="metric-card">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(52, 199, 89, 0.1)" }}>
                <HardDrive size={14} color="#34c759" />
              </div>
              <div>
                <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>内存</p>
                <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {formatBytes(stats.memory_used)} / {formatBytes(stats.memory_total)}
                </p>
              </div>
            </div>
            <div className="flex items-end gap-2 mb-3">
              <span className="text-3xl font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>
                {stats.memory_percent.toFixed(1)}
              </span>
              <span className="text-lg font-medium mb-1" style={{ color: "var(--text-muted)" }}>%</span>
            </div>
            <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg-input)" }}>
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${stats.memory_percent}%`,
                  background: stats.memory_percent > 80 ? "var(--bg-danger)" : stats.memory_percent > 60 ? "var(--bg-warning)" : "var(--bg-success)",
                }}
              />
            </div>
          </div>

          {/* Disk Card */}
          <div className="metric-card">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(175, 82, 222, 0.1)" }}>
                <HardDrive size={14} color="#af52de" />
              </div>
              <div>
                <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>磁盘</p>
                <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {formatBytes(stats.disk_used)} / {formatBytes(stats.disk_total)}
                </p>
              </div>
            </div>
            <div className="flex items-end gap-2 mb-3">
              <span className="text-3xl font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>
                {stats.disk_percent.toFixed(1)}
              </span>
              <span className="text-lg font-medium mb-1" style={{ color: "var(--text-muted)" }}>%</span>
            </div>
            <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg-input)" }}>
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${stats.disk_percent}%`,
                  background: stats.disk_percent > 90 ? "var(--bg-danger)" : stats.disk_percent > 75 ? "var(--bg-warning)" : "#af52de",
                }}
              />
            </div>
            <p className="text-[11px] mt-2" style={{ color: "var(--text-muted)" }}>
              可用 {formatBytes(stats.disk_available)} · {stats.disk_count} 个卷
            </p>
          </div>

          {/* Disk IO Card */}
          <div className="metric-card">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(0, 122, 255, 0.1)" }}>
                <Activity size={14} color="#007aff" />
              </div>
              <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>磁盘 IO</p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <ArrowDown size={13} color="#34c759" />
                <span className="text-sm font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                  {formatIoRate(stats.disk_read_rate)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <ArrowUp size={13} color="#ff3b30" />
                <span className="text-sm font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                  {formatIoRate(stats.disk_write_rate)}
                </span>
              </div>
            </div>
          </div>

          {/* Uptime Card */}
          <div className="metric-card">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(255, 149, 0, 0.1)" }}>
                <Clock size={14} color="#ff9500" />
              </div>
              <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>系统运行时间</p>
            </div>
            <span className="text-2xl font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
              {formatUptime(stats.uptime)}
            </span>
          </div>

          {/* Process Card */}
          <div className="metric-card">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(88, 86, 214, 0.1)" }}>
                <Layers size={14} color="#5856d6" />
              </div>
              <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>进程</p>
            </div>
            <div className="flex items-end gap-2 mb-2">
              <span className="text-3xl font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>
                {stats.process_count}
              </span>
              <span className="text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>个</span>
            </div>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              当前系统进程
            </p>
          </div>

          {/* Thread Card */}
          <div className="metric-card">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(52, 199, 89, 0.1)" }}>
                <ListTree size={14} color="#34c759" />
              </div>
              <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>线程</p>
            </div>
            <div className="flex items-end gap-2 mb-2">
              <span className="text-3xl font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>
                {stats.thread_count || "--"}
              </span>
              {stats.thread_count > 0 && <span className="text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>条</span>}
            </div>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              系统线程总数
            </p>
          </div>

          {/* Network Card */}
          <div className="metric-card">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(0, 122, 255, 0.1)" }}>
                <Network size={14} color="#007aff" />
              </div>
              <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>网络</p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <ArrowDown size={13} color="#34c759" />
                <span className="text-sm font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                  {formatIoRate(stats.network_received_rate)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <ArrowUp size={13} color="#ff3b30" />
                <span className="text-sm font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                  {formatIoRate(stats.network_transmitted_rate)}
                </span>
              </div>
            </div>
          </div>

          {/* Energy Card */}
          <div className="metric-card">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(255, 204, 0, 0.14)" }}>
                <Zap size={14} color="#ffcc00" />
              </div>
              <div>
                <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>能耗</p>
                <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>影响估算</p>
              </div>
            </div>
            <div className="flex items-end gap-2 mb-3">
              <span className="text-3xl font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>
                {stats.energy_impact.toFixed(0)}
              </span>
              <span className="text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>/ 100</span>
            </div>
            <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg-input)" }}>
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${Math.min(stats.energy_impact, 100)}%`,
                  background: stats.energy_impact > 70 ? "var(--bg-danger)" : stats.energy_impact > 40 ? "var(--bg-warning)" : "var(--bg-success)",
                }}
              />
            </div>
          </div>

          {/* CPU Chart */}
          <div className="metric-card col-span-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Activity size={14} style={{ color: "var(--text-muted)" }} />
                <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>CPU 使用率历史</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full animate-pulse-slow" style={{ background: "var(--bg-success)" }} />
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>实时</span>
              </div>
            </div>
            <div className="relative flex" style={{ height: 140 }}>
              {/* Y axis labels */}
              <div className="flex flex-col justify-between text-[10px] pr-2 text-right" style={{ color: "var(--text-muted)", width: 36 }}>
                <span>100%</span>
                <span>75%</span>
                <span>50%</span>
                <span>25%</span>
                <span>0%</span>
              </div>
              {/* Chart area */}
              <div className="flex-1 relative">
                {/* Grid lines */}
                <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div key={i} className="w-full" style={{ height: 1, background: i === 4 ? "var(--border-color)" : "rgba(127,127,127,0.08)" }} />
                  ))}
                </div>
                {/* Line */}
                <div className="absolute inset-0 rounded-sm overflow-hidden">
                  {cpuHistory.length === 0 ? (
                    <div className="h-full flex items-center justify-center">
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>暂无数据</span>
                    </div>
                  ) : (
                    (() => {
                      const linePoints = buildCpuLinePoints(cpuHistory);
                      const areaPoints = cpuHistory.length > 1 ? `0,100 ${linePoints} 100,100` : "";
                      const latest = cpuHistory[cpuHistory.length - 1];
                      const latestX = cpuHistory.length === 1 ? 50 : 100;
                      const latestY = 100 - clampCpuValue(latest.value);

                      return (
                        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="CPU 使用率折线图">
                          {areaPoints && (
                            <polygon
                              points={areaPoints}
                              fill="var(--bg-button)"
                              opacity="0.14"
                            />
                          )}
                          <polyline
                            points={linePoints}
                            fill="none"
                            stroke="var(--bg-button)"
                            strokeWidth="2.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            vectorEffect="non-scaling-stroke"
                          />
                          <circle
                            cx={latestX}
                            cy={latestY}
                            r="2.4"
                            fill="var(--bg-button)"
                            stroke="var(--bg-panel)"
                            strokeWidth="1.2"
                            vectorEffect="non-scaling-stroke"
                          />
                        </svg>
                      );
                    })()
                  )}
                </div>
              </div>
            </div>
            {/* X axis labels */}
            <div className="flex justify-between mt-1.5" style={{ paddingLeft: 36 }}>
              {cpuHistory.length === 0 ? (
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>--</span>
              ) : (() => {
                const oldest = cpuHistory[0];
                const middle = cpuHistory[Math.floor(cpuHistory.length / 2)];
                const latest = cpuHistory[cpuHistory.length - 1];
                return (
                  <>
                    <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                      {formatSystemTimeLabel(oldest.time)}
                    </span>
                    <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                      {formatSystemTimeLabel(middle.time)}
                    </span>
                    <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                      {formatSystemTimeLabel(latest.time)}
                    </span>
                  </>
                );
              })()}
            </div>
          </div>

          {/* Active Processes */}
          <div className="metric-card col-span-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Layers size={14} style={{ color: "var(--text-muted)" }} />
                <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>当前活动进程</span>
              </div>
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>按 CPU 使用率排序</span>
            </div>
            <div className="overflow-hidden rounded-md" style={{ border: "1px solid var(--border-color)" }}>
              <div className="grid grid-cols-[80px_minmax(0,1fr)_72px_96px_80px_96px_88px] gap-3 px-3 py-2 text-[10px] font-medium" style={{ color: "var(--text-muted)", background: "var(--bg-input)" }}>
                <span>PID</span>
                <span>进程名</span>
                <span className="text-right">CPU</span>
                <span className="text-right">内存</span>
                <span className="text-right">能耗</span>
                <span className="text-right">运行</span>
                <span className="text-right">状态</span>
              </div>
              <div className="divide-y" style={{ borderColor: "var(--border-color)" }}>
                {stats.processes.length === 0 ? (
                  <div className="px-3 py-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>暂无进程数据</div>
                ) : (
                  stats.processes.map((process) => (
                    <div
                      key={process.pid}
                      className="grid grid-cols-[80px_minmax(0,1fr)_72px_96px_80px_96px_88px] gap-3 px-3 py-2.5 items-center text-xs"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      <span className="tabular-nums" style={{ color: "var(--text-muted)" }}>{process.pid}</span>
                      <span className="truncate font-medium" style={{ color: "var(--text-primary)" }} title={process.name}>{process.name}</span>
                      <span className="text-right tabular-nums">{process.cpu_usage.toFixed(1)}%</span>
                      <span className="text-right tabular-nums">{formatDataSize(process.memory)}</span>
                      <span className="text-right tabular-nums">{process.energy_impact.toFixed(0)}</span>
                      <span className="text-right tabular-nums">{formatUptime(process.run_time)}</span>
                      <span className="text-right truncate" title={process.status}>{process.status}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

        </div>
      )}

      {!stats && (
        <div className="panel p-12 text-center">
          <Activity size={40} className="mx-auto mb-3" style={{ color: "var(--text-muted)" }} />
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            正在读取系统性能
          </p>
        </div>
      )}
    </div>
  );
}
