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

### 当前保留限制（截至 2026-06-04）

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

### 当前新增边界（截至 2026-06-05）

- AI 联系人资料仍然保存在前端 localStorage，只是作为兼容上下文合并进后端 prompt。
- 还没有独立的 persona/contact 后端表，也没有按用户隔离 profile。
- API key 仍是 SQLite 明文存储。
- 长期记忆还没有落地。下一步更适合新增轻量 memory 表和 `retain` / `recall` 接口，再把 recall 结果注入聊天运行。

## 本次后续落地记录（2026-06-06）

本次把第二阶段和第三阶段的核心底座向前推进，同时为普通聊天接入 MCP、附件 vision 和 run 事件记录打好兼容基础。

### 已完成：模型 profile 用户隔离与密钥加密

模型 profile 现在在后端按用户隔离。请求带 `Authorization` token 时，profile 会写入该用户空间；未登录或本地开发没有 token 时，继续使用 legacy 全局空间，避免线下开发和旧流程中断。

API key 不再以明文写入登录用户的 SQLite `api_key` 字段，而是写入 `api_key_encrypted`。后端使用 Fernet 加密，配置来源是 `MODEL_PROFILE_ENCRYPTION_KEY`；如果未配置，会使用本地开发派生 key。生产部署必须设置稳定的 `MODEL_PROFILE_ENCRYPTION_KEY`，否则后续变更环境或路径可能导致旧密钥无法解密。

登录用户拉取 profile 时，后端只返回 `api_key_set`，不回传明文 key。聊天、模型列表和连接测试会通过 `profile_id` 在后端解析已保存密钥。本地未登录模式仍返回 legacy 明文 key，保持线下兼容。

### 已完成：后端 Persona / AI 联系人表

新增后端 persona 接口：

- `GET /api/chat/personas`
- `POST /api/chat/personas`
- `DELETE /api/chat/personas/{persona_id}`

Persona 支持 `id`、名称、角色定位、表达风格、补充设定、默认模型 profile 和默认记忆策略。聊天请求可以传 `persona_id` / `contact_id`，后端会从 persona 解析默认 profile 和 system prompt。没有传 persona 时，旧 profile persona 兼容逻辑仍保留。

### 已完成：轻量长期记忆

新增 memory 表和接口：

- `POST /api/chat/memory/retain`
- `GET /api/chat/memory/recall`
- `DELETE /api/chat/memory/{memory_id}`

聊天运行前会按用户和 persona 召回少量记忆，并注入 system prompt。当前召回是轻量文本匹配，不是 embedding/RAG。记忆策略支持 `off`、`recall`、`retain` 和 `recall-retain`。自动写入先采用保守规则，只在用户明确表达“记住/偏好/喜欢”等信号时写入。

### 已完成：普通聊天 run id、事件持久化和 MCP 工具事件

新增 `chat_runs` 表。`/api/chat` 和 `/api/chat/stream` 会创建 run id，并把 SSE 事件写入 `events_json`。新增查询接口：

- `GET /api/chat/runs`
- `GET /api/chat/runs/{run_id}/events`

普通聊天流式事件现在包含 `run_id`，并支持 `tool:start` / `tool:result`。聊天请求可以传 `mcp_server_ids`，后端按 MCP server allowlist 和管理端启停状态执行 planned/live 工具调用，并把工具结果作为上下文注入模型请求。当前还是预执行工具上下文，不是模型自主 tool-call loop。

OpenAI-compatible、Anthropic 和 Gemini 都已接入各自的原生流式分支。Anthropic 解析 `content_block_delta`，Gemini 使用 `:streamGenerateContent?alt=sse` 并解析 SSE chunk。这样普通聊天不再只对非 OpenAI provider 做完整响应包装。

### 已完成：附件图片理解基础路径

前端会把聊天消息中的附件元数据和图片 data URL 一起传给后端。后端会按 provider 转成对应 vision 输入：OpenAI-compatible 使用 `image_url` content part，Anthropic 使用 `image` content block，Gemini 使用 `inline_data` part。非 vision 模型和非图片附件仍降级为附件元数据文本。

### 已完成的验证和 review

本次完成后做了以下检查：

- `python_backend/.venv/bin/python -m compileall python_backend/app`
- `python_backend/.venv/bin/python -m pytest python_backend/tests/test_providers.py -q`
- `python_backend/.venv/bin/python -m pytest python_backend/tests -q`
- `npm run build`（frontend）

测试覆盖新增了：用户隔离 profile、同名 profile 跨用户不冲突、登录用户密钥密文存储且不回传、后端解密 profile key、persona 默认 profile 解析、memory recall 注入 prompt、chat run 持久化、MCP `tool:start` / `tool:result` 事件持久化，以及 Anthropic/Gemini 流式事件解析。

代码 review 重点确认了以下上线兼容点：

- 有 token 走用户隔离；无 token 继续走 legacy 全局空间。
- 旧 SQLite 明文 `api_key` 仍可读取，下一次同步后会写入密文字段。
- 登录用户 profile 返回空 `api_key` 和 `api_key_set=true`，前端不会因此判定 profile 不可用。
- `MODEL_PROFILE_ENCRYPTION_KEY` 必须在生产保持稳定。
- MCP live 仍由 `BIGMODEL_MCP_LIVE` 和后端环境变量控制，不会从前端接收 MCP key。

### 当前保留限制

- 聊天页 AI 联系人 UI 已在登录态接入后端 persona 接口；未登录状态仍保留 localStorage fallback，保证线下和未登录体验不被打断。
- 长期记忆是轻量文本匹配，尚未做 embedding、rerank 或引用溯源。
- 该节点普通聊天 MCP 是后端预执行工具上下文；后续已为 OpenAI-compatible live MCP 补齐最小自主 tool-call loop。
- Anthropic / Gemini 已接入原生流式解析，但还没有真实外部密钥下的端到端集成验证。
- OpenAI-compatible、Anthropic 和 Gemini 的图片 data URL 请求格式都已接入；真实外部密钥下的端到端验证仍需后续补齐。
- API key 加密依赖 `MODEL_PROFILE_ENCRYPTION_KEY`，生产上线前需要把该变量纳入部署密钥管理和备份流程。

## 本次后续落地记录（2026-06-06，前端 Persona 接入）

本次继续补齐第一阶段的前端消费层：聊天页不再只依赖 localStorage AI 联系人。登录用户进入聊天页时会读取 `/api/chat/personas`，如果后端已有 persona，就用后端记录作为当前 AI 联系人；如果没有记录，会把本地默认联系人迁移创建为后端 persona。

聊天页保存 AI 联系人资料时，会写入 `/api/chat/personas`。发送普通 AI 聊天时，如果当前 profile 和 persona 都来自后端，前端只发送 `profile_id` 和 `persona_id`，不再发送完整人格 system prompt。未登录或后端 profile 不可用时，仍保留旧的本地 system prompt fallback，保证线下开发兼容。

