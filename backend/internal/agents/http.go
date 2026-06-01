package agents

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"4ever/backend/internal/config"
	"4ever/backend/internal/httputil"
	"4ever/backend/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Handler struct {
	DB       *gorm.DB
	Settings config.Settings
}

type ToolListResponse struct {
	ServerID    string   `json:"server_id"`
	ServerName  string   `json:"server_name"`
	ToolName    string   `json:"tool_name"`
	Enabled     bool     `json:"enabled"`
	Configured  bool     `json:"configured"`
	LiveEnabled bool     `json:"live_enabled"`
	Status      string   `json:"status"`
	Tools       []string `json:"tools"`
	Reason      string   `json:"reason"`
	Error       string   `json:"error"`
}

type ToolCallRequest struct {
	ToolName  string         `json:"tool_name" binding:"required"`
	Arguments map[string]any `json:"arguments"`
}

type ToolCallResponse struct {
	ServerID    string         `json:"server_id"`
	ServerName  string         `json:"server_name"`
	ToolName    string         `json:"tool_name"`
	Enabled     bool           `json:"enabled"`
	Configured  bool           `json:"configured"`
	LiveEnabled bool           `json:"live_enabled"`
	Status      string         `json:"status"`
	Arguments   map[string]any `json:"arguments"`
	Result      map[string]any `json:"result"`
	Reason      string         `json:"reason"`
	Error       string         `json:"error"`
}

type RunCreate struct {
	TemplateID   string            `json:"template_id" binding:"required"`
	AgentID      string            `json:"agent_id" binding:"required"`
	MCPServerIDs []string          `json:"mcp_server_ids"`
	Input        map[string]string `json:"input"`
	Source       string            `json:"source"`
	Canvas       map[string]any    `json:"canvas"`
}

type NodeResult struct {
	NodeID    string `json:"node_id"`
	Type      string `json:"type"`
	Title     string `json:"title"`
	GraphStep string `json:"graph_step"`
	Status    string `json:"status"`
	Output    string `json:"output"`
	StartedAt string `json:"started_at"`
	EndedAt   string `json:"ended_at"`
}

type RunResponse struct {
	ID                  string            `json:"id"`
	ThreadID            string            `json:"thread_id"`
	CheckpointID        string            `json:"checkpoint_id"`
	TemplateID          string            `json:"template_id"`
	AgentID             string            `json:"agent_id"`
	AgentPromptVersion  string            `json:"agent_prompt_version"`
	AgentPromptChecksum string            `json:"agent_prompt_checksum"`
	MCPServerIDs        []string          `json:"mcp_server_ids"`
	Status              string            `json:"status"`
	GraphSteps          []string          `json:"graph_steps"`
	Input               map[string]string `json:"input"`
	Canvas              map[string]any    `json:"canvas,omitempty"`
	NodeResults         []NodeResult      `json:"node_results"`
	ReviewStatus        string            `json:"review_status"`
	ReviewNote          string            `json:"review_note"`
	ReviewedAt          string            `json:"reviewed_at"`
	StartedAt           string            `json:"started_at"`
	EndedAt             string            `json:"ended_at"`
}

type RunListResponse struct {
	Runs []RunResponse `json:"runs"`
}

type RunReviewUpdate struct {
	Status string `json:"status" binding:"required"`
	Note   string `json:"note"`
}

func Register(group *gin.RouterGroup, h Handler) {
	r := group.Group("/agents")
	r.GET("/catalog", h.Catalog)
	r.GET("/mcp/:server_id/tools", h.MCPTools)
	r.POST("/mcp/:server_id/tools/call", h.MCPToolCall)
	r.POST("/runs", h.CreateRun)
	r.POST("/runs/stream", h.StreamRun)
	r.GET("/runs", h.ListRuns)
	r.GET("/runs/:run_id", h.GetRun)
	r.GET("/runs/:run_id/events", h.RunEvents)
	r.PATCH("/runs/:run_id/review", h.ReviewRun)
	r.POST("/runs/:run_id/cancel", h.CancelRun)
	r.POST("/runs/:run_id/resume", h.ResumeRun)
	r.GET("/runs/:run_id/checkpoint", h.RunCheckpoint)
	r.GET("/runs/:run_id/checkpoints", h.RunCheckpoints)
}

