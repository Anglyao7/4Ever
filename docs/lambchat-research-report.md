# LambChat 项目研究报告

## 概述

LambChat 是一个偏 Agent 平台化的 AI 聊天系统，不只是普通聊天前端加模型 API。它把对话、流式事件、MCP 工具、技能、长期记忆、模型配置、附件、多模态、运行记录和沙箱执行放在同一套后端运行时中。

从 4Ever 的角度看，LambChat 最值得学习的不是整体技术栈，而是它对 AI 聊天底座的设计方式：聊天请求不是一次性的文本问答，而是一次可追踪、可恢复、可挂载工具、可使用记忆和技能的 Agent 运行。

## 技术栈与整体架构

LambChat 的主要技术栈包括：

- 后端：FastAPI、LangGraph、deepagents、LangChain、MongoDB、Redis。
- 前端：React、SSE 客户端、聊天和 Agent 事件展示。
- 工具系统：MCP、多 transport server 管理、工具缓存、延迟工具发现。
- 技能系统：用户技能、技能文件、技能市场、技能提示词注入。
- 记忆系统：长期记忆写入、召回、检索、重排、自动记忆捕获。
- 附件系统：文件上传、对象存储、图片多模态输入、非图片摘要输入。
- 运行系统：后台任务、并发限制、事件流、trace 存储、会话历史。

它整体更像“聊天入口 + Agent runtime + 工具生态”的组合。普通聊天只是其中一个入口，真正的核心是后端运行时如何把模型、工具、技能、记忆和事件组织起来。

## 流式输出实现

LambChat 的流式输出采用两段式设计。

第一步，前端提交聊天请求，后端创建一次后台运行，返回会话标识和运行标识。第二步，前端再通过 SSE 订阅该运行的事件流。这样做的好处是，模型生成和工具调用不依赖前端连接本身，运行过程可以被后台任务管理、排队、限流、记录和恢复。

它的流式内容不是简单文本 chunk，而是一套事件协议。事件中既有模型回复文本，也有思考过程、工具开始、工具结果、Agent 调用、Agent 结果、token 用量、错误和结束信号。前端可以基于事件类型展示更丰富的运行过程，而不是只能看到最终回答。

事件写入采用双写逻辑：实时事件进入 Redis Stream，保证前端可以快速消费；完整 trace 批量进入 MongoDB，保证运行历史可审计、可回放。SSE 读取时会先重放已有事件，再阻塞等待新事件，并用 heartbeat 维持连接。

这个设计适合长任务、工具调用、多 Agent、断线恢复和历史回放。缺点是系统复杂度明显高于普通聊天流式，需要 Redis、后台任务、事件存储和事件协议配合。

4Ever 当前聊天流式更轻量，主要还是文本流。可以学习 LambChat 的事件协议思想，但不必一开始引入完整 Redis + MongoDB 双写。对于当前阶段，更适合先实现轻量 SSE 事件，例如：

- `message:chunk`：模型文本增量。
- `message:done`：模型回复完成。
- `run:error`：运行错误。
- `token:usage`：token 用量。
- `tool:start`：工具开始执行。
- `tool:result`：工具执行结果。

## MCP 实现

LambChat 的 MCP 不是硬编码工具，而是一套用户可配置的 MCP server 管理系统。它支持不同 transport 的 MCP 服务，并且针对 SSE、HTTP、sandbox 等类型做权限控制。

Agent 使用工具时并不是一次性加载所有 MCP 工具，而是在运行上下文中懒加载。这样可以避免每次会话启动时都扫描所有工具，也能根据用户、角色、会话配置过滤可用工具。

它还有一个很重要的设计：延迟工具发现。当 MCP 工具数量很多时，如果把所有工具 schema 全部塞进模型上下文，会占用大量 token，也会干扰模型决策。LambChat 会先把轻量工具列表交给模型，让模型需要时通过工具搜索找到候选工具，再暴露具体工具 schema。

这个设计对 4Ever 有参考价值。4Ever 已经有自己的 Agent/MCP workflow 方向，不应该直接复制 LambChat 的 MCP runtime。更合理的是在现有 Python 后端 MCP 体系上补充：

- MCP server 和 tool 的用户级启停。
- 工具 allowlist 和权限策略。
- 工具调用事件化展示。
- 工具 schema 缓存。
- 工具数量较多时的搜索式发现。
- 工具调用记录和失败追踪。