同时修复了附件路径的一个前端问题：`messagesForAIProvider()` 现在保留 `attachments`，只追加附件元数据摘要，不再把附件对象删除。这样后端 vision 分支可以真正收到图片 data URL，并按 provider 转成对应多模态输入。

### 已完成的验证

- `npm run build`（frontend）
- `python_backend/.venv/bin/python -m pytest python_backend/tests -q`
- `python_backend/.venv/bin/python -m compileall python_backend/app`

### 当前新增边界

- 聊天页已经支持多 AI persona 的列表、切换、创建、保存和删除。
- Persona UI 已经暴露默认模型 profile 和 memory strategy 选择。

## 本次后续落地记录（2026-06-06，多 Persona 管理）

本次把聊天页的后端 persona 消费从“单个默认联系人”继续推进到多 persona 管理。

### 已完成

- AI 资料面板会展示后端 persona 列表。
- 用户可以在聊天页切换当前 AI persona。
- 新建 AI 会话会创建后端 persona，并切换为当前联系人。
- 保存资料会更新当前后端 persona。
- 登录态可以删除当前 persona，删除后自动切换到剩余 persona 或本地默认联系人。
- Persona 编辑 UI 增加默认模型 profile 选择。
- Persona 编辑 UI 增加记忆策略选择：`recall-retain`、`recall`、`retain`、`off`。

### 兼容性

- 登录态使用后端 persona 作为权威数据源。
- 未登录状态继续使用 localStorage 单联系人 fallback。
- 如果后端 persona 暂时不可用，聊天页会保留当前本地联系人，不会阻断普通聊天。
- 聊天请求在后端 profile + 后端 persona 同时可用时只传 `profile_id` 和 `persona_id`。

### 已完成的验证

- `npm run build`（frontend）
- `python_backend/.venv/bin/python -m pytest python_backend/tests -q`
- `python_backend/.venv/bin/python -m compileall python_backend/app`
- 本地服务 HTTP 检查：
  - `http://127.0.0.1:7777` 返回 200。
  - `http://127.0.0.1:7778/health` 返回 `{"status":"ok"}`。

### 该节点剩余边界

- 多 persona UI 还没有单独的专用管理页，只在聊天页资料面板内管理。
- 记忆记录和 MCP 工具选择已经进入聊天页资料面板，但仍是轻量入口，还不是专用管理页。
- 普通聊天 MCP 仍是 server 级选择和后端预执行上下文，不是模型自主 tool-call loop。

## 本次后续落地记录（2026-06-06，记忆与 MCP 前端接入）

本次把后端已经完成的长期记忆和普通聊天 MCP 能力接到聊天页资料面板，补齐前端消费层。

### 已完成

- 新增前端 memory 类型和 API 封装：`fetchAiMemories`、`retainAiMemory`、`deleteAiMemory`。
- 登录态 AI 资料面板会按当前 persona 加载长期记忆。
- 用户可以在聊天页手动写入一条长期记忆，并删除已有记忆。
- 切换、删除或新建 AI persona 后，记忆列表会跟随当前 persona 刷新或清空。
- 聊天页会读取 Agent catalog 中启用的 MCP server，并在 AI 资料面板提供 server 级选择。
- MCP 选择会写入本地 `localStorage`，发送普通 AI 聊天时通过 `mcp_server_ids` 传给 Python 后端。
- 前端 MCP 选择最多保留 3 个 server，和后端普通聊天 MCP 上限保持一致。
- 当前 AI persona 的默认模型 profile 会优先生效；如果默认模型不可用，再回退到中枢 active profile。

### 兼容性

- 未登录状态仍使用本地 AI 联系人，不调用后端 memory 接口。
- MCP key 和 live 开关仍只由 Python 后端环境变量控制，前端只传 server id。
- 如果 Agent catalog 加载失败，普通 AI 聊天仍可继续，只是不显示可选 MCP server。
- 后端仍保留未登录/本地 profile fallback，线上登录态继续走用户隔离和密钥加密路径。
- 灵感画布里的 AI 工作流助手也会在登录态传 `profile_id` 和 auth token，避免只有 `api_key_set`、没有明文 key 的 profile 在上线后失效。

### 已完成的验证

- `npm run build`（frontend）
- `python_backend/.venv/bin/python -m pytest python_backend/tests -q`
- `python_backend/.venv/bin/python -m compileall python_backend/app`
- 本地服务 HTTP 检查：
  - `http://127.0.0.1:7777` 返回 200。
  - `http://127.0.0.1:7778/health` 返回 `{"status":"ok"}`。

### 当前剩余边界

- 长期记忆列表仍是轻量召回结果展示，没有关键词搜索、引用溯源、embedding、rerank 或批量管理。
- 普通聊天 MCP 已有当前运行的轻量前端事件时间线和最近 run 事件回放，但还没有完整历史浏览页。
- MCP 选择是 server 级，不是 tool 级，也还没有模型自主工具调用循环。
- Gemini / Anthropic 图片 data URL 请求格式已接入，真实外部密钥下的端到端验证仍需要后续补齐。

## 本次后续落地记录（2026-06-06，普通聊天事件时间线）

本次继续推进普通聊天事件增强，把后端已经发出的轻量 SSE 事件接入聊天页展示。

### 已完成

- ChatPanel 现在会订阅 `streamChat` 的 `onEvent` 回调，不再只消费 `message:chunk` 文本。
- `run:start` 会显示当前运行开始、provider、model 和短 run id。
- `tool:start` / `tool:result` 会在消息列表底部展示 MCP server、tool name、参数摘要、planned/success/failed 状态和错误摘要。
- `model:fallback`、`token:usage`、`message:done`、`run:error` 会更新同一组运行事件状态。
- 工具结果摘要会截断，避免大 JSON 撑开聊天布局。
- 每次发送新 AI 消息时会清空上一轮运行事件，只展示当前运行过程。
- 新增前端 chat run API 封装：`fetchChatRuns` 和 `fetchChatRunEvents`。
- AI 资料面板会展示最近 8 条聊天运行记录，包含 model、状态、事件数和 MCP 数量。
- 点击历史 run 会读取 `/api/chat/runs/{run_id}/events`，把持久化 SSE 事件回放到当前聊天事件时间线。

### 兼容性

- 前端只是展示后端已有事件，不改变 Python 后端 MCP allowlist、planned/live 开关或密钥策略。
- 如果没有启用 MCP，普通聊天仍只显示 run/token/done 等轻量事件。
- 未登录本地模式仍可使用旧 profile fallback；登录态继续走 `profile_id` 和后端密钥解析。
- 历史 run 读取使用同一个 auth token，后端仍按 user_id 过滤，不能跨用户读取事件。