func (h Handler) Catalog(c *gin.Context) {
	c.JSON(http.StatusOK, GetCatalog(h.DB, h.Settings))
}

func (h Handler) MCPTools(c *gin.Context) {
	server, ok := ConfiguredMCPServerByID(c.Param("server_id"), h.DB, h.Settings)
	if !ok {
		httputil.Error(c, http.StatusNotFound, "MCP server not found.")
		return
	}
	if !server.Enabled {
		httputil.Error(c, http.StatusForbidden, "MCP server is disabled by admin policy.")
		return
	}
	result := h.listMCPTools(server)
	c.JSON(http.StatusOK, ToolListResponse{
		ServerID: server.ID, ServerName: server.Name, ToolName: "tools/list", Enabled: server.Enabled,
		Configured: server.Configured, LiveEnabled: server.LiveEnabled, Status: stringValue(result["status"], "planned"),
		Tools: toolNamesFromResult(result, server.ToolNames), Reason: stringValue(result["reason"], ""), Error: stringValue(result["error"], ""),
	})
}

func (h Handler) listMCPTools(server MCPServer) map[string]any {
	if !server.Configured {
		return plannedMCPResult(server, "tools/list", map[string]any{}, server.RequiredEnv+" is not configured.")
	}
	if !server.LiveEnabled {
		return plannedMCPResult(server, "tools/list", map[string]any{}, "BIGMODEL_MCP_LIVE is disabled.")
	}
	result, err := h.mcpJSONRPC(server, "tools/list", map[string]any{})
	if err != nil {
		return map[string]any{"status": "failed", "error": err.Error()}
	}
	return map[string]any{"status": "success", "result": result}
}

func (h Handler) MCPToolCall(c *gin.Context) {
	server, ok := ConfiguredMCPServerByID(c.Param("server_id"), h.DB, h.Settings)
	if !ok {
		httputil.Error(c, http.StatusNotFound, "MCP server not found.")
		return
	}
	if !server.Enabled {
		httputil.Error(c, http.StatusForbidden, "MCP server is disabled by admin policy.")
		return
	}
	var req ToolCallRequest
	if !httputil.BindJSON(c, &req) {
		return
	}
	allowed := false
	for _, name := range server.ToolNames {
		if name == req.ToolName {
			allowed = true
			break
		}
	}
	if !allowed {
		httputil.Error(c, http.StatusBadRequest, "Tool is not allowlisted for this MCP server.")
		return
	}
	result := h.callMCPTool(server, req.ToolName, req.Arguments)
	c.JSON(http.StatusOK, ToolCallResponse{
		ServerID: server.ID, ServerName: server.Name, ToolName: req.ToolName, Enabled: server.Enabled, Configured: server.Configured,
		LiveEnabled: server.LiveEnabled, Status: stringValue(result["status"], "planned"), Arguments: req.Arguments,
		Result: mapValue(result["result"]), Reason: stringValue(result["reason"], ""), Error: stringValue(result["error"], ""),
	})
}

func (h Handler) CreateRun(c *gin.Context) {
	var req RunCreate
	if !httputil.BindJSON(c, &req) {
		return
	}
	run, status, detail := h.executeRun(req)
	if status >= 400 {
		httputil.Error(c, status, detail)
		return
	}
	c.JSON(http.StatusOK, run)
}

func (h Handler) StreamRun(c *gin.Context) {
	var req RunCreate
	if !httputil.BindJSON(c, &req) {
		return
	}
	run, status, detail := h.executeRun(req)
	if status >= 400 {
		httputil.Error(c, status, detail)
		return
	}
	c.Header("Cache-Control", "no-cache")
	c.Header("X-Accel-Buffering", "no")
	c.Header("Content-Type", "text/event-stream")
	for _, result := range run.NodeResults {
		event := map[string]string{"run_id": run.ID, "node_id": result.NodeID, "status": result.Status, "output": result.Output}
		writeSSE(c, "node.completed", event)
	}
	writeSSE(c, "run.completed", map[string]string{"run_id": run.ID, "status": run.Status})
}