## Skills 实现

LambChat 的 Skills 是面向 Agent 的能力包。每个 skill 不只是一个 prompt，而是可以包含说明文档和相关文件。模型不会一开始读取所有技能内容，而是先看到技能名称和简短描述。只有当任务需要时，再读取具体的技能文档。

这种 progressive disclosure 的方式很重要。它既能让模型知道有哪些技能，又避免把大量技能细节一次性塞进上下文。对于技能数量越来越多的系统，这种方式比“把所有说明都拼进 system prompt”更稳定。

LambChat 还把 Skills 接入了虚拟文件系统，Agent 可以读取技能文件、搜索技能内容，甚至在特定权限下修改技能文件。这说明它的 Skills 更接近一个可管理的知识和工具包体系，而不是简单提示词模板。

对 4Ever 来说，短期没有必要实现完整技能市场、ZIP 上传、虚拟文件系统和技能文件编辑。更适合先做轻量 Skills：

- 每个 skill 有名称、描述和 `SKILL.md`。
- Persona 可以绑定默认 skills。
- Agent 调用前只注入 skill 列表。
- 模型需要时再读取具体 skill 内容。
- 后续再考虑技能文件、版本、市场和权限。

## Agent、RAG 与长期记忆

LambChat 明确涉及 Agent 技术。它使用 LangGraph 和 deepagents 组织 Agent 运行，把模型、工具、记忆、技能、子 Agent、checkpointer、store 和 middleware 组合起来。SearchAgent 支持更完整的工具和沙箱能力，FastAgent 则偏轻量。

Agent 运行中只传入新增消息，历史由 checkpointer 和消息状态维护。这一点很关键，可以避免每次请求都把完整历史重复拼接，也让长对话更容易被保存、恢复和裁剪。

RAG 方面，LambChat 没有表现为完整的文档 RAG 系统，也就是没有清晰看到“文件上传、文档解析、切块、embedding、向量检索、引用回答”的完整通用链路。它更强的是长期记忆检索，可以理解为 memory-based RAG。

它的长期记忆包括：

- 用户事实和偏好的保存。
- 对话后自动判断是否需要写入记忆。
- 记忆召回。
- 文本检索。
- 可选向量检索。
- 多路结果合并。
- rerank。
- 在模型调用前注入记忆索引。

这对 4Ever 非常有价值。4Ever 如果要提升 AI 聊天体验，长期记忆比一开始做复杂文档 RAG 更直接。建议把记忆分成两层：

- 短期记忆：当前会话历史、最近消息、运行状态。
- 长期记忆：用户偏好、人物关系、长期事实、项目背景、写作风格。

短期可以先用现有数据库实现轻量版本，不需要马上上 embedding。等长期记忆数量变多后，再加入向量召回和重排。

## AI 聊天基座逻辑

LambChat 的模型请求逻辑比普通 provider wrapper 更完整。它支持不同模型供应商、OpenAI-compatible API、自定义 base URL、API key、temperature、max tokens、vision 能力、fallback model、模型启停和模型权限。

聊天入口不会直接相信前端传来的模型配置，而是在服务端解析和校验。这样可以避免前端篡改 system prompt、越权使用模型或者绕过角色配置。模型能力，例如是否支持图片理解，也由服务端模型配置决定。

它的 LLM client 是 provider registry 模式。不同 provider 有各自的适配逻辑，但上层 Agent 不需要关心具体供应商。这个设计适合多模型系统，也适合未来扩展国产模型、OpenAI-compatible 服务或本地模型。

Persona 方面，LambChat 把角色人格、基础行为规则和技能绑定拆开管理。Persona preset 可以包含 system prompt、开场白、绑定技能、可见性和状态。聊天时由服务端解析 persona，再生成最终系统提示词。

这个设计比前端直接拼 system prompt 更安全，也更利于长期维护。4Ever 当前 AI 联系人的 persona 和 profile prompt 更偏前端管理，后续可以逐步迁移为后端托管：

- 前端只选择 persona 或 AI 联系人。
- 后端负责解析最终 system prompt。
- Persona 可以绑定默认技能、工具和记忆策略。
- 用户自定义 persona 需要权限和安全过滤。

## 图片与附件理解

LambChat 对附件做了比较清晰的分流。