### 已完成的验证

- `npm run build`（frontend）
- `python_backend/.venv/bin/python -m pytest python_backend/tests -q`
- `python_backend/.venv/bin/python -m compileall python_backend/app`
- 本地服务 HTTP 检查：
  - `http://127.0.0.1:7777` 返回 200。
  - `http://127.0.0.1:7778/health` 返回 `{"status":"ok"}`。

### 当前剩余边界

- 事件回放还是资料面板里的轻量最近列表，不是完整历史浏览页，也不会恢复聊天正文快照。
- 该节点 MCP 仍是预执行上下文；后续已为 OpenAI-compatible live MCP 补齐最小自主 tool-call loop。
- 该节点暂未展示“思考事件”，后续已补齐非敏感 `thought:summary` 阶段摘要事件。

## 本次后续落地记录（2026-06-06，普通聊天 thought 阶段事件）

本次继续推进第四项“普通聊天事件继续增强”，补齐轻量 thought/reasoning 类事件。

### 已完成

- 后端新增 `thought:summary` SSE 事件。
- `thought:summary` 会在 `run:start` 后、工具执行和模型输出前发出，并写入 `chat_runs.events_json`。
- 事件内容是非敏感阶段摘要，只包含上下文准备状态、persona/profile id、memory strategy、MCP server 数量、附件数量、图片数量、文本摘录数量和 vision 支持状态。
- 非流式 `/api/chat` 也会持久化同样的 `thought:summary` 事件。
- 前端 ChatPanel 时间线支持展示 `thought:summary`，使用 Brain 图标，并可从历史 run replay 里恢复展示。

### 已完成的验证

- 更新测试覆盖流式聊天 SSE 包含 `thought:summary`。
- 更新测试覆盖持久化 run events replay 包含 `thought:summary`。
- `python_backend/.venv/bin/python -m pytest python_backend/tests/test_providers.py -q`
- `python_backend/.venv/bin/python -m pytest python_backend/tests -q`
- `python_backend/.venv/bin/python -m compileall python_backend/app`
- `npm run build`（frontend）

### 当前剩余边界

- `thought:summary` 不是模型内部 chain-of-thought，也不会暴露系统提示词、密钥、工具配置细节或完整内部推理。
- 还没有 provider 原生 reasoning token / reasoning summary 解析。
- Anthropic / Gemini 仍是预执行上下文，不是模型自主 tool-call loop；后续已补齐 Anthropic 原生工具协议和 Gemini 原生 function calling 路径。

## 本次后续落地记录（2026-06-06，OpenAI-compatible MCP 自主 tool-call loop）

本次继续推进第五项“聊天接入 MCP 工具”，把普通聊天从纯后端预执行工具上下文推进到最小可用的模型自主工具调用循环。

### 已完成

- OpenAI-compatible 普通聊天在同时满足以下条件时启用自主 tool-call loop：
  - 聊天请求选择了 MCP server。
  - 对应 MCP server 在后端 catalog allowlist 内且未被管理端禁用。
  - 后端环境配置了 server 所需密钥。
  - `BIGMODEL_MCP_LIVE=1`。
- 后端会把已选择 MCP server 的 allowlisted tools 转成 OpenAI `tools` schema。
- 模型调用使用 `tool_choice=auto`，由模型决定是否调用工具。
- 如果模型根据工具结果继续返回新的 `tool_calls`，后端会在同一 OpenAI 原生 transcript 中最多继续 3 轮。
- 每轮最多执行 3 个 tool calls；写回模型的 `assistant.tool_calls` 只包含本轮实际执行的调用，避免出现没有对应 `tool` message 的无效 transcript。
- 模型返回 `tool_calls` 后，后端只按 allowlist 映射执行工具，不接受前端传工具名或密钥。
- 工具调用继续通过 `tool:start` / `tool:result` SSE 事件展示，并写入 `chat_runs.events_json`。
- 自主工具事件会带 `round` 字段，便于当前时间线和历史 replay 区分多轮工具调用。
- 工具结果会作为 OpenAI 原生 `tool` messages 进入最终回复生成；最终请求包含 `assistant.tool_calls` 和对应 `tool_call_id`。
- 未满足 live 条件时，普通聊天保持原有 planned/pre-exec 兼容路径。
- Anthropic / Gemini 暂时保持原有预执行上下文，后续再按各自工具协议扩展；后续已补齐 Anthropic 原生 `tool_use` / `tool_result` 路径。

### 已完成的验证

- 新增测试覆盖 OpenAI-compatible live MCP 下模型返回 `tool_calls` 后，后端执行 allowlisted MCP tool。
- 新增测试覆盖一轮工具调用后，后续模型请求使用原生 `assistant.tool_calls` + `tool` messages，而不是 system prompt 注入。
- 新增测试覆盖两轮 OpenAI-compatible 自主工具调用、最终流式回复 transcript 和 `round` 事件字段。
- 新增测试覆盖 SSE 包含 `thought:summary`、`tool:start`、`tool:result`，且工具事件标记 `autonomous=true`。
- 保留原有 planned/pre-exec MCP 测试，确保线下未配置 live 时兼容旧路径。
- `python_backend/.venv/bin/python -m pytest python_backend/tests/test_providers.py -q`
- `python_backend/.venv/bin/python -m pytest python_backend/tests -q`
- `python_backend/.venv/bin/python -m compileall python_backend/app`
- `npm run build`（frontend）

### 当前剩余边界

- 当前该节点自主 tool-call loop 只覆盖 OpenAI-compatible provider；后续已补齐 Anthropic 原生工具协议。
- 当前最多 3 轮、每轮最多 3 个 tool calls，还不是无限多轮 Agent loop。
- Gemini 的原生工具调用协议在该节点尚未接入；后续已补齐。
- 工具 schema 仍来自本地 catalog allowlist，没有动态 tools/list schema 缓存；后续已补齐 allowlist 过滤后的 `tools/list` schema 缓存。
- MCP key 和 live 开关仍只由后端环境变量控制。

## 本次后续落地记录（2026-06-06，Anthropic MCP 原生工具协议）

本次继续推进第五项“聊天接入 MCP 工具”，把 Anthropic 普通聊天从 planned/pre-exec MCP 上下文推进到原生工具调用 transcript。

### 已完成

- `should_use_mcp_tool_loop()` 现在允许 OpenAI-compatible 和 Anthropic 在满足 live MCP 条件时进入自主工具循环。
- Anthropic 会把选择的 MCP tools 转成 Messages API `tools` schema，使用 `name`、`description` 和 `input_schema`。
- 模型返回 `tool_use` content block 后，后端只按 catalog allowlist 映射执行工具，不接受前端传工具名或密钥。
- 工具执行结果会作为 user 消息中的 `tool_result` content block 写回 Anthropic transcript。
- Anthropic 工具循环同样最多 3 轮、每轮最多 3 个工具调用。
- 工具调用继续发出 `tool:start` / `tool:result` 事件，事件包含 `autonomous=true` 和 `round`。
- 未满足 live 条件时，Anthropic 普通聊天仍保持 planned/pre-exec 兼容路径。

