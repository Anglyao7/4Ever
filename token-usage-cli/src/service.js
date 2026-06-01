#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);

// macOS launchd 配置
const MACOS_LABEL = "com.4ever.token-usage";
const MACOS_PLIST_DIR = join(homedir(), "Library", "LaunchAgents");
const MACOS_PLIST_FILE = join(MACOS_PLIST_DIR, `${MACOS_LABEL}.plist`);
const LOG_DIR = "/tmp";
const STDOUT_LOG = join(LOG_DIR, "forever-token.log");
const STDERR_LOG = join(LOG_DIR, "forever-token-error.log");

// Linux systemd 配置
const LINUX_SERVICE_NAME = "forever-token.service";
const LINUX_SERVICE_DIR = join(homedir(), ".config", "systemd", "user");
const LINUX_SERVICE_FILE = join(LINUX_SERVICE_DIR, LINUX_SERVICE_NAME);

function getMacosUid() {
  return process.getuid ? process.getuid() : null;
}

function getMacosDomain() {
  const uid = getMacosUid();
  if (uid === null) throw new Error("无法获取当前用户 UID");
  return `gui/${uid}`;
}

function getMacosTarget() {
  return `${getMacosDomain()}/${MACOS_LABEL}`;
}

function generateMacosPlist(intervalMinutes = 5) {
  const nodePath = execSync("which node").toString().trim();
  const scriptPath = __filename.replace("/src/service.js", "/bin/forever-token.js");
  const intervalMs = intervalMinutes * 60 * 1000;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${MACOS_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${nodePath}</string>
      <string>${scriptPath}</string>
      <string>daemon</string>
      <string>--interval</string>
      <string>${intervalMs}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${homedir()}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
      <key>SuccessfulExit</key>
      <false/>
    </dict>
    <key>StandardOutPath</key>
    <string>${STDOUT_LOG}</string>
    <key>StandardErrorPath</key>
    <string>${STDERR_LOG}</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key>
      <string>/usr/local/bin:/usr/bin:/bin</string>
    </dict>
  </dict>
</plist>`;
}

function generateLinuxService(intervalMinutes = 5) {
  const scriptPath = execSync("which forever-token").toString().trim();
  const intervalMs = intervalMinutes * 60 * 1000;

  return `[Unit]
Description=4Ever Token Usage Sync Service
After=network.target

[Service]
Type=simple
ExecStart=${scriptPath} daemon --interval ${intervalMs}
Restart=on-failure
RestartSec=10
StandardOutput=append:${STDOUT_LOG}
StandardError=append:${STDERR_LOG}

[Install]
WantedBy=default.target`;
}

function isMacosServiceLoaded() {
  try {
    execSync(`launchctl print ${getMacosTarget()}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// macOS 服务管理
function setupMacosService(intervalMinutes = 5) {
  console.log(`🔧 设置 macOS launchd 服务（每 ${intervalMinutes} 分钟同步）...`);

  // 创建目录
  mkdirSync(MACOS_PLIST_DIR, { recursive: true });

  // 写入 plist 文件
  const plist = generateMacosPlist(intervalMinutes);
  writeFileSync(MACOS_PLIST_FILE, plist, "utf-8");
  console.log(`✅ 配置文件已创建: ${MACOS_PLIST_FILE}`);

  // 如果已加载，先卸载
  if (isMacosServiceLoaded()) {
    try {
      execSync(`launchctl bootout ${getMacosTarget()}`, { stdio: "ignore" });
    } catch {}
  }

  // 加载并启动服务
  const domain = getMacosDomain();
  const target = getMacosTarget();
  execSync(`launchctl bootstrap ${domain} ${MACOS_PLIST_FILE}`);
  execSync(`launchctl enable ${target}`);
  execSync(`launchctl kickstart -k ${target}`);

  console.log("✅ 服务已启动并设置为开机自启");
  console.log(`📊 查看状态: launchctl print ${target}`);
  console.log(`📝 查看日志: tail -f ${STDOUT_LOG}`);
}

function startMacosService() {
  if (!existsSync(MACOS_PLIST_FILE)) {
    console.error("❌ 服务未安装，请先运行: forever-token service setup");
    process.exit(1);
  }

  const target = getMacosTarget();

  if (!isMacosServiceLoaded()) {
    execSync(`launchctl bootstrap ${getMacosDomain()} ${MACOS_PLIST_FILE}`);
  }

  execSync(`launchctl enable ${target}`);
  execSync(`launchctl kickstart -k ${target}`);
  console.log("✅ 服务已启动");
}

function stopMacosService() {
  if (!existsSync(MACOS_PLIST_FILE)) {
    console.error("❌ 服务未安装");
    process.exit(1);
  }

  const target = getMacosTarget();
  execSync(`launchctl disable ${target}`);
  execSync(`launchctl kill SIGTERM ${target}`, { stdio: "ignore" });
  console.log("✅ 服务已停止");
}

function restartMacosService() {
  stopMacosService();
  startMacosService();
}

function statusMacosService() {
  if (!existsSync(MACOS_PLIST_FILE)) {
    console.log("❌ 服务未安装");
    return;
  }

  try {
    const output = execSync(`launchctl print ${getMacosTarget()}`).toString();
    console.log(output);
  } catch {
    console.log("❌ 服务未运行");
  }
}

function uninstallMacosService() {
  const target = getMacosTarget();

  try {
    execSync(`launchctl bootout ${target}`, { stdio: "ignore" });
  } catch {}

  if (existsSync(MACOS_PLIST_FILE)) {
    unlinkSync(MACOS_PLIST_FILE);
  }

  console.log("✅ 服务已卸载");
}

// Linux 服务管理
function setupLinuxService(intervalMinutes = 5) {
  console.log(`🔧 设置 Linux systemd 服务（每 ${intervalMinutes} 分钟同步）...`);

  // 创建目录
  mkdirSync(LINUX_SERVICE_DIR, { recursive: true });

  // 写入 service 文件
  const service = generateLinuxService(intervalMinutes);
  writeFileSync(LINUX_SERVICE_FILE, service, "utf-8");
  console.log(`✅ 配置文件已创建: ${LINUX_SERVICE_FILE}`);

  // 重载并启动服务
  execSync("systemctl --user daemon-reload");
  execSync(`systemctl --user enable ${LINUX_SERVICE_NAME}`);
  execSync(`systemctl --user start ${LINUX_SERVICE_NAME}`);

  console.log("✅ 服务已启动并设置为开机自启");
  console.log(`📊 查看状态: systemctl --user status ${LINUX_SERVICE_NAME}`);
  console.log(`📝 查看日志: journalctl --user -u ${LINUX_SERVICE_NAME} -f`);
}

function startLinuxService() {
  if (!existsSync(LINUX_SERVICE_FILE)) {
    console.error("❌ 服务未安装，请先运行: forever-token service setup");
    process.exit(1);
  }

  execSync(`systemctl --user start ${LINUX_SERVICE_NAME}`);
  console.log("✅ 服务已启动");
}

function stopLinuxService() {
  if (!existsSync(LINUX_SERVICE_FILE)) {
    console.error("❌ 服务未安装");
    process.exit(1);
  }

  execSync(`systemctl --user stop ${LINUX_SERVICE_NAME}`);
  console.log("✅ 服务已停止");
}

function restartLinuxService() {
  if (!existsSync(LINUX_SERVICE_FILE)) {
    console.error("❌ 服务未安装");
    process.exit(1);
  }

  execSync(`systemctl --user restart ${LINUX_SERVICE_NAME}`);
  console.log("✅ 服务已重启");
}

function statusLinuxService() {
  if (!existsSync(LINUX_SERVICE_FILE)) {
    console.log("❌ 服务未安装");
    return;
  }

  try {
    const output = execSync(`systemctl --user status ${LINUX_SERVICE_NAME}`).toString();
    console.log(output);
  } catch (err) {
    console.log("❌ 服务未运行");
  }
}

function uninstallLinuxService() {
  try {
    execSync(`systemctl --user stop ${LINUX_SERVICE_NAME}`, { stdio: "ignore" });
    execSync(`systemctl --user disable ${LINUX_SERVICE_NAME}`, { stdio: "ignore" });
  } catch {}

  if (existsSync(LINUX_SERVICE_FILE)) {
    unlinkSync(LINUX_SERVICE_FILE);
  }

  execSync("systemctl --user daemon-reload");
  console.log("✅ 服务已卸载");
}

// 主函数
export function runServiceCommand(action, ...args) {
  const os = platform();

  if (os !== "darwin" && os !== "linux") {
    console.error("❌ service 命令仅支持 macOS 和 Linux");
    process.exit(1);
  }

  const isMac = os === "darwin";

  if (!action) {
    console.log("forever-token service 命令");
    console.log("\n可用操作:");
    console.log("  setup [by N]  - 创建并启用服务（可选：by N 设置间隔为 N 分钟，默认 5）");
    console.log("  start         - 启动服务");
    console.log("  stop          - 停止服务");
    console.log("  restart       - 重启服务");
    console.log("  status        - 查看服务状态");
    console.log("  uninstall     - 卸载服务");
    console.log(`\n当前系统: ${isMac ? "macOS (launchd)" : "Linux (systemd)"}`);
    console.log("\n示例:");
    console.log("  forever-token service setup       # 每 5 分钟同步");
    console.log("  forever-token service setup by 10 # 每 10 分钟同步");
    console.log("  forever-token service setup by 60 # 每 60 分钟同步");
    return;
  }

  try {
    switch (action) {
      case "setup": {
        let intervalMinutes = 5;
        // 解析 by 参数
        if (args[0] === "by" && args[1]) {
          intervalMinutes = parseInt(args[1], 10);
          if (isNaN(intervalMinutes) || intervalMinutes < 1) {
            console.error("❌ 间隔必须是大于 0 的整数（单位：分钟）");
            process.exit(1);
          }
        }
        isMac ? setupMacosService(intervalMinutes) : setupLinuxService(intervalMinutes);
        break;
      }
      case "start":
        isMac ? startMacosService() : startLinuxService();
        break;
      case "stop":
        isMac ? stopMacosService() : stopLinuxService();
        break;
      case "restart":
        isMac ? restartMacosService() : restartLinuxService();
        break;
      case "status":
        isMac ? statusMacosService() : statusLinuxService();
        break;
      case "uninstall":
        isMac ? uninstallMacosService() : uninstallLinuxService();
        break;
      default:
        console.error(`❌ 未知操作: ${action}`);
        process.exit(1);
    }
  } catch (err) {
    console.error(`❌ 操作失败: ${err.message}`);
    process.exit(1);
  }
}