如果附件是图片，并且当前模型支持 vision，就把图片作为多模态 `image_url` 内容交给模型。这样模型可以真正理解图片，而不是只看到“用户上传了一张照片”。

如果附件不是图片，或者模型不支持 vision，就把附件转成文本摘要、文件名、大小、类型和链接，让模型至少知道附件存在。文件上传系统还会处理权限、大小限制、hash 去重、对象存储和访问 URL。

4Ever 当前附件更多用于前端展示，发给 AI 时主要是文本描述。短期可以先做图片多模态能力：

- 附件先上传到后端。
- 后端返回可访问 URL 或内部文件 key。
- 聊天请求携带附件元数据。
- 如果模型支持 vision，图片作为 `image_url` 传给模型。
- 如果模型不支持 vision，降级为文本摘要。

文档类附件可以分阶段做。第一阶段只提供文件摘要和链接；第二阶段做文本抽取；第三阶段再做文档 RAG。

## 与 4Ever 的结合建议

4Ever 现在已经有 AI 聊天、AI 联系人、模型 profile、附件预览和 Agent/MCP workflow 的基础。LambChat 的价值不是让 4Ever 改成 Python + LangGraph，而是帮助 4Ever 把现有能力组织成更完整的 AI 聊天底座。

建议按阶段落地。

### 第一阶段：增强聊天基础体验

优先改 AI 聊天本身：

- 把 ChatPanel 从非流式为主改成真正使用流式。
- 后端流式从纯文本升级为轻量事件协议。
- 前端按事件类型渲染文本、错误、完成状态和 token 用量。
- 模型 profile 增加 `supportsVision`、fallback model、provider capability。
- 图片附件在 vision 模型下真正交给模型理解。

这一阶段不需要引入 Agent runtime，也不需要 Redis/Mongo 双写。目标是让 4Ever 的普通 AI 聊天先变得顺滑、可扩展。

### 第二阶段：后端托管 Persona 与记忆

把 AI 联系人的人格和记忆从“前端配置”逐步升级为“后端解析”：

- Persona 由后端保存和解析。
- AI 联系人绑定 persona、默认模型、默认技能和默认记忆策略。
- 聊天请求只传 persona id，不直接传完整 system prompt。
- 增加长期记忆表，支持 retain、recall、delete。
- 对话结束后由后台逻辑判断是否需要写入记忆。

这一阶段能明显提升 AI 聊天的连续性和角色稳定性。

### 第三阶段：聊天接入 MCP 工具

在 4Ever 已有 MCP/Agent workflow 基础上，让聊天面板也能使用工具：

- AI 聊天可以选择是否启用 MCP 工具。
- 工具调用过程通过 SSE 事件展示。
- 前端展示工具名称、执行状态、结果摘要和失败原因。
- 后端维护工具 allowlist，避免模型随意调用高风险工具。
- 工具调用记录进入会话历史或运行记录。

这一步可以让 AI 聊天从“回答问题”升级成“执行任务”。

### 第四阶段：轻量 Skills

在 Persona 和 MCP 稳定后，再做 Skills：

- 新增 skill 的名称、描述、说明文档。
- Persona 可以绑定 skills。
- 聊天运行时先注入技能列表。
- 模型需要时再读取具体 skill。
- 后续考虑技能市场、版本和权限。

Skills 适合承载写作风格、工作流规则、工具使用规范、项目知识和领域方法论。

### 第五阶段：文档 RAG 与复杂 Agent

最后再做完整文档 RAG 和复杂 Agent：

- 文件上传后抽取文本。
- 文档切块。
- embedding。
- 权限过滤。
- 召回和重排。
- 回答时带引用。
- 与 Agent 工具调用结合。

如果后续 4Ever 要做更复杂的自动化任务，可以继续增强现有 Python LangGraph runtime，再评估是否需要引入 deepagents。

## 不建议直接照搬的部分

LambChat 的完整架构很重。它同时依赖 MongoDB、Redis、deepagents、LangGraph checkpoint、对象存储、沙箱、MCP 管理、Skills 后端和权限系统。直接移植会带来很高维护成本。

4Ever 已经把 Agent/MCP workflow 收敛到 Python 后端。如果强行照搬 LambChat，容易出现两个 Agent runtime 并存：一个在 4Ever 的轻量 LangGraph workflow 中，一个在 LambChat/deepagents 风格运行时中。这会让模型配置、工具权限、运行历史、SSE 协议和前端展示都变复杂。

