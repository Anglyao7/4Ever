# forever-token service 命令实现方案

## 目标

实现类似 TokenArena 的 `service` 命令，让用户无需手动运行 daemon，系统自动后台同步。

## 命令设计

```bash
forever-token service setup      # 创建并启用服务
forever-token service start      # 启动服务
forever-token service stop       # 停止服务
forever-token service restart    # 重启服务
forever-token service status     # 查看服务状态
forever-token service uninstall  # 卸载服务
```

## macOS 实现 (launchd)

### 1. 服务配置文件

路径: `~/Library/LaunchAgents/com.4ever.token-usage.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.4ever.token-usage</string>

    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/usr/local/lib/node_modules/@anglyaoy/token-usage/bin/forever-token.js</string>
        <string>daemon</string>
        <string>--interval</string>
        <string>300000</string>
    </array>

    <key>WorkingDirectory</key>
    <string>/Users/USERNAME</string>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>

    <key>StandardOutPath</key>
    <string>/tmp/forever-token.log</string>

    <key>StandardErrorPath</key>
    <string>/tmp/forever-token-error.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
```

### 2. setup 命令实现

```javascript
async function setupMacosService() {
  const plistPath = path.join(os.homedir(), 'Library/LaunchAgents/com.4ever.token-usage.plist');
  const label = 'com.4ever.token-usage';

  // 1. 获取 node 和脚本路径
  const nodePath = execSync('which node').toString().trim();
  const scriptPath = path.resolve(__dirname, '../bin/forever-token.js');

  // 2. 生成 plist 内容
  const plist = generatePlist({
    label,
    nodePath,
    scriptPath,
    args: ['daemon', '--interval', '300000'],
    workingDir: os.homedir(),
    stdoutPath: '/tmp/forever-token.log',
    stderrPath: '/tmp/forever-token-error.log'
  });

  // 3. 创建目录并写入文件
  fs.mkdirSync(path.dirname(plistPath), { recursive: true });
  fs.writeFileSync(plistPath, plist, 'utf-8');

  // 4. 加载服务
  const uid = process.getuid();
  const domain = `gui/${uid}`;
  const target = `${domain}/${label}`;

  // 如果已加载，先卸载
  try {
    execSync(`launchctl bootout ${target}`, { stdio: 'ignore' });
  } catch {}

  // 加载并启动
  execSync(`launchctl bootstrap ${domain} ${plistPath}`);
  execSync(`launchctl enable ${target}`);
  execSync(`launchctl kickstart -k ${target}`);

  console.log('✅ 服务已设置并启动');
  console.log(`📄 配置文件: ${plistPath}`);
  console.log(`📊 查看状态: launchctl print ${target}`);
  console.log(`📝 查看日志: tail -f /tmp/forever-token.log`);
}
```

### 3. 其他命令实现

```javascript
async function startService() {
  const uid = process.getuid();
  const target = `gui/${uid}/com.4ever.token-usage`;
  execSync(`launchctl enable ${target}`);
  execSync(`launchctl kickstart -k ${target}`);
  console.log('✅ 服务已启动');
}

async function stopService() {
  const uid = process.getuid();
  const target = `gui/${uid}/com.4ever.token-usage`;
  execSync(`launchctl disable ${target}`);
  execSync(`launchctl kill SIGTERM ${target}`);
  console.log('✅ 服务已停止');
}

async function statusService() {
  const uid = process.getuid();
  const target = `gui/${uid}/com.4ever.token-usage`;
  try {
    const output = execSync(`launchctl print ${target}`).toString();
    console.log(output);
  } catch (err) {
    console.log('❌ 服务未运行');
  }
}

async function uninstallService() {
  const uid = process.getuid();
  const target = `gui/${uid}/com.4ever.token-usage`;
  const plistPath = path.join(os.homedir(), 'Library/LaunchAgents/com.4ever.token-usage.plist');

  try {
    execSync(`launchctl bootout ${target}`, { stdio: 'ignore' });
  } catch {}

  if (fs.existsSync(plistPath)) {
    fs.unlinkSync(plistPath);
  }

  console.log('✅ 服务已卸载');
}
```

## Linux 实现 (systemd)

### 1. 服务配置文件

路径: `~/.config/systemd/user/forever-token.service`

```ini
[Unit]
Description=4Ever Token Usage Sync Service
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/forever-token daemon --interval 300000
Restart=on-failure
RestartSec=10
StandardOutput=append:/tmp/forever-token.log
StandardError=append:/tmp/forever-token-error.log

[Install]
WantedBy=default.target
```

### 2. setup 命令实现

```javascript
async function setupLinuxService() {
  const serviceDir = path.join(os.homedir(), '.config/systemd/user');
  const servicePath = path.join(serviceDir, 'forever-token.service');
  const scriptPath = execSync('which forever-token').toString().trim();

  const serviceContent = `[Unit]
Description=4Ever Token Usage Sync Service
After=network.target

[Service]
Type=simple
ExecStart=${scriptPath} daemon --interval 300000
Restart=on-failure
RestartSec=10
StandardOutput=append:/tmp/forever-token.log
StandardError=append:/tmp/forever-token-error.log

[Install]
WantedBy=default.target
`;

  fs.mkdirSync(serviceDir, { recursive: true });
  fs.writeFileSync(servicePath, serviceContent, 'utf-8');

  execSync('systemctl --user daemon-reload');
  execSync('systemctl --user enable forever-token.service');
  execSync('systemctl --user start forever-token.service');

  console.log('✅ 服务已设置并启动');
  console.log(`📄 配置文件: ${servicePath}`);
  console.log(`📊 查看状态: systemctl --user status forever-token.service`);
  console.log(`📝 查看日志: journalctl --user -u forever-token.service -f`);
}
```

## 集成到 CLI

在 `src/index.js` 中添加：

```javascript
if (command === "service") {
  const action = args[0];
  const platform = os.platform();

  if (platform !== 'darwin' && platform !== 'linux') {
    console.error('service 命令仅支持 macOS 和 Linux');
    process.exit(1);
  }

  const backend = platform === 'darwin' ? macosService : linuxService;

  switch (action) {
    case 'setup': await backend.setup(); break;
    case 'start': await backend.start(); break;
    case 'stop': await backend.stop(); break;
    case 'restart': await backend.restart(); break;
    case 'status': await backend.status(); break;
    case 'uninstall': await backend.uninstall(); break;
    default:
      console.log('用法: forever-token service [setup|start|stop|restart|status|uninstall]');
  }

  return;
}
```

## 用户体验

```bash
# 用户只需运行一次
$ forever-token service setup
✅ 服务已设置并启动
📄 配置文件: ~/Library/LaunchAgents/com.4ever.token-usage.plist
📊 查看状态: launchctl print gui/501/com.4ever.token-usage
📝 查看日志: tail -f /tmp/forever-token.log

# 之后完全自动化
# - 开机自动启动
# - 每 5 分钟自动同步
# - 崩溃自动重启
# - 用户无需任何操作
```

## 优势对比

| 方式 | 用户操作 | 开机自启 | 异常恢复 | 推荐度 |
|------|---------|---------|---------|--------|
| **service setup** | 一次 | ✅ | ✅ | ⭐⭐⭐⭐⭐ |
| daemon 命令 | 每次手动 | ❌ | ❌ | ⭐⭐ |
| cron | 手动配置 | ✅ | ❌ | ⭐⭐⭐ |

## 实现优先级

1. **macOS launchd** - 最常用的开发环境
2. **Linux systemd** - 服务器环境
3. **Windows** - 可选，使用 NSSM 或 Task Scheduler
