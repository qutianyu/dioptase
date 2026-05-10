import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Coffee, Play, Square, RefreshCw, Clock, Zap, Minus, Plus } from "lucide-react";

type CaffeinateStatus = {
  active: boolean;
  remaining_seconds: number | null;
};

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}时 ${m}分 ${s}秒`;
  if (m > 0) return `${m}分 ${s}秒`;
  return `${s}秒`;
}

export default function Caffeinate() {
  const [duration, setDuration] = useState<number>(0);
  const [durationText, setDurationText] = useState("0");
  const [status, setStatus] = useState<CaffeinateStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const updateDuration = (value: number) => {
    const next = Math.max(0, Math.min(24 * 60, Math.round(value)));
    setDuration(next);
    setDurationText(String(next));
    return next;
  };

  const commitDurationText = () => {
    const parsed = Number.parseInt(durationText, 10);
    return updateDuration(Number.isFinite(parsed) ? parsed : 0);
  };

  const stepDuration = (delta: number) => {
    updateDuration(duration + delta);
  };

  const refreshStatus = async () => {
    try {
      const s = await invoke<CaffeinateStatus>("caffeinate_status");
      setStatus(s);
    } catch (e) {
      console.error(e);
    }
  };

  const startCaffeinate = async () => {
    setLoading(true);
    try {
      const nextDuration = commitDurationText();
      await invoke("start_caffeinate", { durationMinutes: nextDuration });
      await refreshStatus();
    } finally {
      setLoading(false);
    }
  };

  const stopCaffeinate = async () => {
    setLoading(true);
    try {
      await invoke("stop_caffeinate");
      await refreshStatus();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshStatus();
    const interval = setInterval(refreshStatus, 1000);
    return () => clearInterval(interval);
  }, []);

  const quickDurations = [
    { label: "30 分钟", value: 30 },
    { label: "1 小时", value: 60 },
    { label: "2 小时", value: 120 },
    { label: "永久", value: 0 },
  ];

  const isActive = Boolean(status?.active);

  return (
    <div className="page-content animate-fade-in">
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title-row">
            <div className="page-icon" style={{ background: "rgba(255, 149, 0, 0.12)" }}>
              <Coffee size={18} color="#ff9500" strokeWidth={2} />
            </div>
            <h2 className="page-title">
              防休眠
            </h2>
            <p className="page-subtitle">
              封装 macOS caffeinate 命令，防止系统进入休眠状态
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4">
        {/* Main Control Card */}
        <div className="panel panel-pad">
          {/* Status */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${status?.active ? "animate-pulse-slow" : ""}`}
                style={{ background: status?.active ? "var(--bg-success)" : "var(--bg-danger)" }}
              />
              <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                {status?.active ? "正在防休眠" : "未运行"}
              </span>
            </div>
            {status?.active && status.remaining_seconds !== null && (
              <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                <Clock size={12} />
                <span>剩余 {formatDuration(status.remaining_seconds)}</span>
              </div>
            )}
          </div>

          <div className="divider" />

          {/* Duration Input */}
          <label className="section-label block mb-2">
            防休眠时长（分钟，0 = 永久）
          </label>
          <div className="caffeinate-duration-control mb-4">
            <button className="icon-action" onClick={() => stepDuration(-15)} disabled={duration === 0} title="减少 15 分钟">
              <Minus size={13} />
            </button>
            <div className="relative w-44">
              <input
                type="number"
                min={0}
                max={1440}
                step={15}
                value={durationText}
                onChange={(e) => setDurationText(e.target.value)}
                onBlur={commitDurationText}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.blur();
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    stepDuration(15);
                  }
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    stepDuration(-15);
                  }
                }}
                className="macos-input w-full pr-10"
                placeholder="0 = 永久防休眠"
              />
              <span className="duration-unit">分钟</span>
            </div>
            <button className="icon-action" onClick={() => stepDuration(15)} title="增加 15 分钟">
              <Plus size={13} />
            </button>
          </div>

          {/* Quick Select */}
          <div className="flex gap-2 mb-5">
            {quickDurations.map((d) => (
              <button
                key={d.value}
                onClick={() => updateDuration(d.value)}
                className="control-chip px-3 py-1.5 text-xs font-medium transition-all"
                style={{
                  background: duration === d.value ? "rgba(0, 122, 255, 0.1)" : "var(--bg-input)",
                  color: duration === d.value ? "var(--bg-button)" : "var(--text-secondary)",
                  borderColor: duration === d.value ? "rgba(0, 122, 255, 0.35)" : "var(--border-color)",
                  boxShadow: duration === d.value ? "0 1px 3px rgba(0, 122, 255, 0.1)" : "none",
                }}
              >
                {d.label}
              </button>
            ))}
          </div>

          {/* Actions */}
          <div className="flex gap-2.5">
            {isActive ? (
              <button
                onClick={stopCaffeinate}
                disabled={loading}
                className="btn-danger flex items-center gap-1.5"
              >
                <Square size={13} />
                {loading ? "停止中..." : "停止防休眠"}
              </button>
            ) : (
              <button
                onClick={startCaffeinate}
                disabled={loading}
                className="btn-primary flex items-center gap-1.5"
              >
                <Play size={14} />
                {loading ? "启动中..." : "启动防休眠"}
              </button>
            )}
            {isActive && (
              <button
                onClick={startCaffeinate}
                disabled={loading}
                className="btn-secondary flex items-center gap-1.5"
              >
                <Clock size={13} />
                更新时长
              </button>
            )}
            <button
              onClick={refreshStatus}
              className="btn-secondary flex items-center gap-1.5"
            >
              <RefreshCw size={13} />
              刷新
            </button>
          </div>
        </div>

        {/* Info Card */}
        <div className="panel panel-pad">
          <div className="flex items-center gap-2 mb-2">
            <Zap size={14} style={{ color: "var(--text-muted)" }} />
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              工作原理
            </span>
          </div>
          <p className="text-[13px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            调用 macOS 内置的 <code className="text-xs px-1.5 py-0.5 rounded" style={{ background: "var(--bg-input)", color: "var(--text-primary)" }}>caffeinate -i</code> 命令，阻止系统在空闲时进入休眠。
            可设置限时防休眠，也可选择永久防休眠直至手动停止。
          </p>
        </div>
      </div>
    </div>
  );
}