### 已完成的验证

- 新增测试覆盖 Anthropic live MCP 下模型返回 `tool_use` 后，后端执行 allowlisted MCP tool。
- 新增测试覆盖下一轮 Anthropic 请求包含原生 `assistant.tool_use` 和 `user.tool_result`，不是 system prompt 注入。
- 新增测试覆盖 SSE 包含 `tool:start` / `tool:result`、`autonomous=true`、`round=1` 和最终文本输出。
- `python_backend/.venv/bin/python -m pytest python_backend/tests/test_providers.py -q`

### 当前剩余边界

- 该节点 Gemini 原生 function calling / function response 协议还没有接入；后续已补齐。
- Anthropic 工具选择轮次当前使用非流式 JSON 响应；最终文本会统一转为当前 SSE 事件协议。
- 工具 schema 仍来自本地 catalog allowlist，没有动态 tools/list schema 缓存；后续已补齐 allowlist 过滤后的 `tools/list` schema 缓存。
- 真实外部 Anthropic key + 真实 BigModel MCP live 的端到端验证仍需后续补齐。

## 本次后续落地记录（2026-06-06，Gemini MCP 原生 function calling）

本次继续收口第五项“聊天接入 MCP 工具”，把 Gemini 普通聊天从 live 条件下错误落入 OpenAI-compatible 工具循环，修正为 Gemini GenerateContent 原生 function calling transcript。

### 已完成

- `complete_chat_with_mcp_tool_loop()` 现在会按 provider 分发到 OpenAI-compatible、Anthropic 或 Gemini 各自的原生工具循环。
- `_stream_chat_events()` 在 live MCP 条件满足时，也会把 Gemini 分发到专用 `_stream_gemini_mcp_tool_loop()`，不再走 OpenAI-compatible loop。
- Gemini MCP tools 会转成 GenerateContent `tools[].functionDeclarations`，并显式使用 `toolConfig.functionCallingConfig.mode=AUTO`；工具名仍来自后端 catalog allowlist。
- 模型返回 `functionCall` part 后，后端只按 allowlist 映射执行 MCP tool，不接受前端传工具名、schema 或 MCP key。
- 工具结果会作为下一条 `role=user` 的 `functionResponse` part 写回 Gemini transcript，`id` 与模型返回的 `functionCall.id` 保持一致。
- Gemini 返回的 `functionCall` part 会原样保留，例如 `thoughtSignature`，避免破坏后续 Gemini 多轮调用要求。
- Gemini 工具循环同样最多 3 轮、每轮最多 3 个工具调用，并继续发出 `tool:start` / `tool:result` 事件，事件包含 `autonomous=true` 和 `round`。
- 未满足 live 条件时，Gemini 普通聊天仍保持 planned/pre-exec 兼容路径。

### 已完成的验证

- 新增测试覆盖 Gemini live MCP 下模型返回 `functionCall` 后，后端执行 allowlisted MCP tool。
- 新增测试覆盖下一轮 Gemini 请求包含原生 `model.functionCall` 和 `user.functionResponse`，并保留 `thoughtSignature`。
- 新增测试覆盖 SSE 包含 `tool:start` / `tool:result`、`autonomous=true`、`round=1` 和最终文本输出。
- 新增测试覆盖非流式 `/api/chat` 入口也会使用 Gemini 原生 function calling loop。
- `python_backend/.venv/bin/python -m pytest python_backend/tests/test_providers.py -q`
- `python_backend/.venv/bin/python -m pytest python_backend/tests -q`
- `python_backend/.venv/bin/python -m compileall python_backend/app`
- `npm run build`（frontend）

### 当前剩余边界

- Gemini 工具选择轮次当前使用非流式 JSON 响应；如果达到最大工具轮次，最终文本会再走 Gemini 原生 streaming。
- 工具 schema 仍来自本地 catalog allowlist，没有动态 tools/list schema 缓存；后续已补齐 allowlist 过滤后的 `tools/list` schema 缓存。
- 真实外部 Gemini key + 真实 BigModel MCP live 的端到端验证仍需后续补齐。

## 本次后续落地记录（2026-06-06，MCP tools/list schema 缓存）

本次继续收口第五项“聊天接入 MCP 工具”，把普通聊天 live MCP 工具定义从空参数对象推进到后端缓存的真实 `tools/list` schema。

### 已完成

- 新增 `mcp_tool_schema_cache` 表，按 `server_id + tool_name` 保存 MCP `tools/list` 返回的工具描述、输入 schema 和原始工具片段。
- `/api/agents/mcp/{server_id}/tools` 在真实 live `tools/list` 成功后会刷新该 server 的 schema 缓存。
- 缓存写入时只保留后端 catalog allowlist 里的工具；远端返回的额外工具不会进入缓存，也不会暴露给普通聊天。
- 普通聊天 live MCP tool loop 会优先使用缓存 schema 生成 provider 工具定义：
  - OpenAI-compatible：`tools[].function.parameters`
  - Anthropic：`tools[].input_schema`
  - Gemini：`tools[].functionDeclarations[].parameters`
- 如果没有缓存、MCP 未配置或 live 关闭，普通聊天仍回退到本地 allowlist 的通用空 schema，不影响线下开发和 planned/pre-exec 兼容路径。
- `/api/agents/mcp/{server_id}/tools` 返回体新增 `tool_schemas`，方便排查当前使用的是 cached schema 还是 fallback schema。
- 如果真实 `tools/list` 成功但缓存写入失败，接口仍返回工具列表，同时通过 `cache_error` 暴露缓存错误，避免缓存问题阻断线上工具发现。

### 已完成的验证

- 新增测试覆盖 MCP `tools/list` 成功后写入 `mcp_tool_schema_cache`。
- 新增测试覆盖 OpenAI-compatible、Anthropic 和 Gemini 的聊天工具定义会读取缓存 schema。
- 新增测试覆盖远端 `tools/list` 返回非 allowlist 工具时不会进入聊天工具定义。
- 新增测试覆盖无缓存时仍使用本地 allowlist fallback schema。
- 新增测试覆盖部分缓存会和本地 fallback 合并，不会让多工具 server 丢掉未缓存工具。
- 新增测试覆盖缓存写入失败不会隐藏 live `tools/list` 结果。
- `python_backend/.venv/bin/python -m pytest python_backend/tests/test_providers.py -q`
- `python_backend/.venv/bin/python -m pytest python_backend/tests -q`
- `python_backend/.venv/bin/python -m compileall python_backend/app`
- `npm run build`（frontend）

### 当前剩余边界