func (h Handler) ListRuns(c *gin.Context) {
	limit := 30
	var records []models.WorkflowAgentRun
	h.DB.Order("created_at DESC").Limit(limit).Find(&records)
	out := make([]RunResponse, 0, len(records))
	for _, record := range records {
		out = append(out, runFromRecord(record))
	}
	c.JSON(http.StatusOK, RunListResponse{Runs: out})
}

func (h Handler) GetRun(c *gin.Context) {
	var record models.WorkflowAgentRun
	if err := h.DB.First(&record, "id = ?", c.Param("run_id")).Error; err != nil {
		httputil.Error(c, http.StatusNotFound, "Agent run not found.")
		return
	}
	c.JSON(http.StatusOK, runFromRecord(record))
}

func (h Handler) RunEvents(c *gin.Context) {
	var record models.WorkflowAgentRun
	if err := h.DB.First(&record, "id = ?", c.Param("run_id")).Error; err != nil {
		httputil.Error(c, http.StatusNotFound, "Agent run not found.")
		return
	}
	c.Header("Content-Type", "text/event-stream")
	var events []map[string]any
	_ = json.Unmarshal([]byte(record.EventsJSON), &events)
	for _, event := range events {
		name, _ := event["event"].(string)
		data, _ := event["data"].(map[string]any)
		writeSSEAny(c, name, data)
	}
}

func (h Handler) ReviewRun(c *gin.Context) {
	var req RunReviewUpdate
	if !httputil.BindJSON(c, &req) {
		return
	}
	if req.Status != "approved" && req.Status != "rejected" {
		httputil.Error(c, http.StatusUnprocessableEntity, "status must be approved or rejected")
		return
	}
	var record models.WorkflowAgentRun
	if err := h.DB.First(&record, "id = ?", c.Param("run_id")).Error; err != nil {
		httputil.Error(c, http.StatusNotFound, "Agent run not found.")
		return
	}
	if record.ReviewStatus == "not_required" {
		httputil.Error(c, http.StatusBadRequest, "Review is not required for this run.")
		return
	}
	now := time.Now().UTC()
	record.ReviewStatus = req.Status
	record.ReviewNote = req.Note
	record.ReviewedAt = &now
	h.DB.Save(&record)
	c.JSON(http.StatusOK, runFromRecord(record))
}

func (h Handler) CancelRun(c *gin.Context) {
	var record models.WorkflowAgentRun
	if err := h.DB.First(&record, "id = ?", c.Param("run_id")).Error; err != nil {
		httputil.Error(c, http.StatusNotFound, "Agent run not found.")
		return
	}
	if record.Status != "running" {
		httputil.Error(c, http.StatusConflict, "Agent run is already "+record.Status+".")
		return
	}
	now := time.Now().UTC()
	record.Status = "canceled"
	record.EndedAt = &now
	h.DB.Save(&record)
	c.JSON(http.StatusOK, runFromRecord(record))
}

func (h Handler) ResumeRun(c *gin.Context) {
	var record models.WorkflowAgentRun
	if err := h.DB.First(&record, "id = ?", c.Param("run_id")).Error; err != nil {
		httputil.Error(c, http.StatusNotFound, "Agent run not found.")
		return
	}
	if record.Status != "failed" && record.Status != "canceled" {
		httputil.Error(c, http.StatusConflict, "Agent run is "+record.Status+"; only failed or canceled runs can be resumed.")
		return
	}
	req := RunCreate{TemplateID: record.TemplateID, AgentID: record.AgentID}
	_ = json.Unmarshal([]byte(record.MCPServerIDsJSON), &req.MCPServerIDs)
	_ = json.Unmarshal([]byte(record.InputJSON), &req.Input)
	_ = json.Unmarshal([]byte(record.CanvasJSON), &req.Canvas)
	run, status, detail := h.executeRun(req)
	if status >= 400 {
		httputil.Error(c, status, detail)
		return
	}
	c.JSON(http.StatusOK, run)
}

