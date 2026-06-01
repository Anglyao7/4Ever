# 发布 @anglyaoy/token-usage 到 npm

## 前置准备

### 1. 确保已登录 npm

```bash
# 检查是否已登录
npm whoami

# 如果未登录，执行登录
npm login
# 输入你的 npm 用户名、密码、邮箱
```

### 2. 确认包名可用

```bash
# 检查包名是否已被占用
npm view @anglyaoy/token-usage

# 如果返回 404，说明包名可用
# 如果返回包信息，说明你已经发布过这个包
```

## 发布流程

### 方式一：快速发布（推荐）

```bash
cd /Users/ricardo/4Ever/token-usage-cli

# 1. 确保代码是最新的
git status

# 2. 更新版本号（自动修改 package.json）
npm version patch   # 0.1.0 -> 0.1.1 (bug 修复)
# 或
npm version minor   # 0.1.0 -> 0.2.0 (新功能)
# 或
npm version major   # 0.1.0 -> 1.0.0 (重大更新)

# 3. 发布到 npm
npm publish

# 4. 推送 git tag 到远程（如果有 git 仓库）
git push && git push --tags
```

### 方式二：手动控制版本

```bash
cd /Users/ricardo/4Ever/token-usage-cli

# 1. 手动修改 package.json 中的 version
# 例如：从 "0.1.0" 改为 "0.1.1"

# 2. 检查将要发布的文件
npm pack --dry-run

# 3. 发布
npm publish

# 4. 提交版本更新
git add package.json
git commit -m "chore: bump version to 0.1.1"
git tag v0.1.1
git push && git push --tags
```

## 版本号规范 (Semantic Versioning)

格式：`MAJOR.MINOR.PATCH` (例如：`1.2.3`)

- **PATCH** (0.1.0 -> 0.1.1): Bug 修复，向下兼容
- **MINOR** (0.1.0 -> 0.2.0): 新功能，向下兼容
- **MAJOR** (0.1.0 -> 1.0.0): 破坏性更新，不向下兼容

### 示例

```bash
# Bug 修复
npm version patch -m "fix: 修复同步失败的问题"

# 新功能
npm version minor -m "feat: 添加 service 命令支持后台服务"

# 重大更新
npm version major -m "feat!: 重构 CLI 架构"
```

## 发布前检查清单

- [ ] 代码已测试通过
- [ ] README.md 已更新
- [ ] CHANGELOG.md 已更新（如果有）
- [ ] package.json 中的 version 已更新
- [ ] 确认 files 字段包含所有必要文件
- [ ] 运行 `npm pack --dry-run` 检查打包内容

## 发布后验证

```bash
# 1. 检查包是否发布成功
npm view @anglyaoy/token-usage

# 2. 在新目录测试安装
cd /tmp
npm install -g @anglyaoy/token-usage
forever-token --help

# 3. 测试功能
forever-token status
```

## 常见问题

### 1. 发布失败：403 Forbidden

**原因**：没有权限发布到 @anglyaoy scope

**解决**：
```bash
# 确保你是 @anglyaoy 组织的成员
# 或者修改 package.json 中的 name 为你自己的 scope
```

### 2. 发布失败：版本号已存在

**原因**：该版本号已经发布过

**解决**：
```bash
# 更新版本号
npm version patch
npm publish
```

### 3. 发布失败：需要 2FA

**原因**：npm 账户启用了两步验证

**解决**：
```bash
# 发布时输入 2FA 验证码
npm publish --otp=123456
```

### 4. 想要撤回已发布的版本

**注意**：只能在发布后 72 小时内撤回

```bash
# 撤回指定版本
npm unpublish @anglyaoy/token-usage@0.1.1

# 撤回整个包（慎用！）
npm unpublish @anglyaoy/token-usage --force
```

## 发布 Beta 版本

如果想先发布测试版本：

```bash
# 更新为 beta 版本
npm version prerelease --preid=beta
# 例如：0.1.0 -> 0.1.1-beta.0

# 发布为 beta tag
npm publish --tag beta

# 用户安装 beta 版本
npm install -g @anglyaoy/token-usage@beta
```

## 自动化发布（可选）

### 使用 GitHub Actions

创建 `.github/workflows/publish.yml`：

```yaml
name: Publish to npm

on:
  push:
    tags:
      - 'v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          registry-url: 'https://registry.npmjs.org'
      - run: npm install
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

然后：
```bash
git tag v0.1.1
git push --tags
# GitHub Actions 会自动发布
```

## 推荐工作流

```bash
# 1. 开发完成后
git add .
git commit -m "feat: 添加新功能"

# 2. 更新版本并发布
npm version minor -m "feat: 添加 service 命令"
npm publish

# 3. 推送到 git
git push && git push --tags

# 4. 验证
npm view @anglyaoy/token-usage
```

## 快速命令参考

```bash
# 登录 npm
npm login

# 查看当前登录用户
npm whoami

# 查看包信息
npm view @anglyaoy/token-usage

# 更新版本
npm version patch|minor|major

# 发布
npm publish

# 发布 beta 版本
npm publish --tag beta

# 撤回版本（72小时内）
npm unpublish @anglyaoy/token-usage@0.1.1

# 查看包的所有版本
npm view @anglyaoy/token-usage versions

# 查看包的下载统计
npm view @anglyaoy/token-usage downloads
```
