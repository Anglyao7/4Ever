package agents

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"strings"

	"4ever/backend/internal/config"
	"4ever/backend/internal/models"
	"gorm.io/gorm"
)

type MCPServer struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Transport   string   `json:"transport"`
	Endpoint    string   `json:"endpoint"`
	Auth        string   `json:"auth"`
	Provider    string   `json:"provider"`
	RequiredEnv string   `json:"required_env"`
	Enabled     bool     `json:"enabled"`
	Configured  bool     `json:"configured"`
	LiveEnabled bool     `json:"live_enabled"`
	ToolCount   int      `json:"tool_count"`
	ToolNames   []string `json:"tool_names"`
	Tags        []string `json:"tags"`
}

type AgentBlueprint struct {
	ID                  string   `json:"id"`
	Name                string   `json:"name"`
	Role                string   `json:"role"`
	Description         string   `json:"description"`
	ModelHint           string   `json:"model_hint"`
	PromptVersion       string   `json:"prompt_version"`
	PromptChecksum      string   `json:"prompt_checksum"`
	SystemPrompt        string   `json:"system_prompt"`
	MCPServerIDs        []string `json:"mcp_server_ids"`
	WorkflowTemplateIDs []string `json:"workflow_template_ids"`
}

type WorkflowTemplatePolicy struct {
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	ExecutionMode  string   `json:"execution_mode"`
	RequiresReview bool     `json:"requires_review"`
	SideEffects    []string `json:"side_effects"`
	RetryLimit     int      `json:"retry_limit"`
	TimeoutSeconds int      `json:"timeout_seconds"`
	AuditLevel     string   `json:"audit_level"`
}

type Catalog struct {
	Agents            []AgentBlueprint         `json:"agents"`
	MCPServers        []MCPServer              `json:"mcp_servers"`
	WorkflowTemplates []WorkflowTemplatePolicy `json:"workflow_templates"`
	SecurityNote      string                   `json:"security_note"`
	GraphRuntime      map[string]any           `json:"graph_runtime"`
}

const researchPrompt = "你是 4Ever 调研 Agent。你只做可追溯调研、证据压缩和结构化摘要，不执行外部副作用。"
const workflowPrompt = "你是 4Ever 秩序 Agent。你把灵感、札记和上下文整理成草稿或下一步建议，涉及发送和发布必须等待人工复核。"

var MCPServers = []MCPServer{
	{ID: "bigmodel-web-search", Name: "BigModel Web Search Prime", Description: "联网搜索和实时信息获取，适合调研、校验和补充最新事实。", Transport: "streamable-http", Endpoint: "https://open.bigmodel.cn/api/mcp/web_search_prime/mcp", Auth: "bearer", Provider: "bigmodel", RequiredEnv: "BIGMODEL_API_KEY", Enabled: true, ToolCount: 1, ToolNames: []string{"webSearchPrime"}, Tags: []string{"search", "research", "realtime"}},
	{ID: "bigmodel-web-reader", Name: "BigModel Web Reader", Description: "读取网页正文和结构化内容，适合把外部页面转成工作流上下文。", Transport: "streamable-http", Endpoint: "https://open.bigmodel.cn/api/mcp/web_reader/mcp", Auth: "bearer", Provider: "bigmodel", RequiredEnv: "BIGMODEL_API_KEY", Enabled: true, ToolCount: 1, ToolNames: []string{"webReader"}, Tags: []string{"reader", "web", "context"}},
	{ID: "bigmodel-zread", Name: "BigModel ZRead", Description: "读取开源仓库知识、文档和代码，适合项目调研和技术方案生成。", Transport: "streamable-http", Endpoint: "https://open.bigmodel.cn/api/mcp/zread/mcp", Auth: "bearer", Provider: "bigmodel", RequiredEnv: "BIGMODEL_API_KEY", Enabled: true, ToolCount: 3, ToolNames: []string{"search_doc", "get_repo_structure", "read_file"}, Tags: []string{"repo", "code", "docs"}},
}

var Agents = []AgentBlueprint{
	{ID: "research-agent", Name: "调研 Agent", Role: "researcher", Description: "把联网搜索、网页读取和札记输入组合成可追溯的调研摘要。", ModelHint: "GLM / OpenAI compatible chat model", PromptVersion: "research-v1", PromptChecksum: PromptChecksum(researchPrompt), SystemPrompt: researchPrompt, MCPServerIDs: []string{"bigmodel-web-search", "bigmodel-web-reader", "bigmodel-zread"}, WorkflowTemplateIDs: []string{"agent-research-brief", "agent-repo-brief"}},
	{ID: "workflow-agent", Name: "秩序 Agent", Role: "operator", Description: "把灵感、笔记和外部上下文整理成可执行任务步骤。", ModelHint: "GLM / OpenAI compatible chat model", PromptVersion: "workflow-v1", PromptChecksum: PromptChecksum(workflowPrompt), SystemPrompt: workflowPrompt, MCPServerIDs: []string{"bigmodel-web-reader", "bigmodel-zread"}, WorkflowTemplateIDs: []string{"canvas-workflow", "note-copy", "note-message", "agent-research-brief", "agent-repo-brief"}},
}