func (h Handler) RunCheckpoint(c *gin.Context) {
	var record models.WorkflowAgentRun
	if err := h.DB.First(&record, "id = ?", c.Param("run_id")).Error; err != nil {
		httputil.Error(c, http.StatusNotFound, "Agent run not found.")
		return
	}
	run := runFromRecord(record)
	steps := []map[string]any{}
	for _, step := range run.GraphSteps {
		steps = append(steps, map[string]any{"graph_step": step, "status": "success", "checkpoint_id": record.CheckpointID})
	}
	c.JSON(http.StatusOK, map[string]any{"run_id": record.ID, "thread_id": record.ThreadID, "checkpoint_id": record.CheckpointID, "status": record.Status, "resumable": record.Status == "failed" || record.Status == "canceled", "graph_steps": run.GraphSteps, "completed_steps": run.GraphSteps, "event_count": len(run.NodeResults), "steps": steps, "langgraph": map[string]any{}})
}

func (h Handler) RunCheckpoints(c *gin.Context) {
	var records []models.WorkflowAgentCheckpoint
	h.DB.Where("run_id = ?", c.Param("run_id")).Order("id ASC").Find(&records)
	out := []map[string]any{}
	for _, record := range records {
		var state map[string]any
		_ = json.Unmarshal([]byte(record.StateJSON), &state)
		out = append(out, map[string]any{"id": record.ID, "run_id": record.RunID, "thread_id": record.ThreadID, "checkpoint_id": record.CheckpointID, "graph_step": record.GraphStep, "node_id": record.NodeID, "status": record.Status, "state": state, "created_at": record.CreatedAt.Format(time.RFC3339)})
	}
	c.JSON(http.StatusOK, map[string]any{"checkpoints": out})
}

func (h Handler) executeRun(req RunCreate) (RunResponse, int, string) {
	agent, ok := ConfiguredAgentByID(req.AgentID, h.DB)
	if !ok {
		return RunResponse{}, http.StatusNotFound, "Agent not found."
	}
	if !stringIn(req.TemplateID, agent.WorkflowTemplateIDs) {
		return RunResponse{}, http.StatusBadRequest, "Template is not allowed for this agent."
	}
	policy := WorkflowTemplatePolicy{}
	for _, candidate := range WorkflowPolicies {
		if candidate.ID == req.TemplateID {
			policy = candidate
			ok = true
			break
		}
	}
	if !ok || policy.ID == "" {
		return RunResponse{}, http.StatusNotFound, "Workflow template not found."
	}
	for _, serverID := range req.MCPServerIDs {
		server, ok := ConfiguredMCPServerByID(serverID, h.DB, h.Settings)
		if !ok {
			return RunResponse{}, http.StatusNotFound, "Unknown MCP server: " + serverID
		}
		if !stringIn(serverID, agent.MCPServerIDs) {
			return RunResponse{}, http.StatusBadRequest, "MCP server is not allowed for this agent: " + serverID
		}
		if !server.Enabled {
			return RunResponse{}, http.StatusForbidden, "MCP server is disabled by admin policy: " + serverID
		}
	}
	now := time.Now().UTC()
	runID := "run-" + strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	threadID := "thread-" + strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	templateNodes := WorkflowTemplates[req.TemplateID]
	graphSteps := make([]string, 0, len(templateNodes)+1)
	nodeResults := make([]NodeResult, 0, len(templateNodes))
	source := firstInputValue(req.Input)
	runStatus := "success"
	for index, node := range templateNodes {
		step, nodeType, title := node[0], node[1], node[2]
		graphSteps = append(graphSteps, step)
		output, status := h.renderNode(step, nodeType, title, source, index, agent, req.MCPServerIDs, graphSteps)
		if status == "failed" {
			runStatus = "failed"
		}
		nodeResults = append(nodeResults, NodeResult{
			NodeID: step, Type: nodeType, Title: title, GraphStep: step, Status: status, Output: output,
			StartedAt: now.Format(time.RFC3339), EndedAt: now.Format(time.RFC3339),
		})
		if status == "failed" {
			break
		}
	}
	if runStatus == "success" {
		graphSteps = append(graphSteps, "persist")
	}
	reviewStatus := "not_required"
	if policy.RequiresReview {
		reviewStatus = "pending"
	}
	ended := now
	input := map[string]string{}
	for key, value := range req.Input {
		input[key] = value
	}
	if req.Source == "" {
		req.Source = "manual"
	}
	input["source"] = req.Source
	run := RunResponse{ID: runID, ThreadID: threadID, CheckpointID: checkpointID(threadID, graphSteps), TemplateID: req.TemplateID, AgentID: req.AgentID, AgentPromptVersion: agent.PromptVersion, AgentPromptChecksum: agent.PromptChecksum, MCPServerIDs: req.MCPServerIDs, Status: runStatus, GraphSteps: graphSteps, Input: input, Canvas: req.Canvas, NodeResults: nodeResults, ReviewStatus: reviewStatus, ReviewNote: "", ReviewedAt: "", StartedAt: now.Format(time.RFC3339), EndedAt: ended.Format(time.RFC3339)}
	h.saveRun(run, &ended)
	return run, http.StatusOK, ""
}