- schema 缓存目前通过访问 `/api/agents/mcp/{server_id}/tools` 刷新，还没有后台定时刷新任务。
- schema 缓存是 server 级全局缓存，不是用户级；权限仍由后端 catalog allowlist、admin 启停和 MCP live 配置控制。
- 真实外部 BigModel MCP live 下的 schema 刷新和工具调用端到端验证仍需后续补齐。

## 本次后续落地记录（2026-06-06，Anthropic / Gemini 图片输入）

本次继续补齐附件和图片理解路径，让后端 provider request builder 不再只对 OpenAI-compatible 模型生成图片输入。

### 已完成

- OpenAI-compatible vision 路径继续使用 `image_url` content part，保持旧行为。
- Anthropic vision 路径会把图片 data URL 转成 Messages API 的 `image` content block，使用 base64 source、media type 和纯 base64 data。
- Anthropic 也支持把 HTTP/HTTPS 图片 URL 转成 `source.type=url` 的 image block。
- Gemini vision 路径会把图片 data URL 转成 GenerateContent 的 `inline_data` part，包含 `mime_type` 和 base64 data。
- Gemini 遇到 HTTP/HTTPS 图片 URL 时不会假装已读取图片，而是保留附件元数据文本作为 fallback。
- 非 vision 模型、非图片附件、无效 data URL 继续降级为附件元数据文本。

### 已完成的验证

- 新增测试覆盖 OpenAI `image_url`、Anthropic `image/source`、Gemini `inline_data` 三类请求体。
- `python_backend/.venv/bin/python -m pytest python_backend/tests/test_providers.py -q`
- `python_backend/.venv/bin/python -m pytest python_backend/tests -q`
- `python_backend/.venv/bin/python -m compileall python_backend/app`
- `npm run build`（frontend）
- 本地服务 HTTP 检查：
  - `http://127.0.0.1:7777` 返回 200。
  - `http://127.0.0.1:7778/health` 返回 `{"status":"ok"}`。

### 当前剩余边界

- 还没有真实 Anthropic / Gemini 外部密钥下的端到端视觉理解验证。
- 文档类附件仍只做元数据提示，没有文本抽取、分块、RAG 或引用。
- 本地文件仍通过前端 data URL 直接随请求传递，尚未做对象存储、临时 URL、大小限制和访问权限体系。

## 本次后续落地记录（2026-06-06，登录态附件上传与权限 hydrate）

本次继续推进第六项“附件和图片理解”，把普通 AI 聊天的登录态附件路径从前端直接传 data URL，推进到后端上传、数据库记录和用户隔离读取。

### 已完成

- 新增 `chat_attachments` 表，记录附件 id、用户 id、文件名、content type、大小、类型、存储路径、sha256 和创建时间。
- 新增 `POST /api/chat/attachments`，接口必须登录后使用。
- 后端只接受白名单类型：JPEG、PNG、WebP、GIF、PDF、纯文本、Markdown 和 JSON。
- 后端限制单个附件最大 10 MB。
- 图片上传会校验基础文件签名，避免只靠前端传来的 MIME type 判断。
- 该节点登录态上传后的文件先存储在 `MEDIA_ROOT/CHAT_ATTACHMENT_UPLOAD_DIRNAME/{user_id}` 下；后续已调整为私有目录，见下一节。
- 普通 AI 聊天请求如果携带已上传附件 id，后端会按当前用户查询附件记录；只有 owner 可以 hydrate 图片本体。
- owner 的图片附件会在 vision 模型下转成 provider 所需的图片输入；非 owner 或查不到的附件只保留元数据 fallback，不读取文件本体。
- 前端登录态 AI 附件会先上传到后端，聊天请求只发送附件 id 和元数据，不再发送 `data_url`。
- 未登录本地开发仍保留 data URL 兼容路径，避免线下无 auth 时无法测试图片理解。
- 登录态上传失败不会静默回退到 data URL；附件添加会失败并显示错误，避免绕过后端大小、类型和权限限制。

### 已完成的验证

- 新增测试覆盖 owner 可 hydrate 上传图片、其他用户只能看到元数据 fallback。
- 新增测试覆盖 `/api/chat/attachments` 必须登录。
- `python_backend/.venv/bin/python -m pytest python_backend/tests/test_providers.py -q`
- `python_backend/.venv/bin/python -m pytest python_backend/tests -q`
- `python_backend/.venv/bin/python -m compileall python_backend/app`
- `npm run build`（frontend）

### 当前剩余边界

- 该节点仍只是后端本地 media 存储，不是对象存储。
- 该节点 `/api/media` 仍是静态公开挂载，后续已改为新上传文件写入私有目录。
- 该节点没有临时签名 URL、过期策略、清理任务或附件删除接口；后续已补齐临时 URL 和 owner 删除接口。
- 文档类附件仍只作为元数据进入聊天上下文，没有文本抽取、切块、embedding、RAG 或引用。
- Anthropic / Gemini / OpenAI-compatible 的真实外部密钥端到端视觉理解仍需后续验证。

## 本次后续落地记录（2026-06-06，私有附件存储与鉴权下载）

本次继续收紧附件上线安全边界，把新上传的聊天附件从公开 `MEDIA_ROOT` 移到私有目录，并补充 owner-scoped 下载接口。

### 已完成

- 新增 `PRIVATE_MEDIA_ROOT` 配置，默认使用项目根目录下的 `private-media`。
- 应用启动时会创建 `PRIVATE_MEDIA_ROOT`，但不会把它挂载到 `/api/media`。
- 新上传的聊天附件现在写入 `PRIVATE_MEDIA_ROOT/CHAT_ATTACHMENT_UPLOAD_DIRNAME/{user_id}`。
- `chat_attachments.path` 继续保存相对路径，避免把绝对机器路径写入数据库。
- `load_uploaded_chat_attachment()` 读取时优先查私有目录，同时兼容旧的 `MEDIA_ROOT` 历史路径。
- 新增 `GET /api/chat/attachments/{attachment_id}`，必须登录且只能下载当前用户自己的附件。
- 非 owner 下载返回 404，避免暴露附件是否存在。

### 已完成的验证

- 新增测试覆盖新上传附件落在私有目录、不再落入公开 `MEDIA_ROOT`。
- 新增测试覆盖 owner 可下载、其他用户 404、未登录 401。
- `python_backend/.venv/bin/python -m pytest python_backend/tests/test_providers.py -q`
- `python_backend/.venv/bin/python -m pytest python_backend/tests -q`
- `python_backend/.venv/bin/python -m compileall python_backend/app`
- `npm run build`（frontend）

### 当前剩余边界

