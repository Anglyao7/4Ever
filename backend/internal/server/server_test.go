package server_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"4ever/backend/internal/config"
	"4ever/backend/internal/database"
	"4ever/backend/internal/server"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func testRouter(t *testing.T) *httptest.Server {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "4ever-test.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.Migrate(db); err != nil {
		t.Fatal(err)
	}
	settings := config.Settings{
		AppName:             "4Ever Test",
		AppHost:             "127.0.0.1",
		AppPort:             7778,
		APIPrefix:           "/api",
		AITimeoutSeconds:    5,
		MCPTimeoutSeconds:   5,
		MCPResultMaxChars:   3000,
		AgentGraphRuntime:   "internal",
		MediaRoot:           t.TempDir(),
		AvatarUploadDirname: "avatars",
		DatabaseURL:         "sqlite:///test.db",
		CORSOrigins:         []string{"http://localhost:7777"},
	}
	return httptest.NewServer(server.New(settings, db))
}

func TestAuthTokenUsageAndAgentAdminFlow(t *testing.T) {
	ts := testRouter(t)
	defer ts.Close()

	auth := postJSON(t, ts.URL+"/api/auth/sign-up", map[string]any{
		"username": "adminuser", "email": "admin@example.com", "password": "password123", "display_name": "Admin",
	}, "")
	token := auth["token"].(string)

	overview := getJSON(t, ts.URL+"/api/admin/overview", token)
	if overview["user_count"].(float64) != 1 {
		t.Fatalf("expected one user, got %#v", overview)
	}

	keyOne := postJSON(t, ts.URL+"/api/token-usage/keys", map[string]any{"name": "MacBook"}, token)
	keyTwo := postJSON(t, ts.URL+"/api/token-usage/keys", map[string]any{"name": "iMac"}, token)
	rawOne := keyOne["raw_key"].(string)
	rawTwo := keyTwo["raw_key"].(string)
	keyTwoID := keyTwo["key"].(map[string]any)["id"].(string)

	now := time.Date(2026, 6, 1, 1, 0, 0, 0, time.UTC)
	ingestPayload := func(total int) map[string]any {
		return map[string]any{
			"schemaVersion": 2,
			"device":        map[string]any{"deviceId": "device-1", "hostname": "host"},
			"buckets": []map[string]any{{
				"source": "codex", "model": "gpt", "projectKey": "proj", "projectLabel": "Project",
				"bucketStart": now.Format(time.RFC3339), "inputTokens": total, "totalTokens": total,
			}},
			"sessions": []map[string]any{{
				"source": "codex", "projectKey": "proj", "projectLabel": "Project", "sessionHash": "s",
				"firstMessageAt": now.Format(time.RFC3339), "lastMessageAt": now.Add(time.Minute).Format(time.RFC3339),
				"activeSeconds": 30, "messageCount": 2, "inputTokens": total, "totalTokens": total,
			}},
		}
	}
	postJSON(t, ts.URL+"/api/token-usage/ingest", ingestPayload(100), rawOne)
	second := ingestPayload(50)
	second["device"] = map[string]any{"deviceId": "device-2", "hostname": "host2"}
	postJSON(t, ts.URL+"/api/token-usage/ingest", second, rawTwo)

	dashboard := getJSON(t, ts.URL+"/api/token-usage/dashboard?range=all", token)
	overviewUsage := dashboard["overview"].(map[string]any)
	if overviewUsage["total_tokens"].(float64) != 150 {
		t.Fatalf("expected total tokens, got %#v", overviewUsage)
	}
	heatmap := dashboard["heatmap"].([]any)
	if len(heatmap) == 0 || len(heatmap[0].(map[string]any)["key_breakdown"].([]any)) != 2 {
		t.Fatalf("expected two-key heatmap breakdown, got %#v", heatmap)
	}

	patchJSON(t, ts.URL+"/api/token-usage/keys/"+keyTwoID, map[string]any{"status": "disabled"}, token)
	resp := rawPost(t, ts.URL+"/api/token-usage/ingest", ingestPayload(10), rawTwo)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("disabled key should be unauthorized, got %d", resp.StatusCode)
	}

	tools := getJSON(t, ts.URL+"/api/agents/mcp/bigmodel-web-search/tools", "")
	if tools["status"] != "planned" {
		t.Fatalf("expected planned tools result, got %#v", tools)
	}
	disabled := patchJSON(t, ts.URL+"/api/admin/mcp-servers/bigmodel-web-search", map[string]any{"enabled": false}, token)
	if disabled["enabled"] != false {
		t.Fatalf("expected disabled server, got %#v", disabled)
	}
	resp = rawPost(t, ts.URL+"/api/agents/runs", map[string]any{
		"template_id": "agent-research-brief", "agent_id": "research-agent", "mcp_server_ids": []string{"bigmodel-web-search"}, "input": map[string]string{"topic": "go"},
	}, "")
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("disabled mcp run should be forbidden, got %d", resp.StatusCode)
	}
}