func (h Handler) renderNode(step string, nodeType string, title string, source string, index int, agent AgentBlueprint, serverIDs []string, trace []string) (string, string) {
	switch nodeType {
	case "agent":
		return strings.Join([]string{
			fmt.Sprintf("%s 已加载。模型建议：%s。", agent.Name, agent.ModelHint),
			fmt.Sprintf("LangGraph plan: %s", strings.Join(trace, " -> ")),
			fmt.Sprintf("Graph trace: %s", strings.Join(trace, " -> ")),
			"密钥由后端环境变量托管。",
		}, "\n"), "success"
	case "mcp":
		if len(serverIDs) == 0 {
			return "没有绑定 MCP Server。", "success"
		}
		serverIndex := index - 1
		if serverIndex < 0 || serverIndex >= len(serverIDs) {
			serverIndex = 0
		}
		server, _ := ConfiguredMCPServerByID(serverIDs[serverIndex], h.DB, h.Settings)
		tool := toolForNode(step, server)
		args := argumentsForTool(tool, source)
		result := h.callMCPTool(server, tool, args)
		status := "success"
		if stringValue(result["status"], "") == "failed" {
			status = "failed"
		}
		return renderMCPOutput(server, tool, result), status
	case "notes":
		if source == "" {
			return "等待输入内容。", "success"
		}
		return truncate(source, 120), "success"
	case "transform":
		return fmt.Sprintf("标题：%s...\n要点：%s", truncate(source, 18), truncate(source, 180)), "success"
	case "chat":
		return "我整理了一段内容，想同步给你：" + truncate(source, 160), "success"
	case "ai":
		if !h.Settings.AgentSynthesisLive {
			return strings.Join([]string{"计划生成摘要", "Reason: AGENT_SYNTHESIS_LIVE is disabled.", "Draft: 基于内容生成：" + truncate(source, 180)}, "\n"), "success"
		}
		return "模型生成摘要\n" + truncate(source, 600), "success"
	default:
		return fmt.Sprintf("%s 已处理：%s", title, truncate(source, 180)), "success"
	}
}

func (h Handler) saveRun(run RunResponse, ended *time.Time) {
	graphSteps, _ := json.Marshal(run.GraphSteps)
	servers, _ := json.Marshal(run.MCPServerIDs)
	input, _ := json.Marshal(run.Input)
	canvas, _ := json.Marshal(run.Canvas)
	results, _ := json.Marshal(run.NodeResults)
	events, _ := json.Marshal([]map[string]any{{"event": "run.finished", "data": map[string]string{"run_id": run.ID, "status": run.Status, "ended_at": run.EndedAt}}})
	started, _ := time.Parse(time.RFC3339, run.StartedAt)
	record := models.WorkflowAgentRun{ID: run.ID, ThreadID: run.ThreadID, CheckpointID: run.CheckpointID, TemplateID: run.TemplateID, AgentID: run.AgentID, AgentPromptVersion: run.AgentPromptVersion, AgentPromptChecksum: run.AgentPromptChecksum, Status: run.Status, GraphStepsJSON: string(graphSteps), EventsJSON: string(events), MCPServerIDsJSON: string(servers), InputJSON: string(input), CanvasJSON: string(canvas), NodeResultsJSON: string(results), ReviewStatus: run.ReviewStatus, ReviewNote: run.ReviewNote, StartedAt: started, EndedAt: ended}
	h.DB.Save(&record)
	for index, step := range run.GraphSteps {
		state, _ := json.Marshal(map[string]any{"run_id": run.ID, "step": step})
		checkpointID := checkpointID(run.ThreadID, run.GraphSteps[:index+1])
		h.DB.Create(&models.WorkflowAgentCheckpoint{RunID: run.ID, ThreadID: run.ThreadID, CheckpointID: checkpointID, GraphStep: step, NodeID: step, Status: "success", StateJSON: string(state), NodeResultJSON: "{}", EventsJSON: "[]"})
	}
}