- 该节点还没有临时签名 URL；后续已补齐短期签名下载能力。
- 还没有对象存储；owner 删除、历史公开附件迁移和孤儿文件清理后续已补齐。
- 旧数据库中如果已经有 `MEDIA_ROOT/chat-attachments` 下的聊天附件，后端仍会兼容读取；上线前可通过后续补齐的管理端迁移接口移动到 `PRIVATE_MEDIA_ROOT`。
- 该节点文档附件仍未做文本抽取、分块、embedding、RAG 或引用；后续已补齐文本类附件摘录。

## 本次后续落地记录（2026-06-06，文本类附件摘录注入）

本次继续推进第六项中的“文档附件文本抽取”，先实现低风险的轻量版本。

### 已完成

- `chat_attachments` 新增 `text_excerpt` 和 `text_truncated` 字段。
- 上传 `text/plain`、`text/markdown`、`application/json` 时，后端会解码并规范化文本，最多保存 12000 字符摘录。
- JSON 附件会尝试格式化后再保存摘录；解析失败时按普通文本处理。
- 上传 `application/pdf` 时，后端会通过 `pypdf` 尝试抽取前 12 页文本，并沿用同一个 12000 字符摘录上限。
- PDF 解析库缺失、PDF 损坏、加密无法解密或页面无法抽取文本时，上传不会失败，只会降级为附件元数据。
- 聊天请求 hydrate 附件时，只有 owner 可以读取并注入文本摘录。
- 模型请求 builder 会把文本类附件摘录拼入附件上下文；非 owner、未 hydrate 或无摘录的附件仍只提供元数据。
- vision 请求里如果同时有图片和文本附件，图片继续走多模态输入，文本附件摘录会追加到文本 prompt 里。

### 已完成的验证

- 新增测试覆盖 Markdown 附件上传后 owner 的 OpenAI-compatible 请求包含文本摘录。
- 新增测试覆盖其他用户拿同一个附件 id 只能看到文件名元数据，不能看到文本摘录。
- 新增测试覆盖 PDF 附件上传后 owner 的 OpenAI-compatible 请求包含 PDF 文本摘录。
- 新增测试覆盖不可解析 PDF 上传仍成功，并降级为 `text_extracted=false`。
- `python_backend/.venv/bin/python -m pytest python_backend/tests/test_providers.py -q`
- `python_backend/.venv/bin/python -m pytest python_backend/tests -q`
- `python_backend/.venv/bin/python -m compileall python_backend/app`
- `npm run build`（frontend）

### 当前剩余边界

- 当前 PDF 只是 bounded excerpt，不是版面结构理解、表格抽取、embedding、rerank、引用或完整 RAG；后续已补齐轻量 chunk 检索底座。
- PDF 只尝试前 12 页，扫描件或图片型 PDF 不会自动 OCR。
- 没有独立文档检索 API，也没有在长期记忆中持久化文档知识；后续已在聊天 hydrate 路径补齐 owner-scoped chunk 检索。
- 超长文本只保留前 12000 字符，模型上下文注入时单附件最多使用 4000 字符。

## 本次后续落地记录（2026-06-06，附件临时签名 URL）

本次继续补齐第六项中的“临时 URL”，在私有本地附件存储之上增加短期签名下载能力。

### 已完成

- 新增 `CHAT_ATTACHMENT_URL_SECRET` 配置，用于签名聊天附件临时 URL。
- 新增 `CHAT_ATTACHMENT_URL_TTL_SECONDS` 配置，默认 600 秒，后端会把实际 TTL 限制在 60 到 3600 秒之间。
- 新增 `POST /api/chat/attachments/{attachment_id}/temporary-url`，必须登录且只能为当前用户自己的附件生成临时 URL。
- 新增 `GET /api/chat/attachments/{attachment_id}/temporary?token=...`，不需要 Bearer token，但必须通过 HMAC 签名、附件 id 和过期时间校验。
- 临时 URL token 绑定 user id、attachment id 和过期时间；篡改 token、换 attachment id 或过期都会拒绝。
- 签名材料优先使用 `CHAT_ATTACHMENT_URL_SECRET`；未配置时开发环境会从现有本地配置派生，生产部署必须显式设置稳定 secret。

### 已完成的验证

- 新增测试覆盖 owner 可生成临时 URL 并免 auth 下载。
- 新增测试覆盖其他用户不能为 owner 附件生成临时 URL。
- 新增测试覆盖未登录不能生成临时 URL。
- 新增测试覆盖 token 篡改、attachment id 替换和过期 token 都会返回 401。
- `python_backend/.venv/bin/python -m pytest python_backend/tests/test_providers.py -q`
- `python_backend/.venv/bin/python -m pytest python_backend/tests -q`
- `python_backend/.venv/bin/python -m compileall python_backend/app`
- `npm run build`（frontend）

### 当前剩余边界

- 临时 URL 仍基于本地私有文件系统，不是对象存储签名 URL。
- 没有一次性 token 消费记录，过期前同一个临时 URL 可以重复访问。
- 该节点还没有附件删除接口、过期清理任务和历史公开附件迁移脚本；后续已补齐 owner 删除接口、历史公开附件迁移和孤儿文件清理。
- 文档附件仍未做文本抽取、分块、embedding、RAG 或引用；后续已补齐文本抽取和轻量 chunk 检索。

## 本次后续落地记录（2026-06-06，附件 owner 删除接口）

本次继续补齐附件生命周期管理，增加用户主动删除聊天附件的后端接口。

### 已完成

- 新增 `DELETE /api/chat/attachments/{attachment_id}`。
- 删除接口必须登录，并且只能删除当前用户自己的附件。
- 非 owner 删除返回 404，避免暴露附件是否存在。
- 删除成功后会删除 `chat_attachments` 记录，并尝试移除私有存储里的文件。
- 如果文件已经丢失但 DB 记录存在，删除接口仍可清理 DB 记录。
- 附件删除后，owner 鉴权下载返回 404，旧临时 URL 也会因为 DB 记录不存在而返回 404。

### 已完成的验证

- 新增测试覆盖 owner 可删除附件。
- 新增测试覆盖其他用户删除 404、未登录删除 401。
- 新增测试覆盖删除后文件从私有目录移除。
- 新增测试覆盖删除后 owner 下载和旧临时 URL 都返回 404。
- `python_backend/.venv/bin/python -m pytest python_backend/tests/test_providers.py -q`
- `python_backend/.venv/bin/python -m pytest python_backend/tests -q`
- `python_backend/.venv/bin/python -m compileall python_backend/app`
- `npm run build`（frontend）

### 当前剩余边界

- 还没有自动定时过期清理任务；后续已补齐管理端手动孤儿清理。
- 还没有历史公开附件迁移或清理脚本；后续已补齐管理端迁移和清理接口。
- 还没有对象存储。
- 文档附件仍未做切块、embedding、rerank、引用或完整 RAG；后续已补齐轻量 chunk 检索底座。

## 本次后续落地记录（2026-06-06，附件迁移与孤儿清理）

