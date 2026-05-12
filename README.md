# Dioptase

一个 macOS 原生工具箱应用，基于 Tauri + React 构建，集合了日常开发与系统管理中常用的多种工具。

## 功能概览

### 系统工具

| 工具        | 说明                                                             |
| ----------- | ---------------------------------------------------------------- |
| 📊 性能监控 | 实时展示 CPU、内存、磁盘、网络的用量与历史曲线，支持进程列表排序 |
| ☕ 防休眠   | 一键阻止系统休眠，支持定时关闭与快捷预设                         |
| 📋 剪贴板   | 自动记录剪贴板历史，支持置顶、回写、条数限制                     |
| 📸 截图     | 全屏或选区截取，内置预览与保存                                   |

### 开发工具

| 工具           | 说明                                                                       |
| -------------- | -------------------------------------------------------------------------- |
| 🌐 HTTP 客户端 | 发送 GET/POST/PUT/PATCH/DELETE 请求，自定义 Headers 与 Body，查看响应      |
| 🎨 文本处理    | JSON/XML/SQL 格式化与压缩、MD5 哈希、URL 编码/解码，支持 11 种语言自动检测 |
| 🖥 SSH Shell   | 远程终端连接 + SFTP 文件浏览，支持密码与密钥认证                           |
| 🗄 数据库      | MySQL / PostgreSQL / SQLite / Redis 客户端，SQL 查询与 Redis 命令执行      |
| 🔀 Git         | Git 仓库管理，支持变更暂存、提交、分支管理、分支比较、提交历史查看         |

## 技术栈

| 层级     | 技术                                               |
| -------- | -------------------------------------------------- |
| 前端     | React 19 · TypeScript · Tailwind CSS 4 · Vite 7 |
| 后端     | Rust · Tauri 2                                    |
| 数据库   | SQLx（MySQL / PostgreSQL / SQLite）· redis-rs     |
| 终端     | xterm.js · russh                                  |
| 代码高亮 | highlight.js · react-simple-code-editor           |
| 图标     | Lucide React                                       |

## 快速开始

### 环境要求

- macOS 14+
- Node.js 18+
- Rust 1.70+（通过 rustup 安装）

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run tauri dev
```

### 构建发布

使用打包脚本一键构建 DMG（macOS 14+）：

```bash
# 开发版（未签名）
./scripts/build.sh

# 签名的开发版（需要 Apple Developer ID）
CODE_SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" ./scripts/build.sh --sign

# 签名 + 公证的生产版
APPLE_ID="your@email.com" APPLE_TEAM_ID="TEAMID" APPLE_APP_PASSWORD="xxxx-xxxx-xxxx-xxxx" ./scripts/build.sh --release
```

也可以直接使用 Tauri CLI：

```bash
npm run tauri build
```

构建产物（DMG）位于 `src-tauri/target/release/bundle/dmg/`。

## 项目结构

```
dioptase/
├── public/                  # 静态资源
├── src/
│   ├── App.tsx              # 路由与布局
│   ├── main.tsx             # 入口
│   ├── styles/
│   │   └── globals.css      # 全局样式与主题变量
│   ├── features/
│   │   ├── caffeinate/      # 防休眠
│   │   ├── clipboard/       # 剪贴板
│   │   ├── screenshot/      # 截图
│   │   ├── performance/     # 性能监控
│   │   ├── http-client/     # HTTP 客户端
│   │   ├── text-processor/ # 文本处理
│   │   ├── ssh-shell/       # SSH Shell
│   │   ├── database/        # 数据库
│   │   └── git/             # Git 管理
│   └── hooks/
├── src-tauri/
│   ├── src/
│   │   └── commands/        # Tauri 命令（各功能后端）
│   ├── Cargo.toml
│   └── tauri.conf.json
├── scripts/
│   ├── build.sh             # macOS 打包脚本
│   └── entitlements.plist   # 签名授权文件
└── package.json
```

## 主题

支持三种外观模式：浅色、深色、跟随系统。主题切换即时生效，偏好设置自动保存。

## License

MIT
