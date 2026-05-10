import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Camera, Aperture, Download, Image, Trash2, ScanLine, AlertCircle, Settings } from "lucide-react";

export default function Screenshot() {
  const [screenshotSrc, setScreenshotSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [permissionError, setPermissionError] = useState(false);

  const openScreenRecordingSettings = async () => {
    try {
      await openUrl("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture");
    } catch (e) {
      console.error(e);
    }
  };

  const captureAll = async () => {
    setLoading(true);
    setSaved(false);
    setPermissionError(false);
    try {
      const data = await invoke<string>("capture_screenshot");
      setScreenshotSrc(data);
    } catch (e) {
      if (String(e).includes("Failed to capture screen")) {
        setPermissionError(true);
      } else {
        console.error(e);
      }
    } finally {
      setLoading(false);
    }
  };

  const captureSelected = async () => {
    setLoading(true);
    setSaved(false);
    setPermissionError(false);
    try {
      const data = await invoke<string>("capture_selected_screenshot");
      setScreenshotSrc(data);
    } catch (e) {
      const message = String(e);
      if (message.includes("SCREEN_CAPTURE_PERMISSION_REQUIRED")) {
        setPermissionError(true);
      } else if (!message.startsWith("Screenshot cancelled")) {
        console.error(message);
      }
    } finally {
      setLoading(false);
    }
  };

  const saveScreenshot = async () => {
    if (!screenshotSrc) return;
    try {
      const filePath = await save({
        filters: [{ name: "PNG Image", extensions: ["png"] }],
        defaultPath: `screenshot-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.png`,
      });
      if (filePath) {
        await invoke("save_screenshot", { data: screenshotSrc, path: filePath });
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const clear = () => {
    setScreenshotSrc(null);
    setSaved(false);
  };

  return (
    <div className="page-content animate-fade-in">
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title-row">
            <div className="page-icon" style={{ background: "rgba(175, 82, 222, 0.12)" }}>
              <Camera size={18} color="#af52de" strokeWidth={2} />
            </div>
            <h2 className="page-title">
              截图
            </h2>
            <p className="page-subtitle">
              捕获屏幕截图并保存
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4">
        {/* Controls */}
        <div className="panel panel-pad">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold mb-0.5" style={{ color: "var(--text-primary)" }}>
                屏幕截图
              </h3>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                支持框选区域或捕获当前主显示器
              </p>
            </div>
            <div className="flex gap-2.5">
              <button
                onClick={captureSelected}
                disabled={loading}
                className="btn-primary flex items-center gap-1.5"
              >
                <ScanLine size={14} />
                {loading ? "截图中..." : "框选截图"}
              </button>
              <button
                onClick={captureAll}
                disabled={loading}
                className="btn-secondary flex items-center gap-1.5"
              >
                <Aperture size={14} />
                全屏
              </button>
              {screenshotSrc && (
                <>
                  <button
                    onClick={saveScreenshot}
                    className="btn-secondary flex items-center gap-1.5"
                    style={saved ? { color: "var(--bg-success)" } : {}}
                  >
                    {saved ? (
                      <>
                        <Download size={13} /> 已保存
                      </>
                    ) : (
                      <>
                        <Download size={13} /> 保存
                      </>
                    )}
                  </button>
                  <button
                    onClick={clear}
                    className="btn-secondary flex items-center gap-1.5"
                    style={{ color: "var(--bg-danger)" }}
                  >
                    <Trash2 size={13} />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {permissionError && (
          <div className="panel p-4" style={{ borderColor: "rgba(255, 149, 0, 0.28)" }}>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <AlertCircle size={16} className="mt-0.5" style={{ color: "var(--bg-warning)" }} />
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                    需要屏幕录制权限
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                    请在 macOS 系统设置中允许 Dioptase 录制屏幕，然后重启应用或重新截图。
                  </p>
                </div>
              </div>
              <button onClick={openScreenRecordingSettings} className="btn-secondary flex items-center gap-1.5 shrink-0">
                <Settings size={13} />
                打开系统设置
              </button>
            </div>
          </div>
        )}

        {/* Preview */}
        {screenshotSrc ? (
          <div className="panel p-3 animate-fade-in">
            <img
              src={`data:image/png;base64,${screenshotSrc}`}
              alt="Screenshot"
              className="w-full rounded-lg"
              style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}
            />
            <div className="flex items-center justify-between mt-3 px-1">
              <div className="flex items-center gap-2">
                <Image size={14} style={{ color: "var(--text-muted)" }} />
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  预览
                </span>
              </div>
              <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: "var(--bg-input)", color: "var(--text-muted)" }}>
                PNG
              </span>
            </div>
          </div>
        ) : (
          <div className="panel p-8 text-center animate-fade-in">
            <div className="py-10">
              <Camera size={40} className="mx-auto mb-3" style={{ color: "var(--text-muted)" }} />
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                点击「框选截图」捕获屏幕区域
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
