# forever-token CLI 使用指南

## 📦 安装

```bash
npm install -g @anglyaoy/token-usage
```

## 🚀 快速开始

### 1. 初始化配置

首次使用需要初始化并绑定 CLI Key：

```bash
forever-token init
```

按提示输入从 4Ever 网站生成的 CLI Key。

### 2. 选择同步方式

#### 方式一：手动同步

每次需要上传数据时手动运行：

```bash
forever-token sync
```

**适用场景**：
- 偶尔使用 AI 工具
- 不想后台常驻进程
- 需要完全控制数据上传时机

#### 方式二：自动同步（推荐）

注册为系统服务，开机自启，每 5 分钟自动同步：

```bash
forever-token service setup
```

**适用场景**：
- 频繁使用 AI 工具
- 希望数据实时同步
- 无需手动操作

**支持平台**：
- ✅ macOS (launchd)
- ✅ Linux (systemd)
- ❌ Windows (暂不支持)

## 🔧 服务管理命令

### 查看所有服务命令

```bash
forever-token service
```

### 启动服务

```bash
forever-token service start
```

### 停止服务

```bash
forever-token service stop
```

### 重启服务

```bash
forever-token service restart
```

### 查看服务状态

```bash
forever-token service status
```

### 卸载服务

```bash
forever-token service uninstall
```

## 📊 查看本地统计

### 查看总体用量

```bash
forever-token
# 或
forever-token usage
```

显示本地所有 AI 工具的 Token 总消耗。

### 按月统计

```bash
forever-token monthly
```

### 按日统计（近三个月）

```bash
forever-token daily
# 或
forever-token dayly
```

### 查看状态

```bash
forever-token status
```

显示：
- 初始化状态
- 可发现的数据目录
- 本地快照统计

## 🗑️ 卸载

### 卸载 CLI 工具

```bash
npm uninstall -g @anglyaoy/token-usage
```

### 完整卸载（包括服务）

```bash
# 1. 先卸载系统服务（如果已设置）
forever-token service uninstall

# 2. 再卸载 CLI 工具
npm uninstall -g @anglyaoy/token-usage

# 3. 可选：删除配置文件
rm -rf ~/.forever-token
```

## 🔍 支持的 AI 工具

forever-token 会自动扫描以下工具的本地日志：

- ✅ Claude Code
- ✅ Codex
- ✅ Gemini CLI
- ✅ Qwen Code
- ✅ OpenCode
- ✅ OpenClaw
- ✅ 其他兼容工具

## 📝 常见问题

### Q: 如何查看服务日志？

**macOS:**
```bash
tail -f /tmp/forever-token.log
```

**Linux:**
```bash
journalctl --user -u forever-token.service -f
```

### Q: 服务没有自动启动怎么办？

**macOS:**
```bash
# 检查服务状态
launchctl print gui/$(id -u)/com.4ever.token-usage

# 手动启动
forever-token service start
```

**Linux:**
```bash
# 检查服务状态
systemctl --user status forever-token.service

# 手动启动
forever-token service start
```

### Q: 如何更新 CLI 到最新版本？

```bash
npm update -g @anglyaoy/token-usage
```

### Q: 数据会上传哪些内容？

只上传统计数据，不包含任何代码内容：
- Token 数量（输入、输出、reasoning、缓存）
- 会话时长
- 使用的模型
- 项目名称（默认 hash 匿名）
- 设备信息（hostname、device_id）

### Q: 如何停止自动同步？

```bash
forever-token service stop
```

或完全卸载服务：
```bash
forever-token service uninstall
```

### Q: 手动同步和自动同步可以共存吗？

可以。即使设置了自动同步，仍然可以手动运行 `forever-token sync`。

### Q: 如何修改同步间隔？

目前自动同步固定为 5 分钟。如需自定义，可以使用 daemon 命令：

```bash
# 每 10 分钟同步一次
forever-token daemon --interval 600000
```

但这需要手动保持终端运行，不如 `service setup` 方便。

## 🆘 获取帮助

```bash
# 查看帮助
forever-token help

# 查看版本
forever-token version
```

## 🔗 相关链接

- 4Ever 网站：https://your-4ever-domain.com
- GitHub 仓库：https://github.com/your-repo
- 问题反馈：https://github.com/your-repo/issues