更稳妥的路线是：

- 保留 4Ever 现有 Python Agent/MCP 方向。
- 借鉴 LambChat 的事件协议和产品抽象。
- 先增强聊天流式、附件多模态、Persona 后端化和长期记忆。
- 等聊天底座稳定后，再接入 MCP、Skills 和 RAG。

## 结论

LambChat 的核心价值是把 AI 聊天从“请求一次模型 API”升级成“有状态、有工具、有记忆、有技能、有事件流的 Agent 运行”。这正好是 4Ever 后续 AI 能力可以学习的方向。

但它不适合整体搬迁。4Ever 应该吸收它的设计思想，尤其是事件化流式输出、服务端模型配置、Persona 后端解析、长期记忆、图片多模态和 MCP 工具事件展示。这样可以在不破坏现有架构的前提下，让 4Ever 的 AI 聊天逐步升级为真正的 Agent Chat。

## 本次落地记录（2026-06-04）

本次优先处理了三件紧急事项中的前两项，并按当前产品策略对第三项做了保守处理。

### 已完成：聊天流式升级为事件协议

聊天流式接口已经从纯文本 chunk 升级为轻量 SSE 事件协议。当前事件包括：

- `run:start`：一次聊天运行开始。
- `message:chunk`：模型回复增量内容。
- `token:usage`：模型返回的 token 用量信息，存在时透出。
- `model:fallback`：主模型失败后切到备用模型。
- `message:done`：回复完成。
- `run:error`：运行错误。

OpenAI-compatible provider 会继续走真实流式；Anthropic 和 Gemini 当前仍是完整请求后包装成统一事件流，先保证前端协议一致，后续再扩展它们的原生流式。

前端 ChatPanel 已经切到 `streamChat()`。发送 AI 消息后，界面会先显示等待状态；收到 `message:chunk` 后创建并增量更新 AI 气泡；完成后再把最终回复写入本地消息历史。如果流式中途失败但已经收到部分内容，会保留部分回复并提示错误。

### 已完成：模型配置开始后端托管

模型 profile 增加了后端同步能力。中枢页面会读取后端保存的模型配置；本地配置仍作为回退保留，避免后端临时不可用时影响使用。

本次新增和同步的模型能力字段包括：

- provider。
- base URL。
- API key。
- model。
- system prompt。
- temperature。
- max tokens。
- 是否支持图片理解。
- fallback model。
- persona 和 pet 的现有前端 profile 数据。

中枢页面新增了“支持图片理解”开关和“备用模型”输入框。聊天请求会把 profile id、vision capability 和 fallback model 一起发给后端。后端在主模型请求失败时，如果配置了备用模型，会自动使用同一 provider/base URL/API key 重新请求备用模型。

当前这还是“逐步迁移”的第一步：profile 已经可以同步到后端，但还不是生产级密钥管理。API key 仍然是明文保存在本地 SQLite 中，也没有按用户隔离。后续上线前需要加用户维度、加密存储、权限控制和审计。

### 已按当前策略处理：附件暂不传给 AI

附件这次没有做对象存储，也没有把本地文件、data URL 或图片内容传给 AI。

当前 AI 聊天仍然只会把附件元数据写进用户消息文本，包括文件名、类型和大小。这样模型知道用户随消息附带了文件或照片，但不会收到文件本体，也不会收到本地文件路径。

这个处理符合当前策略：本地开发阶段先不急着解决“文件如何安全交给 AI”。等后续部署上线，再单独设计本地文件服务、访问权限、临时 URL、图片转 `image_url`、文档抽取和 RAG。

### 已完成：MCP 迁移到 Python 后端

Agent/MCP workflow 已从 Go 实现收敛到 Python/FastAPI + LangGraph。Python 后端现在提供 backend-owned MCP 客户端，支持 BigModel Streamable HTTP JSON-RPC 的 `initialize`、`notifications/initialized`、`tools/list` 和 `tools/call`。

当前 MCP 运行策略包括：

- API key 只从后端环境变量读取，不发送给前端。
- MCP server 和 tool 继续走 catalog allowlist。
- 管理端可启停 MCP server，禁用后工具检查和 workflow run 都会被后端拒绝。
- 默认 planned mode；只有同时配置 `BIGMODEL_API_KEY` 和 `BIGMODEL_MCP_LIVE=1` 才发起真实远端调用。
- live 结果会做敏感字段脱敏和长度裁剪，再进入 API 响应或 Agent 节点输出。
- LangGraph workflow 的 `mcp` 节点会按节点语义选择对应 server/tool，例如搜索、网页读取、ZRead 仓库结构和文件读取。