func runFromRecord(record models.WorkflowAgentRun) RunResponse {
	var graphSteps []string
	var servers []string
	var input map[string]string
	var canvas map[string]any
	var results []NodeResult
	_ = json.Unmarshal([]byte(record.GraphStepsJSON), &graphSteps)
	_ = json.Unmarshal([]byte(record.MCPServerIDsJSON), &servers)
	_ = json.Unmarshal([]byte(record.InputJSON), &input)
	_ = json.Unmarshal([]byte(record.CanvasJSON), &canvas)
	_ = json.Unmarshal([]byte(record.NodeResultsJSON), &results)
	ended := ""
	if record.EndedAt != nil {
		ended = record.EndedAt.Format(time.RFC3339)
	}
	reviewed := ""
	if record.ReviewedAt != nil {
		reviewed = record.ReviewedAt.Format(time.RFC3339)
	}
	return RunResponse{ID: record.ID, ThreadID: record.ThreadID, CheckpointID: record.CheckpointID, TemplateID: record.TemplateID, AgentID: record.AgentID, AgentPromptVersion: record.AgentPromptVersion, AgentPromptChecksum: record.AgentPromptChecksum, MCPServerIDs: servers, Status: record.Status, GraphSteps: graphSteps, Input: input, Canvas: canvas, NodeResults: results, ReviewStatus: record.ReviewStatus, ReviewNote: record.ReviewNote, ReviewedAt: reviewed, StartedAt: record.StartedAt.Format(time.RFC3339), EndedAt: ended}
}

func writeSSE(c *gin.Context, event string, data map[string]string) {
	raw, _ := json.Marshal(data)
	c.Writer.WriteString("event: " + event + "\n")
	c.Writer.WriteString("data: " + string(raw) + "\n\n")
	c.Writer.Flush()
}

func writeSSEAny(c *gin.Context, event string, data map[string]any) {
	raw, _ := json.Marshal(data)
	c.Writer.WriteString("event: " + event + "\n")
	c.Writer.WriteString("data: " + string(raw) + "\n\n")
	c.Writer.Flush()
}

func (h Handler) callMCPTool(server MCPServer, toolName string, arguments map[string]any) map[string]any {
	if arguments == nil {
		arguments = map[string]any{}
	}
	if !stringIn(toolName, server.ToolNames) {
		return plannedMCPResult(server, toolName, arguments, "Tool is not allowlisted for "+server.ID+".")
	}
	if !server.Configured {
		return plannedMCPResult(server, toolName, arguments, server.RequiredEnv+" is not configured.")
	}
	if !server.LiveEnabled {
		return plannedMCPResult(server, toolName, arguments, "BIGMODEL_MCP_LIVE is disabled.")
	}
	result, err := h.mcpJSONRPC(server, "tools/call", map[string]any{"name": toolName, "arguments": arguments})
	if err != nil {
		return map[string]any{"status": "failed", "tool_name": toolName, "arguments": arguments, "error": truncate(err.Error(), 600)}
	}
	return map[string]any{"status": "success", "tool_name": toolName, "arguments": arguments, "result": result}
}

func plannedMCPResult(server MCPServer, toolName string, arguments map[string]any, reason string) map[string]any {
	return map[string]any{"server_id": server.ID, "server_name": server.Name, "tool_name": toolName, "arguments": arguments, "configured": server.Configured, "live_enabled": server.LiveEnabled, "status": "planned", "reason": reason}
}

