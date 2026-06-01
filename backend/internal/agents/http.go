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
	ToolName  string         `json:"tool_name" binding:"required,max=120"`
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

type runExecution struct {
	Run    RunResponse
	Events []map[string]any
}

type runOptions struct {
	ResumeFrom  *RunResponse
	ResumeAfter string
}

type graphNode struct {
	NodeID    string
	Type      string
	Title     string
	GraphStep string
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
	return map[string]any{"status": "success", "result": redactAndTrim(result, h.Settings.MCPResultMaxChars)}
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
	if req.Arguments == nil {
		req.Arguments = map[string]any{}
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
	execution, status, detail := h.executeRun(req)
	if status >= 400 {
		httputil.Error(c, status, detail)
		return
	}
	c.JSON(http.StatusOK, execution.Run)
}

func (h Handler) StreamRun(c *gin.Context) {
	var req RunCreate
	if !httputil.BindJSON(c, &req) {
		return
	}
	execution, status, detail := h.executeRun(req)
	if status >= 400 {
		httputil.Error(c, status, detail)
		return
	}
	c.Header("Cache-Control", "no-cache")
	c.Header("X-Accel-Buffering", "no")
	c.Header("Content-Type", "text/event-stream")
	for _, event := range execution.Events {
		name, _ := event["event"].(string)
		data, _ := event["data"].(map[string]string)
		if data == nil {
			data = stringMapValue(event["data"])
		}
		writeSSE(c, name, data)
	}
}

func (h Handler) ListRuns(c *gin.Context) {
	limit := 30
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		var parsed int
		if _, err := fmt.Sscanf(raw, "%d", &parsed); err != nil || parsed < 1 || parsed > 100 {
			httputil.Error(c, http.StatusUnprocessableEntity, "limit must be between 1 and 100.")
			return
		}
		limit = parsed
	}
	var records []models.WorkflowAgentRun
	h.DB.Order("started_at DESC").Limit(limit).Find(&records)
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
	events := eventsFromRecord(record)
	events = append(events, map[string]any{"event": "run.cancelled", "data": map[string]string{"run_id": record.ID, "status": "canceled", "reason": "cancelled by user", "ended_at": now.Format(time.RFC3339)}})
	rawEvents, _ := json.Marshal(events)
	record.EventsJSON = string(rawEvents)
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
	previous := runFromRecord(record)
	resumeAfter := lastSuccessfulGraphStep(previous)
	if resumeAfter == "" {
		httputil.Error(c, http.StatusConflict, "Run has no successful checkpoint to resume from.")
		return
	}
	req := RunCreate{TemplateID: record.TemplateID, AgentID: record.AgentID}
	_ = json.Unmarshal([]byte(record.MCPServerIDsJSON), &req.MCPServerIDs)
	_ = json.Unmarshal([]byte(record.InputJSON), &req.Input)
	delete(req.Input, "source")
	req.Source = previous.Input["source"]
	_ = json.Unmarshal([]byte(record.CanvasJSON), &req.Canvas)
	execution, status, detail := h.executeRunWithOptions(req, runOptions{ResumeFrom: &previous, ResumeAfter: resumeAfter})
	if status >= 400 {
		httputil.Error(c, status, detail)
		return
	}
	c.JSON(http.StatusOK, execution.Run)
}

func (h Handler) RunCheckpoint(c *gin.Context) {
	var record models.WorkflowAgentRun
	if err := h.DB.First(&record, "id = ?", c.Param("run_id")).Error; err != nil {
		httputil.Error(c, http.StatusNotFound, "Agent run not found.")
		return
	}
	c.JSON(http.StatusOK, h.inspectRunCheckpoint(record))
}

func (h Handler) RunCheckpoints(c *gin.Context) {
	var runRecord models.WorkflowAgentRun
	if err := h.DB.First(&runRecord, "id = ?", c.Param("run_id")).Error; err != nil {
		httputil.Error(c, http.StatusNotFound, "Agent run not found.")
		return
	}
	var records []models.WorkflowAgentCheckpoint
	h.DB.Where("run_id = ?", c.Param("run_id")).Order("id ASC").Find(&records)
	out := []map[string]any{}
	for _, record := range records {
		var state map[string]any
		_ = json.Unmarshal([]byte(record.StateJSON), &state)
		out = append(out, map[string]any{"id": record.ID, "run_id": record.RunID, "thread_id": record.ThreadID, "checkpoint_id": record.CheckpointID, "graph_step": record.GraphStep, "node_id": record.NodeID, "status": record.Status, "state": state, "event_count": len(eventsFromJSON(record.EventsJSON)), "created_at": record.CreatedAt.Format(time.RFC3339)})
	}
	c.JSON(http.StatusOK, map[string]any{"checkpoints": out})
}