项目配置也已从 `backend/go.mod` 脱钩，Python 后端按项目根目录、`python_backend` 和 `frontend` 识别运行根目录。环境样例迁移到 `python_backend/.env.example`，日常开发路径不再需要启动 Go 后端。

### 已完成的验证

本次完成后做了以下检查：

- 后端 Python 代码编译通过。
- 前端 TypeScript 检查和生产构建通过。
- Python 后端测试通过，包含新增的 provider/chat/MCP 相关测试。
- 新增测试覆盖了 OpenAI 流事件解析、SSE 事件格式、模型 profile 同步、vision/fallback 字段保存、MCP planned mode、工具 allowlist 和 Agent MCP 节点输出。

### 当前保留限制

- 聊天事件协议已经建立，但工具事件、思考事件、Agent run id、SSE replay 还没有接入普通聊天。
- 非 OpenAI provider 暂时只是事件包装，不是 token 级原生流式。
- 模型 profile 后端托管是全局配置，不是按用户隔离。
- API key 还没有加密。
- 附件不传给 AI，只传元数据。
- 图片模型能力字段已经有了，但真正的 `image_url` 多模态输入要等文件访问方案确定后再做。
- MCP 已支持远端 live 调用路径，但当前测试只覆盖 planned mode 和合同约束；真实 BigModel MCP 需要有效密钥后再做集成验证。

## 本次后续落地记录（2026-06-05）

本次继续推进第二阶段中“后端托管 Persona”的最小可验证版本，重点是让普通聊天运行开始真正使用后端保存的模型 profile，而不是只把 profile id 当作前端字段透传。

### 已完成：聊天运行按 profile id 解析后端配置

`/api/chat` 和 `/api/chat/stream` 现在会在收到 `profile_id` 时先读取后端 SQLite 中的模型 profile。命中 profile 后，后端会使用数据库中的 provider、base URL、API key、model、temperature、max tokens、vision capability 和 fallback model 覆盖前端传入的同名字段。

这让 profile id 开始具备后端权威配置含义。前端即使传入不同的 provider、model 或 key，只要 profile id 命中，实际运行仍以服务端 profile 为准。

### 已完成：服务端生成 Persona system prompt

后端会把 profile 中保存的 persona 字段和 system prompt 组合为运行时 system prompt。当前组合字段包括：

- `alias`：对话身份。
- `role`：角色定位。
- `temperament`：表达风格。
- `notes`：补充设定。
- `system_prompt`：模型 profile 的系统要求。

为了保持聊天页现有 AI 联系人体验，前端联系人设定仍会作为“客户端联系人上下文”传给后端并合并进运行时 prompt。但这只是兼容路径，还不是完整的后端 AI 联系人/persona 表。

### 已完成：降低前端 system prompt 覆盖风险

profile 模式下，后端会移除消息历史里的 `system` 角色消息，避免前端把 system message 混在普通 messages 中覆盖服务端 profile prompt。

如果 profile 不存在，后端返回 404；如果 profile 被禁用，后端返回 403。聊天页也做了兼容保护：只有从后端成功拉取到的 profile 才发送 `profile_id`；本地缓存 profile 继续按旧 payload 工作，避免后端没有对应 profile 时把本地 fallback 聊天打断。

### 已完成的验证

本次完成后做了以下检查：

- `python_backend/.venv/bin/python -m pytest python_backend/tests/test_providers.py`
- `python_backend/.venv/bin/python -m pytest python_backend/tests`
- `npm run build`（frontend）

新增测试覆盖了 profile id 解析、后端配置覆盖前端配置、profile persona/system prompt 组合、system 消息剔除，以及禁用 profile 拒绝聊天运行。

### 当前新增边界

- AI 联系人资料仍然保存在前端 localStorage，只是作为兼容上下文合并进后端 prompt。
- 还没有独立的 persona/contact 后端表，也没有按用户隔离 profile。
- API key 仍是 SQLite 明文存储。
- 长期记忆还没有落地。下一步更适合新增轻量 memory 表和 `retain` / `recall` 接口，再把 recall 结果注入聊天运行。