本次继续补齐附件上线安全边界，针对历史公开聊天附件和本地文件生命周期增加管理端维护能力。

### 已完成

- 新增管理端 `POST /api/admin/chat-attachments/migrate-private`。
- 迁移接口只允许 admin 调用，默认 `dry_run=true`。
- 迁移会扫描 `chat_attachments`，把仍位于 `MEDIA_ROOT/CHAT_ATTACHMENT_UPLOAD_DIRNAME/...` 的已登记旧附件移动到 `PRIVATE_MEDIA_ROOT` 对应相对路径。
- 迁移前会校验相对路径必须位于聊天附件目录内，并按 DB 记录中的 size / sha256 校验文件，避免移动不匹配或不安全路径。
- 如果私有目录中已有同一附件且 public 文件也匹配，会在正式执行时删除 public 副本。
- 新增管理端 `POST /api/admin/chat-attachments/cleanup-orphans`。
- 孤儿清理接口只允许 admin 调用，默认 `dry_run=true`，默认只考虑超过 3600 秒的文件。
- 清理会扫描私有和旧公开聊天附件目录，只删除没有 DB 记录引用的文件；已登记附件会保留。
- 两个维护接口都会写入 `admin_audit_logs`，记录 dry-run 状态和处理统计。

### 已完成的验证

- 新增测试覆盖旧公开附件 dry-run 不移动、正式迁移到私有目录、owner 下载仍可用。
- 新增测试覆盖孤儿清理 dry-run 不删除、正式执行只删除无 DB 引用文件并保留已登记文件。
- `python_backend/.venv/bin/python -m pytest python_backend/tests/test_providers.py -q`

### 上线使用建议

- 上线前先调用 `migrate-private` 的 dry-run，确认 `migrated`、`conflicts` 和 `unsafe` 数量。
- `conflicts` 或 `unsafe` 不为 0 时先人工排查，不要直接删除旧公开目录。
- 正式迁移后再跑一次 dry-run，确认旧公开附件已经变成 `already_private` 或 `missing`。
- 孤儿清理先用 dry-run 和较大的 `min_age_seconds`，确认只会删除预期文件后再执行。

### 当前剩余边界

- 这仍是本地文件系统维护能力，不是对象存储迁移。
- 还没有后台定时任务；清理需要管理员手动触发。
- 不会清理有 DB 记录但实际文件丢失的记录，这类记录仍由 owner 删除接口或后续专门修复脚本处理。

## 本次后续落地记录（2026-06-06，文档 chunk 检索底座）

本次继续推进第六项“文档附件可以再往后做文本抽取和 RAG”，先补一个不上向量库的轻量检索底座。

### 已完成

- 新增 `chat_document_chunks` 表，用于保存文本类聊天附件的切块内容。
- 上传 `text/plain`、`text/markdown`、`application/json`、可解析 `application/pdf` 后，如果成功抽取文本，会同步写入文档 chunks。
- chunk 默认按约 1200 字符切分，并保留少量重叠，避免长文只把开头 4000 字符塞进模型上下文。
- 聊天 hydrate 附件时，后端会按当前用户、当前附件 id 和用户本轮问题做轻量检索；后续已升级为优先 FTS5/BM25，失败时回退到关键词打分。
- prompt 注入时优先使用命中的相关 chunks；如果没有 chunks 或没有命中，则保留原有 `text_excerpt` 降级路径。
- 命中的 chunk 会生成稳定引用标识，例如 `attachment-id#chunk2`，并出现在 prompt 里的对应摘录前。
- 普通聊天会在模型输出前发出 `source:references` 事件，记录引用数量、附件名、chunk index 和命中位置附近的短 preview。
- 前端 ChatPanel 时间线支持展示 `source:references`，历史 run replay 也能恢复来源引用事件。
- 旧数据库里已经存在 `text_excerpt`、但还没有 chunks 的附件，会在 owner 第一次 hydrate 时懒 backfill chunks。
- 删除附件时会同步删除 `chat_document_chunks` 中该附件的记录。
- 非 owner 仍只能看到附件元数据，不会读取 `text_excerpt` 或 chunks。

### 已完成的验证

- 新增测试覆盖长文本附件中 4000 字符之后的唯一关键词，可以通过本轮问题命中相关 chunk 并注入模型请求。
- 新增测试覆盖非 owner 不能看到同一附件的文档 chunk 内容。
- 新增测试覆盖旧 `text_excerpt` 附件第一次 hydrate 时自动 backfill chunks。
- 新增测试覆盖流式聊天会发出 `source:references`，并可通过历史 run replay 恢复。
- `python_backend/.venv/bin/python -m pytest python_backend/tests/test_providers.py -q`

### 当前剩余边界

- 当前检索后续已升级为可选 SQLite FTS5/BM25；但仍不是 embedding、向量检索或 rerank。
- 独立文档检索 API、引用详情面板和轻量结构化引用清单解析后续已补齐；硬性 JSON/schema 输出约束和语义核查仍未实现。
- 文档知识只绑定附件和当前用户，不会自动写入长期记忆。
- 只处理已抽取出来的文本；扫描件 PDF 仍需要后续 OCR。

## 本次后续落地记录（2026-06-06，引用详情与文档检索 API）

本次继续推进第六项“文档附件可以再往后做文本抽取和 RAG”，在轻量 chunk 检索底座之上补齐 owner-scoped 引用详情和前端查看入口。

### 已完成

- 新增 `GET /api/chat/attachments/{attachment_id}/chunks`，按当前登录用户、附件 id、查询词和 limit 返回相关文档 chunks。
- 新增 `GET /api/chat/document-chunks/{ref}`，按稳定引用标识读取单个 chunk 详情，例如 `attachment-id#chunk2`。
- 两个接口都必须登录，并且只读取当前用户自己的附件和 chunks；非 owner 返回 404，未登录返回 401。
- 返回的引用详情包含附件摘要、chunk index、ref 和完整 chunk 内容。
- 前端 ChatPanel 的 `source:references` 时间线现在保留引用列表，并为每个 ref 渲染可点击的引用按钮。
- 点击引用按钮会调用后端详情接口，展示完整 chunk 内容；历史 run replay 恢复 `source:references` 后也能继续查看详情。
- ref 中的 `#` 通过 `encodeURIComponent` 处理，避免浏览器把 chunk 部分当成 URL fragment。

### 已完成的验证

- 新增测试覆盖 owner 可以检索附件 chunks，并按 ref 读取完整 chunk 详情。
- 新增测试覆盖非 owner 读取同一附件 chunks 或 ref 详情返回 404。
- 新增测试覆盖未登录检索 chunks 返回 401。
- `python_backend/.venv/bin/python -m pytest python_backend/tests/test_providers.py -q`
- `python_backend/.venv/bin/python -m pytest python_backend/tests -q`
- `python_backend/.venv/bin/python -m compileall python_backend/app`
- `npm run build`（frontend）