func TestAgentRunStreamUsesFrontendEventContract(t *testing.T) {
	ts := testRouter(t)
	defer ts.Close()

	resp := rawPost(t, ts.URL+"/api/agents/runs/stream", map[string]any{
		"template_id":    "note-message",
		"agent_id":       "workflow-agent",
		"mcp_server_ids": []string{},
		"input":          map[string]string{"note": "hello"},
		"source":         "manual",
	}, "")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("stream returned %d", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	text := string(body)
	for _, expected := range []string{"event: run.started", "event: node.finished", "event: run.finished"} {
		if !strings.Contains(text, expected) {
			t.Fatalf("missing %s in stream:\n%s", expected, text)
		}
	}
	if strings.Contains(text, "node.completed") || strings.Contains(text, "run.completed") {
		t.Fatalf("stream used obsolete event names:\n%s", text)
	}
}

func TestAgentCatalogReportsInternalRuntimeLikePythonBackend(t *testing.T) {
	ts := testRouter(t)
	defer ts.Close()

	catalog := getJSON(t, ts.URL+"/api/agents/catalog", "")
	runtime := catalog["graph_runtime"].(map[string]any)
	if runtime["runtime"] != "internal" || runtime["requested"] != "internal" || runtime["available"] != false {
		t.Fatalf("unexpected graph runtime status: %#v", runtime)
	}
}

func TestAgentRunCheckpointInspectionMatchesPythonContract(t *testing.T) {
	ts := testRouter(t)
	defer ts.Close()

	run := postJSON(t, ts.URL+"/api/agents/runs", map[string]any{
		"template_id":    "agent-research-brief",
		"agent_id":       "research-agent",
		"mcp_server_ids": []string{"bigmodel-web-search", "bigmodel-web-reader"},
		"input":          map[string]string{"topic": "测试持久化 MCP 工作流 https://example.com"},
		"source":         "test",
	}, "")
	if got := stringSlice(run["graph_steps"]); strings.Join(got, ",") != "load_agent,mcp_search,mcp_read,synthesize,persist" {
		t.Fatalf("unexpected graph steps: %#v", got)
	}
	results := run["node_results"].([]any)
	first := results[0].(map[string]any)
	if first["node_id"] != "agent" || first["graph_step"] != "load_agent" {
		t.Fatalf("node id and graph step should be distinct: %#v", first)
	}

	checkpoints := getJSON(t, ts.URL+"/api/agents/runs/"+run["id"].(string)+"/checkpoints", "")
	rows := checkpoints["checkpoints"].([]any)
	if got := checkpointSteps(rows); strings.Join(got, ",") != "load_agent,mcp_search,mcp_read,synthesize" {
		t.Fatalf("unexpected durable checkpoint steps: %#v", got)
	}
	state := rows[1].(map[string]any)["state"].(map[string]any)
	if got := stringSlice(state["trace"]); strings.Join(got, ",") != "load_agent,mcp_search" {
		t.Fatalf("checkpoint state should include trace, got %#v", state)
	}
	if rows[1].(map[string]any)["event_count"].(float64) < 1 {
		t.Fatalf("checkpoint should include event count: %#v", rows[1])
	}

	inspection := getJSON(t, ts.URL+"/api/agents/runs/"+run["id"].(string)+"/checkpoint", "")
	langgraph := inspection["langgraph"].(map[string]any)
	if langgraph["runtime"] != "internal" || langgraph["inspectable"] != false || langgraph["checkpoint_count"].(float64) != 0 {
		t.Fatalf("unexpected langgraph inspection: %#v", langgraph)
	}
	if inspection["last_event"] != "run.finished" {
		t.Fatalf("unexpected last event: %#v", inspection)
	}
}

func TestCanvasWorkflowUsesCanvasGraphNodes(t *testing.T) {
	ts := testRouter(t)
	defer ts.Close()

	canvas := map[string]any{
		"nodes": []map[string]any{
			{"id": "a", "type": "trigger", "label": "入口", "config": map[string]any{"topic": "go"}},
			{"id": "b", "type": "mcp-tool", "label": "工具", "config": map[string]any{"tool": "reader"}},
			{"id": "c", "type": "agent-run", "label": "Agent", "config": map[string]any{}},
		},
		"connections": []map[string]any{
			{"sourceNodeId": "a", "targetNodeId": "b"},
			{"sourceNodeId": "b", "targetNodeId": "c"},
		},
	}
	run := postJSON(t, ts.URL+"/api/agents/runs", map[string]any{
		"template_id":    "canvas-workflow",
		"agent_id":       "workflow-agent",
		"mcp_server_ids": []string{"bigmodel-web-reader"},
		"input":          map[string]string{"note": "https://example.com"},
		"source":         "canvas",
		"canvas":         canvas,
	}, "")
	if got := stringSlice(run["graph_steps"]); strings.Join(got, ",") != "canvas_1_trigger,canvas_2_mcp_tool,canvas_3_agent_run,persist" {
		t.Fatalf("unexpected canvas graph steps: %#v", got)
	}
	results := run["node_results"].([]any)
	if results[1].(map[string]any)["type"] != "mcp" || !strings.Contains(results[1].(map[string]any)["output"].(string), "Canvas node: 工具") {
		t.Fatalf("canvas mcp node was not rendered with canvas context: %#v", results[1])
	}
}

func getJSON(t *testing.T, url string, token string) map[string]any {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, url, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		t.Fatalf("GET %s returned %d", url, resp.StatusCode)
	}
	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	return out
}

func postJSON(t *testing.T, url string, payload map[string]any, token string) map[string]any {
	t.Helper()
	resp := rawPost(t, url, payload, token)
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		t.Fatalf("POST %s returned %d", url, resp.StatusCode)
	}
	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	return out
}

func patchJSON(t *testing.T, url string, payload map[string]any, token string) map[string]any {
	t.Helper()
	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest(http.MethodPatch, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		t.Fatalf("PATCH %s returned %d", url, resp.StatusCode)
	}
	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	return out
}

func rawPost(t *testing.T, url string, payload map[string]any, token string) *http.Response {
	t.Helper()
	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func stringSlice(value any) []string {
	items, _ := value.([]any)
	out := make([]string, 0, len(items))
	for _, item := range items {
		out = append(out, item.(string))
	}
	return out
}

func checkpointSteps(rows []any) []string {
	out := make([]string, 0, len(rows))
	for _, row := range rows {
		out = append(out, row.(map[string]any)["graph_step"].(string))
	}
	return out
}