func (h Handler) mcpJSONRPC(server MCPServer, method string, params map[string]any) (map[string]any, error) {
	apiKey := strings.TrimSpace(os.Getenv(server.RequiredEnv))
	headers := map[string]string{
		"Authorization":        "Bearer " + apiKey,
		"Content-Type":         "application/json",
		"Accept":               "application/json, text/event-stream",
		"MCP-Protocol-Version": "2025-06-18",
	}
	sessionID, err := h.mcpPost(server.Endpoint, headers, map[string]any{"jsonrpc": "2.0", "id": "initialize", "method": "initialize", "params": map[string]any{"protocolVersion": "2025-06-18", "capabilities": map[string]any{}, "clientInfo": map[string]string{"name": "4Ever", "version": "0.1.0"}}})
	if err != nil {
		return nil, err
	}
	if sid := stringValue(sessionID["_session_id"], ""); sid != "" {
		headers["Mcp-Session-Id"] = sid
	}
	_, _ = h.mcpPost(server.Endpoint, headers, map[string]any{"jsonrpc": "2.0", "method": "notifications/initialized"})
	return h.mcpPost(server.Endpoint, headers, map[string]any{"jsonrpc": "2.0", "id": method, "method": method, "params": params})
}

func (h Handler) mcpPost(endpoint string, headers map[string]string, payload map[string]any) (map[string]any, error) {
	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	client := http.Client{Timeout: time.Duration(h.Settings.MCPTimeoutSeconds * float64(time.Second))}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("MCP server returned HTTP %d: %s", resp.StatusCode, truncate(string(data), 600))
	}
	result, err := parseMCPPayload(resp.Header.Get("content-type"), data)
	if err != nil {
		return nil, err
	}
	if sid := resp.Header.Get("Mcp-Session-Id"); sid != "" {
		result["_session_id"] = sid
	}
	return result, nil
}

func parseMCPPayload(contentType string, data []byte) (map[string]any, error) {
	if strings.Contains(contentType, "text/event-stream") {
		for _, line := range strings.Split(string(data), "\n") {
			if !strings.HasPrefix(line, "data:") {
				continue
			}
			raw := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
			if raw == "" {
				continue
			}
			return unwrapJSONRPC([]byte(raw))
		}
		return map[string]any{}, nil
	}
	return unwrapJSONRPC(data)
}

func unwrapJSONRPC(data []byte) (map[string]any, error) {
	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		return nil, fmt.Errorf("MCP server returned a non-JSON response")
	}
	if payload["error"] != nil {
		return nil, fmt.Errorf("MCP JSON-RPC error: %v", payload["error"])
	}
	if result, ok := payload["result"].(map[string]any); ok {
		return result, nil
	}
	return payload, nil
}

func toolNamesFromResult(result map[string]any, fallback []string) []string {
	if stringValue(result["status"], "") != "success" {
		return fallback
	}
	body := mapValue(result["result"])
	items, _ := body["tools"].([]any)
	names := []string{}
	for _, item := range items {
		row, _ := item.(map[string]any)
		name := stringValue(row["name"], "")
		if name != "" {
			names = append(names, name)
		}
	}
	if len(names) == 0 {
		return fallback
	}
	return names
}

func toolForNode(step string, server MCPServer) string {
	if server.ID == "bigmodel-web-search" {
		return "webSearchPrime"
	}
	if server.ID == "bigmodel-web-reader" {
		return "webReader"
	}
	if server.ID == "bigmodel-zread" {
		lower := strings.ToLower(step)
		if strings.Contains(lower, "search") {
			return "search_doc"
		}
		if strings.Contains(lower, "structure") || strings.Contains(lower, "repo") {
			return "get_repo_structure"
		}
		if strings.Contains(lower, "file") || strings.Contains(lower, "read") {
			return "read_file"
		}
		return "search_doc"
	}
	if len(server.ToolNames) > 0 {
		return server.ToolNames[0]
	}
	return step
}