### 当前剩余边界

- 当前检索后续已升级为可选 SQLite FTS5/BM25；但仍不是 embedding、向量检索或 rerank。
- 前端引用详情查看已补齐；后续已增加轻量 `source:citation-check` 事件校验回答是否包含真实 ref，并解析末尾 `引用：[...]` 清单，但还没有强制 JSON/schema cited answer 或语义级事实核查。
- 文档知识只绑定附件和当前用户，不会自动写入长期记忆。
- 只处理已抽取出来的文本；扫描件 PDF 仍需要后续 OCR。

## 本次后续落地记录（2026-06-06，答案引用校验事件）

本次继续收口第六项“文档附件文本抽取和 RAG”，在 `source:references` 和引用详情 UI 之上补一个轻量答案引用审计事件。

### 已完成

- 新增后端 `source:citation-check` run event。
- 当本轮聊天存在文档 chunk 来源时，后端会在模型最终回答后、`message:done` 前检查回答中是否包含本轮真实 ref。
- 校验结果包含 `status`、`source_count`、`cited_count`、`missing_count`、`cited_refs`、`missing_refs` 和 `unknown_refs`。
- `status=cited` 表示回答包含至少一个本轮真实 ref 且没有未知 ref。
- `status=missing` 表示本轮有来源但回答没有引用真实 ref。
- `status=partial` 表示回答引用了真实 ref，但也出现了不属于本轮来源的 ref-like token。
- 流式、非流式和 fallback 成功路径都会持久化该事件；历史 run replay 可恢复展示。
- 文档 chunk prompt 现在明确要求：使用摘录回答时，在相关句子后标注对应 `[ref]`。
- 前端 ChatPanel 时间线支持展示 `source:citation-check`，引用成功显示完成，缺失或未知引用显示失败。

### 已完成的验证

- 新增 helper 单测覆盖未知引用识别。
- 更新流式文档 chunk 用例，覆盖有来源但回答未引用 ref 时发出 `status=missing`，并可通过历史 run replay 恢复。
- 新增非流式文档 chunk 用例，覆盖回答包含真实 `[attachment-id#chunk1]` 时发出 `status=cited`。

### 当前剩余边界

- 这是轻量字符串级引用 presence check，不会证明引用句子的语义一定被来源支持。
- 已支持 prompt 要求末尾 `引用：[...]` 清单并解析该结构化引用行；但还没有强制 JSON/schema cited answer。
- 当前检索后续已升级为可选 SQLite FTS5/BM25；但仍不是 embedding、向量检索或 rerank。
- 文档知识只绑定附件和当前用户，不会自动写入长期记忆。
- 只处理已抽取出来的文本；扫描件 PDF 仍需要后续 OCR。

## 本次后续落地记录（2026-06-06，FTS5 / BM25 文档检索索引）

本次继续推进第六项“文档附件文本抽取和 RAG”，把文档 chunk 检索从纯 Python 关键词计数推进到可选 SQLite 全文索引。

### 已完成

- 新增可选 `chat_document_chunks_fts` FTS5 虚拟表，用于索引 `chat_document_chunks.content`。
- 数据库迁移会尝试创建 FTS5 表；如果当前 SQLite 构建不支持 FTS5，迁移会跳过，不阻断应用启动。
- 迁移会把已有 `chat_document_chunks` backfill 到 FTS 索引，并清理 FTS 中已经没有主表记录的旧行。
- 新上传文本/PDF 附件写入 chunks 时，会同步重建该附件的 FTS 索引。
- 旧 `text_excerpt` 附件懒 backfill chunks 时，也会同步写入 FTS 索引。
- 删除聊天附件时，会同步删除该附件的主表 chunks 和 FTS 索引行。
- `recall_chat_document_chunks()` 在有查询词时优先使用 FTS5 `MATCH` + `bm25()` 排序。
- FTS5 不可用、查询语法失败或没有命中时，会回退到原有 bounded 关键词打分路径，保持线上/线下兼容。
- 返回给前端和 prompt 的引用 ref 格式保持不变，历史 `source:references`、引用详情和 `source:citation-check` 事件协议不变。

### 已完成的验证

- 新增测试覆盖 chunk 写入同步 FTS 索引、FTS 检索返回相关 chunk、重复写入会替换旧索引。
- 新增测试覆盖旧主表 chunks 在重新迁移时 backfill 到 FTS 索引，并可通过检索命中。
- `python_backend/.venv/bin/python -m pytest python_backend/tests/test_providers.py -q`

### 当前剩余边界

- FTS5/BM25 仍是词法全文检索，不是 embedding、向量检索或 rerank。
- FTS5 分词使用 SQLite `unicode61`，对中文长句的无空格分词能力有限；无命中时仍会回退到旧关键词路径。
- 文档知识只绑定附件和当前用户，不会自动写入长期记忆。
- 只处理已抽取出来的文本；扫描件 PDF 仍需要后续 OCR。

## 本次后续落地记录（2026-06-06，结构化引用清单解析）

本次继续收口第六项“文档附件文本抽取和 RAG”，在轻量引用 presence check 之上补充结构化引用清单提示和解析。

### 已完成

- 文档 chunk prompt 现在要求模型在使用摘录时，既在相关句子后标注 `[ref]`，也在回答末尾追加 `引用：[ref1, ref2]`。
- `source:citation-check` 事件现在会解析末尾 `引用：...`、`Sources:`、`Citations:`、`References:` 等结构化引用行。
- citation check payload 新增 `citation_format` 和 `structured_refs`。
- `citation_format=structured` 表示模型输出了可解析的结构化引用清单。
- `citation_format=inline` 表示只在正文里检测到 ref。
- `citation_format=none` 表示本轮有来源，但回答里没有检测到引用。
- 事件仍保留 `cited_refs`、`missing_refs` 和 `unknown_refs`，并继续用真实本轮 refs 做校验，不信任模型自报来源。
- 前端 ChatPanel 的引用校验详情会显示 citation format，历史 run replay 可恢复该信息。

### 已完成的验证

- 新增单测覆盖结构化 `引用：[...]` 清单解析。
- 更新非流式文档 chunk 用例，覆盖模型返回末尾结构化引用清单时，持久化事件包含 `citation_format=structured`。
- `python_backend/.venv/bin/python -m pytest python_backend/tests/test_providers.py -q`
- `npm run build`（frontend）

### 当前剩余边界

- 这仍是非阻断的后置解析和校验，不会强制模型必须返回 JSON 或通过 provider response schema。
- 结构化引用清单只能证明回答文本包含本轮真实 ref，不能证明每个被引用句子的语义一定被来源支持。
- 后续如果要更强保证，需要 provider response schema、引用跨度映射或语义 verifier。