var WorkflowPolicies = []WorkflowTemplatePolicy{
	{ID: "agent-research-brief", Name: "Agent 联网调研", ExecutionMode: "read_only", RequiresReview: false, SideEffects: []string{}, RetryLimit: 1, TimeoutSeconds: 90, AuditLevel: "evidence"},
	{ID: "agent-repo-brief", Name: "Agent 仓库调研", ExecutionMode: "read_only", RequiresReview: false, SideEffects: []string{}, RetryLimit: 1, TimeoutSeconds: 90, AuditLevel: "code_evidence"},
	{ID: "canvas-workflow", Name: "画布流程执行", ExecutionMode: "canvas_orchestration", RequiresReview: true, SideEffects: []string{"draft_plan", "reviewed_actions"}, RetryLimit: 1, TimeoutSeconds: 90, AuditLevel: "canvas_trace"},
	{ID: "note-copy", Name: "笔记整理成文案", ExecutionMode: "draft_only", RequiresReview: true, SideEffects: []string{"draft_content"}, RetryLimit: 0, TimeoutSeconds: 60, AuditLevel: "standard"},
	{ID: "note-message", Name: "笔记发送给联系人", ExecutionMode: "draft_only", RequiresReview: true, SideEffects: []string{"draft_message"}, RetryLimit: 0, TimeoutSeconds: 45, AuditLevel: "review_required"},
}

var WorkflowTemplates = map[string][][3]string{
	"agent-research-brief": {
		{"load_agent", "agent", "选择调研 Agent"},
		{"mcp_search", "mcp", "MCP 联网搜索"},
		{"mcp_read", "mcp", "MCP 网页读取"},
		{"synthesize", "ai", "生成摘要"},
	},
	"agent-repo-brief": {
		{"load_agent", "agent", "选择技术 Agent"},
		{"mcp_repo_search", "mcp", "ZRead 文档搜索"},
		{"mcp_repo_structure", "mcp", "ZRead 仓库结构"},
		{"mcp_read_file", "mcp", "ZRead 文件读取"},
		{"synthesize", "ai", "生成技术摘要"},
	},
	"canvas-workflow": {
		{"canvas_source", "notes", "读取画布"},
		{"canvas_plan", "transform", "梳理拓扑"},
		{"canvas_agent", "agent", "秩序编排"},
	},
	"note-copy": {
		{"source", "notes", "读取札记"},
		{"transform", "transform", "整理结构"},
		{"copy", "ai", "生成文案"},
	},
	"note-message": {
		{"source", "notes", "读取札记"},
		{"chat", "chat", "生成消息"},
	},
}

func PromptChecksum(prompt string) string {
	sum := sha256.Sum256([]byte(prompt))
	return hex.EncodeToString(sum[:])[:12]
}

func GetCatalog(db *gorm.DB, settings config.Settings) Catalog {
	return Catalog{
		Agents: ListConfiguredAgents(db), MCPServers: ListConfiguredMCPServers(db, settings), WorkflowTemplates: WorkflowPolicies,
		SecurityNote: "MCP API keys must stay on the backend. The frontend only selects agents and server ids.",
		GraphRuntime: map[string]any{"runtime": "internal", "requested": settings.AgentGraphRuntime, "available": false, "reason": "Go backend internal runtime"},
	}
}

func FindAgent(id string) (AgentBlueprint, bool) {
	for _, agent := range Agents {
		if agent.ID == id {
			return agent, true
		}
	}
	return AgentBlueprint{}, false
}

func ConfiguredAgent(agent AgentBlueprint, db *gorm.DB) AgentBlueprint {
	var record models.AgentPromptSetting
	if db == nil || db.First(&record, "agent_id = ?", agent.ID).Error != nil {
		return agent
	}
	prompt := strings.TrimSpace(record.SystemPrompt)
	if prompt == "" {
		prompt = agent.SystemPrompt
	}
	version := strings.TrimSpace(record.PromptVersion)
	if version == "" {
		version = agent.PromptVersion
	}
	agent.SystemPrompt = prompt
	agent.PromptVersion = version
	agent.PromptChecksum = PromptChecksum(prompt)
	return agent
}

func ConfiguredAgentByID(id string, db *gorm.DB) (AgentBlueprint, bool) {
	agent, ok := FindAgent(id)
	if !ok {
		return AgentBlueprint{}, false
	}
	return ConfiguredAgent(agent, db), true
}

func ListConfiguredAgents(db *gorm.DB) []AgentBlueprint {
	out := make([]AgentBlueprint, 0, len(Agents))
	for _, agent := range Agents {
		out = append(out, ConfiguredAgent(agent, db))
	}
	return out
}

func FindMCPServer(id string) (MCPServer, bool) {
	for _, server := range MCPServers {
		if server.ID == id {
			return server, true
		}
	}
	return MCPServer{}, false
}

func ListConfiguredMCPServers(db *gorm.DB, settings config.Settings) []MCPServer {
	enabled := MCPEnabledMap(db)
	out := make([]MCPServer, 0, len(MCPServers))
	for _, server := range MCPServers {
		value, ok := enabled[server.ID]
		if !ok {
			value = true
		}
		out = append(out, ConfiguredMCPServer(server, value, settings))
	}
	return out
}

func ConfiguredMCPServerByID(id string, db *gorm.DB, settings config.Settings) (MCPServer, bool) {
	server, ok := FindMCPServer(id)
	if !ok {
		return MCPServer{}, false
	}
	enabled := MCPEnabledMap(db)
	value, ok := enabled[id]
	if !ok {
		value = true
	}
	return ConfiguredMCPServer(server, value, settings), true
}

func ConfiguredMCPServer(server MCPServer, enabled bool, settings config.Settings) MCPServer {
	configured := strings.TrimSpace(os.Getenv(server.RequiredEnv)) != ""
	server.Enabled = enabled
	server.Configured = configured
	server.LiveEnabled = enabled && configured && settings.BigModelMCPLive
	return server
}

func MCPEnabledMap(db *gorm.DB) map[string]bool {
	var records []models.MCPServerSetting
	if db != nil {
		db.Find(&records)
	}
	out := map[string]bool{}
	for _, record := range records {
		out[record.ServerID] = record.Enabled
	}
	return out
}