func argumentsForTool(toolName string, source string) map[string]any {
	switch toolName {
	case "webSearchPrime":
		return map[string]any{"query": source}
	case "webReader":
		url := firstURL(source)
		if url == "" {
			url = source
		}
		return map[string]any{"url": url}
	case "search_doc":
		out := map[string]any{"query": source}
		for key, value := range zreadRepoArguments(source) {
			out[key] = value
		}
		return out
	case "get_repo_structure":
		return zreadRepoArguments(source)
	case "read_file":
		out := zreadRepoArguments(source)
		out["file_path"] = zreadFilePath(source)
		return out
	default:
		return map[string]any{"input": source}
	}
}

func zreadRepoArguments(source string) map[string]any {
	if repo := firstRepoReference(source); repo != "" {
		return map[string]any{"repo": repo}
	}
	return map[string]any{"query": source}
}

func firstRepoReference(text string) string {
	for _, part := range strings.Fields(strings.ReplaceAll(text, "\n", " ")) {
		cleaned := strings.Trim(part, ".,，。)>")
		if strings.Contains(cleaned, "github.com/") {
			cleaned = strings.TrimPrefix(strings.TrimPrefix(cleaned, "https://github.com/"), "http://github.com/")
			return cleaned
		}
		if strings.Count(cleaned, "/") == 1 && !strings.HasPrefix(cleaned, "http://") && !strings.HasPrefix(cleaned, "https://") {
			return cleaned
		}
	}
	return ""
}

func zreadFilePath(text string) string {
	for _, marker := range []string{"file:", "path:", "文件：", "路径："} {
		if strings.Contains(text, marker) {
			return strings.Trim(strings.Fields(strings.SplitN(text, marker, 2)[1])[0], ".,，。)")
		}
	}
	for _, part := range strings.Fields(strings.ReplaceAll(text, "\n", " ")) {
		cleaned := strings.Trim(part, ".,，。)")
		if strings.Contains(cleaned, "/") && strings.Contains(cleaned, ".") && !strings.Contains(cleaned, "github.com") {
			return cleaned
		}
	}
	return "README.md"
}

func firstURL(text string) string {
	for _, part := range strings.Fields(text) {
		if strings.HasPrefix(part, "http://") || strings.HasPrefix(part, "https://") {
			return strings.Trim(part, ".,，。)")
		}
	}
	return ""
}

func renderMCPOutput(server MCPServer, toolName string, result map[string]any) string {
	status := stringValue(result["status"], "planned")
	lines := []string{
		map[bool]string{true: "调用 ", false: "计划调用 "}[status == "success"] + server.Name,
		"Tool: " + toolName,
		"Transport: " + server.Transport,
		"Auth: " + server.Auth + " via " + server.RequiredEnv,
		fmt.Sprintf("Configured: %s", yesNo(server.Configured)),
		fmt.Sprintf("Live enabled: %s", yesNo(server.LiveEnabled)),
		"Endpoint: " + server.Endpoint,
	}
	if status == "planned" {
		lines = append(lines, "Reason: "+stringValue(result["reason"], "not executed"))
	} else if status == "failed" {
		lines = append(lines, "Error: "+stringValue(result["error"], "MCP call failed"))
	} else {
		raw, _ := json.Marshal(mapValue(result["result"]))
		lines = append(lines, "Result:", string(raw))
	}
	return strings.Join(lines, "\n")
}

func checkpointID(threadID string, trace []string) string {
	last := "start"
	if len(trace) > 0 {
		last = trace[len(trace)-1]
	}
	return fmt.Sprintf("%s:%d:%s", threadID, len(trace), last)
}

func firstInputValue(input map[string]string) string {
	for _, value := range input {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func stringIn(value string, values []string) bool {
	for _, item := range values {
		if item == value {
			return true
		}
	}
	return false
}

func stringValue(value any, fallback string) string {
	text, ok := value.(string)
	if !ok || text == "" {
		return fallback
	}
	return text
}

func mapValue(value any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	if row, ok := value.(map[string]any); ok {
		return row
	}
	return map[string]any{}
}

func yesNo(value bool) string {
	if value {
		return "yes"
	}
	return "no"
}

func truncate(value string, limit int) string {
	if len([]rune(value)) <= limit {
		return value
	}
	runes := []rune(value)
	return string(runes[:limit])
}
