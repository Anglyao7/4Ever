# 一键获取所有模型功能

## 概述

在接口中枢新增了"获取所有模型"功能，可以一键测试所有已配置的 API 连接，自动获取每个提供商的所有可用模型，并批量添加到模型列表中。

## 功能特性

### 1. 批量测试连接
- 自动遍历所有配置完整的 API
- 逐个测试连接并获取模型列表
- 显示实时进度

### 2. 智能去重
- 自动检测已存在的模型配置
- 只添加新的模型，避免重复

### 3. 自动命名
- 新模型配置自动命名为：`原API名称 - 模型名称`
- 例如：`工作助手 API - gpt-4o-mini`

### 4. 继承配置
- 新模型自动继承原 API 的所有配置
- 包括：API Key、接口地址、系统提示词、温度等

## 使用方法

### 步骤 1：配置 API

首先添加并配置至少一个 API：

1. 点击"新增 API"
2. 填写必填项：
   - API 名称
   - 供应商
   - 接口地址
   - 模型（任意一个）
   - API Key

### 步骤 2：一键获取

点击工具栏的"获取所有模型"按钮：

1. 系统会自动测试所有配置完整的 API
2. 显示实时进度：`正在获取 XXX 的模型列表... (1/3)`
3. 完成后显示结果统计

### 步骤 3：查看结果

获取完成后：
- 左侧列表会显示所有新增的模型配置
- 每个模型都是独立的配置，可以单独使用
- 可以进一步调整每个模型的参数

## 使用场景

### 场景 1：快速配置多个模型

```
1. 添加一个 OpenAI API 配置
2. 点击"获取所有模型"
3. 自动获取：gpt-4o, gpt-4o-mini, gpt-3.5-turbo 等
4. 每个模型都可以独立使用
```

### 场景 2：对比不同提供商

```
1. 配置 OpenAI API
2. 配置 Anthropic API
3. 配置 Gemini API
4. 点击"获取所有模型"
5. 一次性获取所有提供商的所有模型
```

### 场景 3：更新模型列表

```
当提供商新增模型时：
1. 点击"获取所有模型"
2. 自动获取新模型
3. 已存在的模型不会重复添加
```

## 工作原理

### 1. 过滤有效配置

```typescript
// 只处理配置完整的 API
const validProfiles = profiles.filter((profile) =>
  profile.name.trim() &&
  profile.baseUrl.trim() &&
  profile.model.trim() &&
  profile.apiKey.trim()
);
```

### 2. 逐个获取模型

```typescript
for (const profile of validProfiles) {
  // 调用 API 获取模型列表
  const result = await fetchProviderModels(profile);
  
  // 为每个模型创建新配置
  for (const model of result.models) {
    const newProfile = createProfile(
      `${profile.name} - ${model.label}`,
      provider
    );
    // 继承原配置
    newProfile.apiKey = profile.apiKey;
    newProfile.baseUrl = profile.baseUrl;
    // ...
  }
}
```

### 3. 去重合并

```typescript
// 生成唯一键
const key = `${provider}-${baseUrl}-${model}`;

// 过滤已存在的模型
const uniqueNewProfiles = newProfiles.filter((p) => {
  const key = `${p.provider}-${p.baseUrl}-${p.model}`;
  return !existingModelKeys.has(key);
});
```

## 进度显示

获取过程中会显示实时进度：

```
正在获取 工作助手 API 的模型列表... (1/3)
正在获取 个人助手 API 的模型列表... (2/3)
正在获取 测试 API 的模型列表... (3/3)
```

## 结果统计

完成后显示详细统计：

### 成功示例
```
成功获取 3 个 API 的模型，新增 12 个模型配置。
```

### 部分成功
```
成功获取 2 个 API 的模型，新增 8 个模型配置。1 个 API 获取失败。
```

### 无新模型
```
获取完成，但所有模型都已存在。成功 3 个，失败 0 个。
```

### 全部失败
```
获取失败。成功 0 个，失败 3 个。
```

## 注意事项

### 1. 需要配置完整的 API

按钮只在有配置完整的 API 时可用：
- ✅ 有配置：按钮可点击
- ❌ 无配置：按钮禁用，提示"请先添加至少一个 API 配置"

### 2. 获取过程不可中断

获取过程中：
- 按钮显示"获取中..."
- 按钮禁用，无法再次点击
- 显示实时进度

### 3. 失败不影响其他 API

如果某个 API 获取失败：
- 会继续处理其他 API
- 最终统计会显示失败数量
- 不会影响已成功获取的模型

### 4. 自动去重

重复点击"获取所有模型"：
- 不会创建重复的模型配置
- 只会添加新模型
- 已存在的模型会被跳过

## 与"测试连接"的区别

### 测试连接
- 只测试当前选中的 API
- 只返回模型数量
- 不创建新配置

### 获取所有模型
- 测试所有配置完整的 API
- 获取完整的模型列表
- 自动创建新配置

## API 支持

目前支持的提供商：
- ✅ OpenAI 兼容接口
- ✅ Anthropic
- ✅ Gemini
- ✅ 其他兼容 OpenAI 格式的提供商

## 后端接口

使用的 API 端点：
```
POST /api/catalog/provider/models
```

请求格式：
```json
{
  "provider": "openai",
  "base_url": "https://api.openai.com/v1",
  "api_key": "sk-...",
  "model": "gpt-4o-mini"
}
```

响应格式：
```json
{
  "models": [
    {
      "id": "gpt-4o",
      "label": "GPT-4o"
    },
    {
      "id": "gpt-4o-mini",
      "label": "GPT-4o Mini"
    }
  ]
}
```

## 常见问题

### Q: 为什么按钮是灰色的？

A: 需要先添加至少一个配置完整的 API（包含名称、接口地址、模型、API Key）。

### Q: 获取失败怎么办？

A: 检查：
1. API Key 是否正确
2. 接口地址是否正确
3. 网络连接是否正常
4. 提供商服务是否可用

### Q: 会创建很多重复的配置吗？

A: 不会，系统会自动去重，只添加新模型。

### Q: 可以删除不需要的模型吗？

A: 可以，在左侧列表选中模型，点击"删除"按钮。

### Q: 获取的模型配置可以修改吗？

A: 可以，选中模型后可以修改所有参数（名称、系统提示词、温度等）。

## 未来优化

🚧 **计划中**：
- 支持选择性获取（只获取指定的 API）
- 支持批量删除模型
- 支持模型分组管理
- 支持导出/导入模型配置