func (h Handler) executeRun(req RunCreate) (runExecution, int, string) {
	return h.executeRunWithOptions(req, runOptions{})
}

func (h Handler) executeRunWithOptions(req RunCreate, options runOptions) (runExecution, int, string) {
	agent, ok := ConfiguredAgentByID(req.AgentID, h.DB)
	if !ok {
		return runExecution{}, http.StatusNotFound, "Agent not found."
	}
	if !stringIn(req.TemplateID, agent.WorkflowTemplateIDs) {
		return runExecution{}, http.StatusBadRequest, "Template is not allowed for this agent."
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
		return runExecution{}, http.StatusNotFound, "Workflow template not found."
	}
	for _, serverID := range req.MCPServerIDs {
		server, ok := ConfiguredMCPServerByID(serverID, h.DB, h.Settings)
		if !ok {
			return runExecution{}, http.StatusNotFound, "Unknown MCP server: " + serverID
		}
		if !stringIn(serverID, agent.MCPServerIDs) {
			return runExecution{}, http.StatusBadRequest, "MCP server is not allowed for this agent: " + serverID
		}
		if !server.Enabled {
			return runExecution{}, http.StatusForbidden, "MCP server is disabled by admin policy: " + serverID
		}
	}
	now := time.Now().UTC()
	runID := "run-" + strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	threadID := "thread-" + strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	if options.ResumeFrom != nil && options.ResumeFrom.ThreadID != "" {
		threadID = options.ResumeFrom.ThreadID
	}
	graphNodes := buildGraphNodes(req.TemplateID, req.Canvas)
	graphPlan := graphStepPlan(graphNodes)
	graphSteps := resumedGraphSteps(options.ResumeFrom, options.ResumeAfter)
	nodeResults := resumedNodeResults(options.ResumeFrom, options.ResumeAfter)
	startIndex := resumeStartIndex(graphNodes, options.ResumeAfter)
	source := firstInputValue(req.Input)
	runStatus := "success"
	events := []map[string]any{{"event": "run.started", "data": map[string]string{"run_id": runID, "template_id": req.TemplateID, "agent_id": agent.ID, "status": "running", "started_at": now.Format(time.RFC3339)}}}
	if options.ResumeAfter != "" {
		events = append(events, map[string]any{"event": "run.resumed", "data": map[string]string{"run_id": runID, "template_id": req.TemplateID, "agent_id": agent.ID, "resume_after": options.ResumeAfter, "start_index": fmt.Sprintf("%d", startIndex)}})
	}
	for index := startIndex; index < len(graphNodes); index++ {
		node := graphNodes[index]
		graphSteps = append(graphSteps, node.GraphStep)
		result := h.executeGraphNodeWithRetry(node, source, index, agent, req.MCPServerIDs, graphSteps, graphPlan, req.Canvas, policy.RetryLimit, runID, req.TemplateID, &events)
		if result.Status == "failed" {
			runStatus = "failed"
		}
		nodeResults = append(nodeResults, result)
		events = append(events, nodeFinishedEvent(runID, result))
		if result.Status == "failed" {
			break
		}
	}
	if len(graphNodes) > 0 && (len(graphSteps) == 0 || graphSteps[len(graphSteps)-1] != "persist") {
		graphSteps = append(graphSteps, "persist")
	}
	reviewStatus := "not_required"
	if policy.RequiresReview {
		reviewStatus = "pending"
	}
	reviewNote := ""
	reviewedAt := ""
	if options.ResumeFrom != nil {
		reviewStatus = options.ResumeFrom.ReviewStatus
		reviewNote = options.ResumeFrom.ReviewNote
		reviewedAt = options.ResumeFrom.ReviewedAt
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
	run := RunResponse{ID: runID, ThreadID: threadID, CheckpointID: checkpointID(threadID, graphSteps), TemplateID: req.TemplateID, AgentID: req.AgentID, AgentPromptVersion: agent.PromptVersion, AgentPromptChecksum: agent.PromptChecksum, MCPServerIDs: req.MCPServerIDs, Status: runStatus, GraphSteps: graphSteps, Input: input, Canvas: req.Canvas, NodeResults: nodeResults, ReviewStatus: reviewStatus, ReviewNote: reviewNote, ReviewedAt: reviewedAt, StartedAt: now.Format(time.RFC3339), EndedAt: ended.Format(time.RFC3339)}
	finalEvent := "run.finished"
	if run.Status == "failed" {
		finalEvent = "run.failed"
	}
	events = append(events, map[string]any{"event": finalEvent, "data": map[string]string{"run_id": run.ID, "status": run.Status, "ended_at": run.EndedAt}})
	h.saveRun(run, &ended, events)
	return runExecution{Run: run, Events: events}, http.StatusOK, ""
}

func (h Handler) executeGraphNodeWithRetry(node graphNode, source string, index int, agent AgentBlueprint, serverIDs []string, trace []string, graphPlan []string, canvas map[string]any, retryLimit int, runID string, templateID string, events *[]map[string]any) NodeResult {
	attempts := maxInt(1, retryLimit+1)
	var result NodeResult
	for attempt := 1; attempt <= attempts; attempt++ {
		output, status := h.renderNode(node, source, index, agent, serverIDs, trace, graphPlan, canvas)
		now := time.Now().UTC().Format(time.RFC3339)
		result = NodeResult{NodeID: node.NodeID, Type: node.Type, Title: node.Title, GraphStep: node.GraphStep, Status: status, Output: output, StartedAt: now, EndedAt: now}
		if status != "failed" {
			if attempt > 1 {
				result.Output = fmt.Sprintf("Retried successfully on attempt %d.\n%s", attempt, result.Output)
			}
			return result
		}
		if attempt < attempts {
			*events = append(*events, map[string]any{"event": "node.retry", "data": map[string]string{"run_id": runID, "template_id": templateID, "node_id": node.NodeID, "graph_step": node.GraphStep, "attempt": fmt.Sprintf("%d", attempt), "retry_limit": fmt.Sprintf("%d", retryLimit), "reason": output}})
		}
	}
	if retryLimit > 0 {
		result.Output = fmt.Sprintf("Retry attempts exhausted after %d attempt(s).\n%s", attempts, result.Output)
	}
	return result
}

func (h Handler) renderNode(node graphNode, source string, index int, agent AgentBlueprint, serverIDs []string, trace []string, graphPlan []string, canvas map[string]any) (string, string) {
	canvasNote := canvasNodeNote(node.NodeID, canvas)
	if strings.TrimSpace(source) == "" && node.Type != "agent" {
		return strings.TrimSpace(strings.Join([]string{canvasNote, "等待输入内容。"}, "\n")), "success"
	}
	switch node.Type {
	case "agent":
		return strings.Join([]string{
			fmt.Sprintf("%s 已加载。模型建议：%s。", agent.Name, agent.ModelHint),
			fmt.Sprintf("Graph plan: %s", strings.Join(graphPlan, " -> ")),
			fmt.Sprintf("Graph trace: %s", strings.Join(trace, " -> ")),
			canvasNote,
			"密钥由后端环境变量托管。",
		}, "\n"), "success"
	case "mcp":
		if len(serverIDs) == 0 {
			return strings.TrimSpace(strings.Join([]string{canvasNote, "没有绑定 MCP Server。"}, "\n")), "success"
		}
		serverIndex := index - 1
		if serverIndex < 0 || serverIndex >= len(serverIDs) {
			serverIndex = 0
		}
		server, _ := ConfiguredMCPServerByID(serverIDs[serverIndex], h.DB, h.Settings)
		tool := toolForNode(node.NodeID, server)
		args := argumentsForTool(tool, source)
		result := h.callMCPTool(server, tool, args)
		status := "success"
		if stringValue(result["status"], "") == "failed" {
			status = "failed"
		}
		return strings.TrimSpace(strings.Join([]string{canvasNote, renderMCPOutput(server, tool, result)}, "\n")), status
	case "notes":
		return strings.TrimSpace(strings.Join([]string{canvasNote, truncate(source, 120)}, "\n")), "success"
	case "transform":
		return strings.TrimSpace(strings.Join([]string{canvasNote, fmt.Sprintf("标题：%s...\n要点：%s", truncate(source, 18), truncate(source, 180))}, "\n")), "success"
	case "chat":
		return strings.TrimSpace(strings.Join([]string{canvasNote, "我整理了一段内容，想同步给你：" + truncate(source, 160)}, "\n")), "success"
	case "ai":
		if !h.Settings.AgentSynthesisLive {
			return strings.TrimSpace(strings.Join([]string{canvasNote, "计划生成摘要", "Reason: AGENT_SYNTHESIS_LIVE is disabled.", "Draft: 基于内容生成：" + truncate(source, 180)}, "\n")), "success"
		}
		return strings.TrimSpace(strings.Join([]string{canvasNote, "模型生成摘要\n" + truncate(source, 600)}, "\n")), "success"
	default:
		return strings.TrimSpace(strings.Join([]string{canvasNote, fmt.Sprintf("%s 已处理：%s", node.Title, truncate(source, 180))}, "\n")), "success"
	}
}

func (h Handler) saveRun(run RunResponse, ended *time.Time, events []map[string]any) {
	graphSteps, _ := json.Marshal(run.GraphSteps)
	servers, _ := json.Marshal(run.MCPServerIDs)
	input, _ := json.Marshal(run.Input)
	canvas, _ := json.Marshal(run.Canvas)
	results, _ := json.Marshal(run.NodeResults)
	rawEvents, _ := json.Marshal(events)
	started, _ := time.Parse(time.RFC3339, run.StartedAt)
	record := models.WorkflowAgentRun{ID: run.ID, ThreadID: run.ThreadID, CheckpointID: run.CheckpointID, TemplateID: run.TemplateID, AgentID: run.AgentID, AgentPromptVersion: run.AgentPromptVersion, AgentPromptChecksum: run.AgentPromptChecksum, Status: run.Status, GraphStepsJSON: string(graphSteps), EventsJSON: string(rawEvents), MCPServerIDsJSON: string(servers), InputJSON: string(input), CanvasJSON: string(canvas), NodeResultsJSON: string(results), ReviewStatus: run.ReviewStatus, ReviewNote: run.ReviewNote, StartedAt: started, EndedAt: ended}
	h.DB.Save(&record)
	h.DB.Where("run_id = ?", run.ID).Delete(&models.WorkflowAgentCheckpoint{})
	for index, result := range run.NodeResults {
		if result.GraphStep == "" {
			continue
		}
		trace := traceForNodeResult(run.GraphSteps, index)
		state, _ := json.Marshal(map[string]any{"run_id": run.ID, "thread_id": run.ThreadID, "template_id": run.TemplateID, "agent_id": run.AgentID, "trace": trace, "status": result.Status, "resume_after": map[bool]string{true: result.GraphStep, false: ""}[result.Status != "failed"]})
		checkpointID := checkpointID(run.ThreadID, trace)
		nodeResult, _ := json.Marshal(result)
		checkpointEvents, _ := json.Marshal(eventsUntilStep(events, result.GraphStep))
		h.DB.Create(&models.WorkflowAgentCheckpoint{RunID: run.ID, ThreadID: run.ThreadID, CheckpointID: checkpointID, GraphStep: result.GraphStep, NodeID: result.NodeID, Status: result.Status, StateJSON: string(state), NodeResultJSON: string(nodeResult), EventsJSON: string(checkpointEvents)})
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

func buildGraphNodes(templateID string, canvas map[string]any) []graphNode {
	if isCanvasPayload(canvas) {
		return buildCanvasGraphNodes(canvas)
	}
	templateNodes := WorkflowTemplates[templateID]
	out := make([]graphNode, 0, len(templateNodes))
	for _, node := range templateNodes {
		out = append(out, graphNode{NodeID: nodeIDForGraphStep(node[0], node[1]), Type: node[1], Title: node[2], GraphStep: node[0]})
	}
	return out
}

func buildCanvasGraphNodes(canvas map[string]any) []graphNode {
	nodes := orderedCanvasNodes(canvasList(canvas["nodes"]), canvasList(canvas["connections"]))
	out := make([]graphNode, 0, len(nodes))
	for index, node := range nodes {
		nodeID := fmt.Sprintf("%v", node["id"])
		nodeType := stringValue(node["type"], "transform")
		title := stringValue(node["label"], "")
		if title == "" {
			title = nodeType
		}
		out = append(out, graphNode{NodeID: "canvas-" + nodeID, Type: workflowTypeForCanvasNode(nodeType), Title: title, GraphStep: fmt.Sprintf("canvas_%d_%s", index+1, slugGraphStep(nodeType))})
	}
	return out
}

func graphStepPlan(nodes []graphNode) []string {
	out := make([]string, 0, len(nodes)+1)
	for _, node := range nodes {
		out = append(out, node.GraphStep)
	}
	if len(out) > 0 {
		out = append(out, "persist")
	}
	return out
}

func nodeIDForGraphStep(step string, nodeType string) string {
	switch step {
	case "load_agent":
		return "agent"
	case "mcp_search":
		return "search"
	case "mcp_read":
		return "reader"
	case "mcp_repo_search":
		return "search_doc"
	case "mcp_repo_structure":
		return "repo_structure"
	case "mcp_read_file":
		return "read_file"
	case "read_input":
		return "source"
	case "synthesize":
		if nodeType == "chat" {
			return "chat"
		}
		return "summary"
	}
	return step
}

func isCanvasPayload(canvas map[string]any) bool {
	return len(canvasList(canvas["nodes"])) > 0
}

func orderedCanvasNodes(nodes []map[string]any, connections []map[string]any) []map[string]any {
	validNodes := []map[string]any{}
	for _, node := range nodes {
		if stringValue(node["id"], "") != "" {
			validNodes = append(validNodes, node)
		}
	}
	if len(validNodes) == 0 || len(connections) == 0 {
		return validNodes
	}
	nodeByID := map[string]map[string]any{}
	targets := map[string]bool{}
	for _, node := range validNodes {
		nodeByID[fmt.Sprintf("%v", node["id"])] = node
	}
	for _, connection := range connections {
		target := fmt.Sprintf("%v", connection["targetNodeId"])
		if target != "" && target != "<nil>" {
			targets[target] = true
		}
	}
	startIDs := []string{}
	for _, node := range validNodes {
		id := fmt.Sprintf("%v", node["id"])
		if !targets[id] {
			startIDs = append(startIDs, id)
		}
	}
	if len(startIDs) == 0 {
		startIDs = append(startIDs, fmt.Sprintf("%v", validNodes[0]["id"]))
	}
	ordered := []map[string]any{}
	visited := map[string]bool{}
	var walk func(string)
	walk = func(nodeID string) {
		node, ok := nodeByID[nodeID]
		if !ok || visited[nodeID] {
			return
		}
		visited[nodeID] = true
		ordered = append(ordered, node)
		for _, connection := range connections {
			if fmt.Sprintf("%v", connection["sourceNodeId"]) == nodeID {
				walk(fmt.Sprintf("%v", connection["targetNodeId"]))
			}
		}
	}
	for _, id := range startIDs {
		walk(id)
	}
	for _, node := range validNodes {
		walk(fmt.Sprintf("%v", node["id"]))
	}
	return ordered
}

func workflowTypeForCanvasNode(nodeType string) string {
	switch nodeType {
	case "trigger", "workflow-trigger":
		return "source"
	case "ai-chat":
		return "ai"
	case "image-gen", "image-studio":
		return "image"
	case "send-message", "chat-thread":
		return "chat"
	case "note-create", "notes-query":
		return "notes"
	case "agent-run":
		return "agent"
	case "http-request", "provider-models", "memory-map", "mcp-tool", "api-health":
		return "mcp"
	default:
		return "transform"
	}
}

func slugGraphStep(value string) string {
	lower := strings.ToLower(value)
	var builder strings.Builder
	lastUnderscore := false
	for _, r := range lower {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			builder.WriteRune(r)
			lastUnderscore = false
			continue
		}
		if !lastUnderscore {
			builder.WriteRune('_')
			lastUnderscore = true
		}
	}
	out := strings.Trim(builder.String(), "_")
	if out == "" {
		return "node"
	}
	return out
}

func canvasNodeNote(nodeID string, canvas map[string]any) string {
	nodes := canvasList(canvas["nodes"])
	if len(nodes) == 0 {
		return ""
	}
	connections := canvasList(canvas["connections"])
	canvasNodeID := strings.TrimPrefix(nodeID, "canvas-")
	for _, node := range nodes {
		if fmt.Sprintf("%v", node["id"]) != canvasNodeID {
			continue
		}
		incoming := 0
		outgoing := 0
		for _, connection := range connections {
			if fmt.Sprintf("%v", connection["targetNodeId"]) == canvasNodeID {
				incoming++
			}
			if fmt.Sprintf("%v", connection["sourceNodeId"]) == canvasNodeID {
				outgoing++
			}
		}
		configKeys := []string{}
		for key, value := range mapValue(node["config"]) {
			if strings.TrimSpace(fmt.Sprintf("%v", value)) != "" {
				configKeys = append(configKeys, key)
			}
		}
		label := stringValue(node["label"], nodeID)
		nodeType := stringValue(node["type"], "node")
		note := fmt.Sprintf("Canvas node: %s (%s) · %d 入 / %d 出", label, nodeType, incoming, outgoing)
		if len(configKeys) > 0 {
			note += " · 配置：" + strings.Join(configKeys, "、")
		}
		return note
	}
	return ""
}

func canvasList(value any) []map[string]any {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if row, ok := item.(map[string]any); ok {
			out = append(out, row)
		}
	}
	return out
}

func resumeStartIndex(nodes []graphNode, resumeAfter string) int {
	if resumeAfter == "" {
		return 0
	}
	for index, node := range nodes {
		if node.GraphStep == resumeAfter || node.NodeID == resumeAfter {
			return index + 1
		}
	}
	return 0
}

func resumedGraphSteps(run *RunResponse, resumeAfter string) []string {
	if run == nil || resumeAfter == "" {
		return []string{}
	}
	out := []string{}
	for _, result := range run.NodeResults {
		if result.Status == "failed" || result.GraphStep == "" {
			break
		}
		out = append(out, result.GraphStep)
		if result.GraphStep == resumeAfter {
			break
		}
	}
	return out
}

func resumedNodeResults(run *RunResponse, resumeAfter string) []NodeResult {
	if run == nil || resumeAfter == "" {
		return []NodeResult{}
	}
	out := []NodeResult{}
	for _, result := range run.NodeResults {
		if result.Status == "failed" {
			break
		}
		out = append(out, result)
		if result.GraphStep == resumeAfter {
			break
		}
	}
	return out
}

func lastSuccessfulGraphStep(run RunResponse) string {
	successful := ""
	for _, result := range run.NodeResults {
		if result.Status == "failed" {
			break
		}
		if result.GraphStep != "" {
			successful = result.GraphStep
		}
	}
	return successful
}

func nodeFinishedEvent(runID string, result NodeResult) map[string]any {
	return map[string]any{"event": "node.finished", "data": map[string]string{"run_id": runID, "node_id": result.NodeID, "graph_step": result.GraphStep, "type": result.Type, "title": result.Title, "status": result.Status, "output": result.Output, "started_at": result.StartedAt, "ended_at": result.EndedAt}}
}

func traceForNodeResult(graphSteps []string, resultIndex int) []string {
	limit := resultIndex + 1
	if limit > len(graphSteps) {
		limit = len(graphSteps)
	}
	trace := make([]string, limit)
	copy(trace, graphSteps[:limit])
	return trace
}

func eventsUntilStep(events []map[string]any, graphStep string) []map[string]any {
	out := []map[string]any{}
	for _, event := range events {
		out = append(out, event)
		if event["event"] == "node.finished" {
			data := stringMapValue(event["data"])
			if data["graph_step"] == graphStep {
				break
			}
		}
	}
	return out
}

func eventsFromRecord(record models.WorkflowAgentRun) []map[string]any {
	return eventsFromJSON(record.EventsJSON)
}

func eventsFromJSON(value string) []map[string]any {
	var events []map[string]any
	if err := json.Unmarshal([]byte(value), &events); err != nil {
		return []map[string]any{}
	}
	if events == nil {
		return []map[string]any{}
	}
	return events
}

func (h Handler) inspectRunCheckpoint(record models.WorkflowAgentRun) map[string]any {
	run := runFromRecord(record)
	events := eventsFromRecord(record)
	var checkpointRecords []models.WorkflowAgentCheckpoint
	h.DB.Where("run_id = ?", record.ID).Order("id ASC").Find(&checkpointRecords)
	resumeAfter := ""
	if run.Status == "failed" || run.Status == "canceled" {
		resumeAfter = lastSuccessfulGraphStep(run)
	}
	steps := []map[string]any{}
	completedSteps := []string{}
	failedStep := ""
	for _, checkpoint := range checkpointRecords {
		var node NodeResult
		_ = json.Unmarshal([]byte(checkpoint.NodeResultJSON), &node)
		if checkpoint.Status != "failed" {
			completedSteps = append(completedSteps, checkpoint.GraphStep)
		} else if failedStep == "" {
			failedStep = checkpoint.GraphStep
		}
		steps = append(steps, map[string]any{"graph_step": checkpoint.GraphStep, "node_id": checkpoint.NodeID, "title": node.Title, "status": checkpoint.Status, "started_at": node.StartedAt, "ended_at": node.EndedAt, "checkpoint_id": checkpoint.CheckpointID, "resumable": resumeAfter != "" && checkpoint.GraphStep == resumeAfter})
	}
	if len(checkpointRecords) == 0 {
		for index, result := range run.NodeResults {
			if result.Status != "failed" && result.GraphStep != "" {
				completedSteps = append(completedSteps, result.GraphStep)
			} else if result.Status == "failed" && failedStep == "" {
				failedStep = result.GraphStep
			}
			steps = append(steps, map[string]any{"graph_step": result.GraphStep, "node_id": result.NodeID, "title": result.Title, "status": result.Status, "started_at": result.StartedAt, "ended_at": result.EndedAt, "checkpoint_id": checkpointID(run.ThreadID, traceForNodeResult(run.GraphSteps, index)), "resumable": resumeAfter != "" && result.GraphStep == resumeAfter})
		}
	}
	lastEvent := ""
	if len(events) > 0 {
		lastEvent = stringValue(events[len(events)-1]["event"], "")
	}
	return map[string]any{"run_id": record.ID, "thread_id": record.ThreadID, "checkpoint_id": record.CheckpointID, "status": record.Status, "resume_after": resumeAfter, "resumable": resumeAfter != "", "graph_steps": run.GraphSteps, "completed_steps": completedSteps, "failed_step": failedStep, "event_count": len(events), "last_event": lastEvent, "steps": steps, "graph_runtime": graphRuntimeInspection(record.ThreadID, h.Settings)}
}

func graphRuntimeInspection(threadID string, settings config.Settings) map[string]any {
	requested := settings.AgentGraphRuntime
	if strings.TrimSpace(requested) == "" {
		requested = "auto"
	}
	return map[string]any{"runtime": "internal", "requested": requested, "available": true, "reason": "Go backend internal graph runtime", "thread_id": threadID, "checkpoint_count": 0, "write_count": 0, "latest_checkpoint_id": "", "latest_parent_checkpoint_id": "", "latest_step": "", "latest_source": "", "node_checkpoints": map[string]any{}, "inspectable": false}
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
	return map[string]any{"status": "success", "tool_name": toolName, "arguments": arguments, "result": redactAndTrim(result, h.Settings.MCPResultMaxChars)}
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
			result, err := unwrapJSONRPC([]byte(raw))
			if err != nil && strings.Contains(err.Error(), "non-JSON") {
				return nil, fmt.Errorf("MCP server returned invalid SSE JSON")
			}
			return result, err
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
	if result, ok := payload["result"]; ok {
		return map[string]any{"value": result}, nil
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

func redactAndTrim(payload map[string]any, maxChars int) map[string]any {
	if maxChars <= 0 {
		maxChars = 3000
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return map[string]any{"text": fmt.Sprintf("%v", payload)}
	}
	text := string(raw)
	for _, key := range []string{"authorization", "api_key", "token", "secret"} {
		text = strings.ReplaceAll(text, key, key[:2]+"***")
	}
	if len([]rune(text)) > maxChars {
		runes := []rune(text)
		text = string(runes[:maxChars]) + "... [trimmed]"
	}
	var out map[string]any
	if err := json.Unmarshal([]byte(text), &out); err == nil {
		return out
	}
	return map[string]any{"text": text}
}

func stringMapValue(value any) map[string]string {
	out := map[string]string{}
	switch row := value.(type) {
	case map[string]string:
		for key, val := range row {
			out[key] = val
		}
	case map[string]any:
		for key, val := range row {
			out[key] = fmt.Sprintf("%v", val)
		}
	}
	return out
}

func maxInt(a int, b int) int {
	if a > b {
		return a
	}
	return b
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
