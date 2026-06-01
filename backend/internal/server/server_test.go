package server_test

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
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

func TestSignUpDisplayNameDefaultMatchesPythonRoute(t *testing.T) {
	ts := testRouter(t)
	defer ts.Close()

	auth := postJSON(t, ts.URL+"/api/auth/sign-up", map[string]any{
		"username": "namedefault", "email": "namedefault@example.com", "password": "password123", "display_name": "   ",
	}, "")
	user := auth["user"].(map[string]any)
	if user["display_name"] != "namedefault" {
		t.Fatalf("blank display_name should fall back to username: %#v", user)
	}
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

	defaultKey := postJSON(t, ts.URL+"/api/token-usage/keys", map[string]any{}, token)
	if defaultKey["key"].(map[string]any)["name"] != "本机 CLI" || defaultKey["raw_key"] == "" {
		t.Fatalf("default token usage key name should match Python schema: %#v", defaultKey)
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
				"bucketStart": now.Format(time.RFC3339), "hostname": "", "inputTokens": total, "totalTokens": total,
			}},
			"sessions": []map[string]any{{
				"source": "codex", "projectKey": "proj", "projectLabel": "Project", "sessionHash": "s",
				"hostname": "", "firstMessageAt": now.Format(time.RFC3339), "lastMessageAt": now.Add(time.Minute).Format(time.RFC3339),
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
	devices := dashboard["devices"].([]any)
	devicesByID := map[string]map[string]any{}
	for _, item := range devices {
		device := item.(map[string]any)
		devicesByID[device["device_id"].(string)] = device
	}
	if devicesByID["device-1"]["hostname"] != "host" {
		t.Fatalf("device hostname should use ingest device hostname: %#v", devicesByID["device-1"])
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

func TestTokenUsageIngestValidationMatchesPythonSchema(t *testing.T) {
	ts := testRouter(t)
	defer ts.Close()

	auth := postJSON(t, ts.URL+"/api/auth/sign-up", map[string]any{
		"username": "usagevalidator", "email": "usagevalidator@example.com", "password": "password123", "display_name": "Usage Validator",
	}, "")
	token := auth["token"].(string)
	key := postJSON(t, ts.URL+"/api/token-usage/keys", map[string]any{"name": "Validator"}, token)
	rawKey := key["raw_key"].(string)
	now := time.Date(2026, 6, 1, 1, 0, 0, 0, time.UTC).Format(time.RFC3339)

	base := func() map[string]any {
		return map[string]any{
			"schemaVersion": 2,
			"device":        map[string]any{"deviceId": "validator-device", "hostname": "validator-host"},
			"buckets": []map[string]any{{
				"source": "codex", "bucketStart": now, "inputTokens": 1,
			}},
			"sessions": []map[string]any{{
				"source": "codex", "sessionHash": "session", "firstMessageAt": now, "lastMessageAt": now, "activeSeconds": 1,
			}},
		}
	}

	cases := []map[string]any{
		func() map[string]any { payload := base(); payload["schemaVersion"] = 1; return payload }(),
		func() map[string]any {
			payload := base()
			payload["buckets"] = []map[string]any{{"source": "codex", "bucketStart": now, "inputTokens": -1}}
			return payload
		}(),
		func() map[string]any {
			payload := base()
			payload["sessions"] = []map[string]any{{"source": "codex", "sessionHash": "session", "firstMessageAt": now, "lastMessageAt": now, "activeSeconds": -1}}
			return payload
		}(),
		func() map[string]any {
			payload := base()
			payload["buckets"] = make([]map[string]any, 501)
			return payload
		}(),
		func() map[string]any {
			payload := base()
			payload["sessions"] = make([]map[string]any, 1001)
			return payload
		}(),
		func() map[string]any {
			payload := base()
			payload["device"] = map[string]any{"deviceId": "validator-device", "hostname": strings.Repeat("x", 161)}
			return payload
		}(),
		func() map[string]any {
			payload := base()
			payload["buckets"] = []map[string]any{{"source": "codex", "bucketStart": now, "model": strings.Repeat("x", 161)}}
			return payload
		}(),
		func() map[string]any {
			payload := base()
			payload["buckets"] = []map[string]any{{"source": "codex", "bucketStart": now, "projectKey": strings.Repeat("x", 161)}}
			return payload
		}(),
		func() map[string]any {
			payload := base()
			payload["buckets"] = []map[string]any{{"source": "codex", "bucketStart": now, "projectLabel": strings.Repeat("x", 241)}}
			return payload
		}(),
		func() map[string]any {
			payload := base()
			payload["buckets"] = []map[string]any{{"source": "codex", "bucketStart": now, "deviceId": strings.Repeat("x", 121)}}
			return payload
		}(),
		func() map[string]any {
			payload := base()
			payload["buckets"] = []map[string]any{{"source": "codex", "bucketStart": now, "hostname": strings.Repeat("x", 161)}}
			return payload
		}(),
		func() map[string]any {
			payload := base()
			payload["sessions"] = []map[string]any{{"source": "codex", "sessionHash": "session", "firstMessageAt": now, "lastMessageAt": now, "projectKey": strings.Repeat("x", 161)}}
			return payload
		}(),
		func() map[string]any {
			payload := base()
			payload["sessions"] = []map[string]any{{"source": "codex", "sessionHash": "session", "firstMessageAt": now, "lastMessageAt": now, "projectLabel": strings.Repeat("x", 241)}}
			return payload
		}(),
		func() map[string]any {
			payload := base()
			payload["sessions"] = []map[string]any{{"source": "codex", "sessionHash": "session", "firstMessageAt": now, "lastMessageAt": now, "deviceId": strings.Repeat("x", 121)}}
			return payload
		}(),
		func() map[string]any {
			payload := base()
			payload["sessions"] = []map[string]any{{"source": "codex", "sessionHash": "session", "firstMessageAt": now, "lastMessageAt": now, "hostname": strings.Repeat("x", 161)}}
			return payload
		}(),
		func() map[string]any {
			payload := base()
			payload["sessions"] = []map[string]any{{"source": "codex", "sessionHash": "session", "firstMessageAt": now, "lastMessageAt": now, "primaryModel": strings.Repeat("x", 161)}}
			return payload
		}(),
	}
	for _, payload := range cases {
		resp := rawPost(t, ts.URL+"/api/token-usage/ingest", payload, rawKey)
		if resp.StatusCode != http.StatusUnprocessableEntity {
			t.Fatalf("invalid ingest payload should return 422, got %d for %#v", resp.StatusCode, payload)
		}
		_ = resp.Body.Close()
	}

	dashboard := getJSON(t, ts.URL+"/api/token-usage/dashboard?range=all", token)
	if dashboard["overview"].(map[string]any)["total_tokens"].(float64) != 0 {
		t.Fatalf("invalid ingest payloads should not persist usage: %#v", dashboard["overview"])
	}
}

func TestTencentCitySearchQueryValidationMatchesPythonRoute(t *testing.T) {
	ts := testRouter(t)
	defer ts.Close()

	missing := rawGet(t, ts.URL+"/api/maps/tencent/city-search", "")
	if missing.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("missing q should return 422 before map key check, got %d", missing.StatusCode)
	}
	_ = missing.Body.Close()

	tooLong := rawGet(t, ts.URL+"/api/maps/tencent/city-search?q="+strings.Repeat("x", 81), "")
	if tooLong.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("too-long q should return 422 before map key check, got %d", tooLong.StatusCode)
	}
	_ = tooLong.Body.Close()

	blank := getJSON(t, ts.URL+"/api/maps/tencent/city-search?q=%20%20", "")
	if len(blank["results"].([]any)) != 0 {
		t.Fatalf("blank q should return empty results: %#v", blank)
	}
}

func TestQueryValidationMatchesPythonRoutes(t *testing.T) {
	ts := testRouter(t)
	defer ts.Close()

	auth := postJSON(t, ts.URL+"/api/auth/sign-up", map[string]any{
		"username": "queryadmin", "email": "queryadmin@example.com", "password": "password123", "display_name": "Query Admin",
	}, "")
	token := auth["token"].(string)

	resp := rawGet(t, ts.URL+"/api/auth/users/search?q="+strings.Repeat("x", 161), token)
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("too-long auth search q should return 422, got %d", resp.StatusCode)
	}
	_ = resp.Body.Close()
	resp = rawGet(t, ts.URL+"/api/auth/users/search?q="+strings.Repeat("x", 161), "")
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("too-long auth search q should return 422 before auth, got %d", resp.StatusCode)
	}
	_ = resp.Body.Close()

	for _, url := range []string{
		ts.URL + "/api/token-usage/dashboard?range=bad",
		ts.URL + "/api/token-usage/leaderboard?range=bad",
	} {
		resp = rawGet(t, url, token)
		if resp.StatusCode != http.StatusUnprocessableEntity {
			t.Fatalf("invalid token usage range should return 422 for %s, got %d", url, resp.StatusCode)
		}
		_ = resp.Body.Close()
		resp = rawGet(t, url, "")
		if resp.StatusCode != http.StatusUnprocessableEntity {
			t.Fatalf("invalid token usage range should return 422 before auth for %s, got %d", url, resp.StatusCode)
		}
		_ = resp.Body.Close()
	}
}

func TestAdminBooleanUpdatesRequireExplicitFieldsLikePythonSchema(t *testing.T) {
	ts := testRouter(t)
	defer ts.Close()

	auth := postJSON(t, ts.URL+"/api/auth/sign-up", map[string]any{
		"username": "booladmin", "email": "booladmin@example.com", "password": "password123", "display_name": "Bool Admin",
	}, "")
	token := auth["token"].(string)
	userID := auth["user"].(map[string]any)["id"].(string)
	getJSON(t, ts.URL+"/api/admin/overview", token)

	cases := []string{
		ts.URL + "/api/admin/users/" + userID + "/risk",
		ts.URL + "/api/admin/modules/chat",
		ts.URL + "/api/admin/mcp-servers/bigmodel-web-search",
	}
	for _, url := range cases {
		resp := rawPatch(t, url, map[string]any{}, token)
		if resp.StatusCode != http.StatusUnprocessableEntity {
			t.Fatalf("empty bool update should return 422 for %s, got %d", url, resp.StatusCode)
		}
		_ = resp.Body.Close()
	}
}

func TestAdminRequestLengthValidationMatchesPythonSchema(t *testing.T) {
	ts := testRouter(t)
	defer ts.Close()

	auth := postJSON(t, ts.URL+"/api/auth/sign-up", map[string]any{
		"username": "lengthadmin", "email": "lengthadmin@example.com", "password": "password123", "display_name": "Length Admin",
	}, "")
	token := auth["token"].(string)
	userID := auth["user"].(map[string]any)["id"].(string)
	getJSON(t, ts.URL+"/api/admin/overview", token)

	cases := []struct {
		url     string
		payload map[string]any
		field   string
	}{
		{
			url:     ts.URL + "/api/admin/users/" + userID + "/role",
			payload: map[string]any{"role": strings.Repeat("x", 41)},
			field:   "Role",
		},
		{
			url:     ts.URL + "/api/admin/users/" + userID + "/risk",
			payload: map[string]any{"risk_flagged": true, "note": strings.Repeat("x", 241)},
			field:   "Note",
		},
		{
			url: ts.URL + "/api/admin/agents/research-agent",
			payload: map[string]any{
				"prompt_version": strings.Repeat("x", 81),
				"system_prompt":  strings.Repeat("p", 20),
			},
			field: "PromptVersion",
		},
		{
			url: ts.URL + "/api/admin/agents/research-agent",
			payload: map[string]any{
				"prompt_version": "v2",
				"system_prompt":  strings.Repeat("p", 6001),
			},
			field: "SystemPrompt",
		},
	}
	for _, tc := range cases {
		resp := rawPatch(t, tc.url, tc.payload, token)
		if resp.StatusCode != http.StatusUnprocessableEntity {
			t.Fatalf("too-long admin payload should return 422 for %s, got %d", tc.field, resp.StatusCode)
		}
		body, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if !strings.Contains(string(body), tc.field) || !strings.Contains(string(body), "'max'") {
			t.Fatalf("expected max validation error for %s, got %s", tc.field, string(body))
		}
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

func TestAgentQueryAndToolValidationMatchesPythonSchema(t *testing.T) {
	ts := testRouter(t)
	defer ts.Close()

	for _, query := range []string{"0", "101", "bad"} {
		resp := rawGet(t, ts.URL+"/api/agents/runs?limit="+query, "")
		if resp.StatusCode != http.StatusUnprocessableEntity {
			t.Fatalf("invalid limit %q should return 422, got %d", query, resp.StatusCode)
		}
		_ = resp.Body.Close()
	}

	resp := rawPost(t, ts.URL+"/api/agents/mcp/bigmodel-web-search/tools/call", map[string]any{
		"tool_name": strings.Repeat("x", 121),
	}, "")
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("too-long tool_name should return 422, got %d", resp.StatusCode)
	}
	_ = resp.Body.Close()

	toolCall := postJSON(t, ts.URL+"/api/agents/mcp/bigmodel-web-search/tools/call", map[string]any{
		"tool_name": "webSearchPrime",
	}, "")
	if arguments, ok := toolCall["arguments"].(map[string]any); !ok || len(arguments) != 0 {
		t.Fatalf("omitted mcp arguments should default to empty object: %#v", toolCall)
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

func TestAgentRunValidationReviewCancelAndResumeContracts(t *testing.T) {
	ts := testRouter(t)
	defer ts.Close()

	invalid := rawPost(t, ts.URL+"/api/agents/runs", map[string]any{
		"template_id":    "note-copy",
		"agent_id":       "research-agent",
		"mcp_server_ids": []string{},
		"input":          map[string]string{"note": "not allowed"},
	}, "")
	if invalid.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid template/agent pair should be rejected, got %d", invalid.StatusCode)
	}
	listing := getJSON(t, ts.URL+"/api/agents/runs?limit=10", "")
	if len(listing["runs"].([]any)) != 0 {
		t.Fatalf("validation errors must not persist runs: %#v", listing)
	}

	reviewable := postJSON(t, ts.URL+"/api/agents/runs", map[string]any{
		"template_id":    "note-copy",
		"agent_id":       "workflow-agent",
		"mcp_server_ids": []string{},
		"input":          map[string]string{"note": "review me"},
		"source":         "test",
	}, "")
	if reviewable["review_status"] != "pending" {
		t.Fatalf("note-copy should require review: %#v", reviewable)
	}
	reviewed := patchJSON(t, ts.URL+"/api/agents/runs/"+reviewable["id"].(string)+"/review", map[string]any{"status": "approved", "note": "looks good"}, "")
	if reviewed["review_status"] != "approved" || reviewed["review_note"] != "looks good" || reviewed["reviewed_at"] == "" {
		t.Fatalf("review update did not persist: %#v", reviewed)
	}

	readOnly := postJSON(t, ts.URL+"/api/agents/runs", map[string]any{
		"template_id":    "agent-research-brief",
		"agent_id":       "research-agent",
		"mcp_server_ids": []string{},
		"input":          map[string]string{"topic": "read only"},
		"source":         "test",
	}, "")
	if readOnly["review_status"] != "not_required" {
		t.Fatalf("research brief should be read-only/no review: %#v", readOnly)
	}
	readOnlyReview := rawPatch(t, ts.URL+"/api/agents/runs/"+readOnly["id"].(string)+"/review", map[string]any{"status": "approved"}, "")
	if readOnlyReview.StatusCode != http.StatusBadRequest {
		t.Fatalf("read-only review should be rejected, got %d", readOnlyReview.StatusCode)
	}

	missingCancel := rawPost(t, ts.URL+"/api/agents/runs/missing-run/cancel", map[string]any{}, "")
	if missingCancel.StatusCode != http.StatusNotFound {
		t.Fatalf("missing cancel should return 404, got %d", missingCancel.StatusCode)
	}
	finishedCancel := rawPost(t, ts.URL+"/api/agents/runs/"+reviewable["id"].(string)+"/cancel", map[string]any{}, "")
	if finishedCancel.StatusCode != http.StatusConflict {
		t.Fatalf("finished cancel should return 409, got %d", finishedCancel.StatusCode)
	}
	finishedResume := rawPost(t, ts.URL+"/api/agents/runs/"+reviewable["id"].(string)+"/resume", map[string]any{}, "")
	if finishedResume.StatusCode != http.StatusConflict {
		t.Fatalf("finished resume should return 409, got %d", finishedResume.StatusCode)
	}
}

func TestDirectMessageValidationMatchesPythonSchema(t *testing.T) {
	ts := testRouter(t)
	defer ts.Close()

	alice := postJSON(t, ts.URL+"/api/auth/sign-up", map[string]any{
		"username": "alice", "email": "alice@example.com", "password": "password123", "display_name": "Alice",
	}, "")
	bob := postJSON(t, ts.URL+"/api/auth/sign-up", map[string]any{
		"username": "bob", "email": "bob@example.com", "password": "password123", "display_name": "Bob",
	}, "")
	aliceToken := alice["token"].(string)
	bobToken := bob["token"].(string)
	aliceID := alice["user"].(map[string]any)["id"].(string)
	bobID := bob["user"].(map[string]any)["id"].(string)

	request := postJSON(t, ts.URL+"/api/chat/friends/request/"+bobID, map[string]any{}, aliceToken)
	accepted := postJSON(t, ts.URL+"/api/chat/friends/requests/"+jsonID(request["id"])+"/accept", map[string]any{}, bobToken)
	if accepted["status"] != "accepted" {
		t.Fatalf("friend request should be accepted: %#v", accepted)
	}

	empty := rawPost(t, ts.URL+"/api/chat/direct/"+bobID, map[string]any{"content": "   ", "attachments": []any{}}, aliceToken)
	if empty.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("empty direct message should be rejected, got %d", empty.StatusCode)
	}
	tooLong := rawPost(t, ts.URL+"/api/chat/direct/"+bobID, map[string]any{"content": strings.Repeat("x", 20001)}, aliceToken)
	if tooLong.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("too-long direct message should be rejected, got %d", tooLong.StatusCode)
	}
	badAttachment := rawPost(t, ts.URL+"/api/chat/direct/"+bobID, map[string]any{"attachments": []map[string]any{{"id": "a1", "name": "bad", "type": "text/plain", "kind": "file", "size": -1}}}, aliceToken)
	if badAttachment.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("negative attachment size should be rejected, got %d", badAttachment.StatusCode)
	}
	missingAttachmentField := rawPost(t, ts.URL+"/api/chat/direct/"+bobID, map[string]any{"attachments": []map[string]any{{"id": "a1", "name": "bad", "type": "text/plain", "size": 1}}}, aliceToken)
	if missingAttachmentField.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("missing attachment kind should be rejected, got %d", missingAttachmentField.StatusCode)
	}
	emptyAttachmentFields := postJSON(t, ts.URL+"/api/chat/direct/"+bobID, map[string]any{"attachments": []map[string]any{{"id": "", "name": "", "type": "", "kind": "", "size": 1}}}, aliceToken)
	if len(emptyAttachmentFields["attachments"].([]any)) != 1 {
		t.Fatalf("present empty attachment string fields should match Python schema: %#v", emptyAttachmentFields)
	}

	attachments := []map[string]any{}
	for index := 0; index < 5; index++ {
		attachments = append(attachments, map[string]any{"id": "a", "name": "file", "type": "text/plain", "kind": "file", "size": 1})
	}
	sent := postJSON(t, ts.URL+"/api/chat/direct/"+bobID, map[string]any{"attachments": attachments}, aliceToken)
	if len(sent["attachments"].([]any)) != 4 {
		t.Fatalf("attachments should be capped at four: %#v", sent)
	}
	messages := getJSONList(t, ts.URL+"/api/chat/direct/"+aliceID, bobToken)
	if len(messages) != 2 || messages[0].(map[string]any)["sender_id"] != aliceID || messages[1].(map[string]any)["sender_id"] != aliceID {
		t.Fatalf("bob should see alice's message: %#v", messages)
	}
}

func TestAvatarUploadSniffsImageContentLikePythonBackend(t *testing.T) {
	ts := testRouter(t)
	defer ts.Close()

	auth := postJSON(t, ts.URL+"/api/auth/sign-up", map[string]any{
		"username": "avataruser", "email": "avatar@example.com", "password": "password123", "display_name": "Avatar",
	}, "")
	token := auth["token"].(string)

	invalid := rawPost(t, ts.URL+"/api/auth/me/avatar", map[string]any{
		"filename":     "avatar.jpg",
		"content_type": "image/jpeg",
		"data_base64":  base64.StdEncoding.EncodeToString([]byte("not an image")),
	}, token)
	if invalid.StatusCode != http.StatusUnsupportedMediaType {
		t.Fatalf("fake jpeg content should be rejected, got %d", invalid.StatusCode)
	}
	_ = invalid.Body.Close()

	invalidBase64 := rawPost(t, ts.URL+"/api/auth/me/avatar", map[string]any{
		"filename":     "avatar.jpg",
		"content_type": "image/jpeg",
		"data_base64":  "not-valid-base64!",
	}, token)
	if invalidBase64.StatusCode != http.StatusUnprocessableEntity || errorDetail(t, invalidBase64) != "Avatar data is invalid." {
		t.Fatalf("invalid base64 should match Python error, got %d", invalidBase64.StatusCode)
	}

	base64WithNewline := rawPost(t, ts.URL+"/api/auth/me/avatar", map[string]any{
		"filename":     "avatar.jpg",
		"content_type": "image/jpeg",
		"data_base64":  base64.StdEncoding.EncodeToString([]byte("not an image")) + "\n",
	}, token)
	if base64WithNewline.StatusCode != http.StatusUnprocessableEntity || errorDetail(t, base64WithNewline) != "Avatar data is invalid." {
		t.Fatalf("base64 with newline should match Python strict validation, got %d", base64WithNewline.StatusCode)
	}

	validPNG := "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
	updated := postJSON(t, ts.URL+"/api/auth/me/avatar", map[string]any{
		"filename":     "avatar.png",
		"content_type": "image/png",
		"data_base64":  validPNG,
	}, token)
	if updated["avatar_url"] == nil || !strings.Contains(updated["avatar_url"].(string), "/api/media/avatars/") {
		t.Fatalf("valid png avatar should be saved: %#v", updated)
	}
}

func TestImageGenerationUsesPythonSchemaDefaults(t *testing.T) {
	var providerPayload map[string]any
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/images/generations" {
			t.Fatalf("unexpected image path: %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer test-image-key" {
			t.Fatalf("unexpected auth header: %s", r.Header.Get("Authorization"))
		}
		if err := json.NewDecoder(r.Body).Decode(&providerPayload); err != nil {
			t.Fatal(err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"url":"https://example.com/image.png","revised_prompt":"draw"}]}`))
	}))
	defer provider.Close()
	ts := testRouter(t)
	defer ts.Close()

	response := postJSON(t, ts.URL+"/api/images/generate", map[string]any{
		"prompt":   "draw",
		"api_key":  "test-image-key",
		"base_url": provider.URL,
	}, "")
	if response["status"] != "success" || response["message"] != "Generated 1 image." {
		t.Fatalf("unexpected image response: %#v", response)
	}
	if providerPayload["model"] != "gpt-image-1" || providerPayload["size"] != "1024x1024" || providerPayload["prompt"] != "draw" {
		t.Fatalf("image defaults were not sent to provider: %#v", providerPayload)
	}
	tooLong := rawPost(t, ts.URL+"/api/images/generate", map[string]any{
		"prompt":  strings.Repeat("x", 4001),
		"api_key": "test-image-key",
	}, "")
	if tooLong.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("too-long prompt should be rejected, got %d", tooLong.StatusCode)
	}
}

func TestChatRequestValidationMatchesPythonSchema(t *testing.T) {
	ts := testRouter(t)
	defer ts.Close()

	cases := []map[string]any{
		{"provider": "bad", "model": "gpt", "messages": []map[string]string{{"role": "user", "content": "hi"}}},
		{"provider": "openai", "model": "gpt", "messages": []any{}},
		{"provider": "openai", "model": "gpt", "messages": []map[string]string{{"role": "user", "content": ""}}},
		{"provider": "openai", "model": "gpt", "messages": []map[string]string{{"role": "tool", "content": "hi"}}},
		{"provider": "openai", "model": "gpt", "messages": []map[string]any{{"role": 123, "content": "hi"}}},
		{"provider": "openai", "model": "gpt", "messages": []map[string]any{{"role": "user", "content": 123}}},
		{"provider": "openai", "model": "gpt", "messages": []map[string]string{{"role": "user", "content": "hi"}}, "temperature": 2.1},
		{"provider": "openai", "model": "gpt", "messages": []map[string]string{{"role": "user", "content": "hi"}}, "max_tokens": 0},
	}
	for _, payload := range cases {
		resp := rawPost(t, ts.URL+"/api/chat", payload, "")
		if resp.StatusCode != http.StatusUnprocessableEntity {
			t.Fatalf("payload should be rejected with 422, got %d for %#v", resp.StatusCode, payload)
		}
		_ = resp.Body.Close()
	}
}

func TestProviderConnectionRejectsUnsupportedProviderLikePythonSchema(t *testing.T) {
	ts := testRouter(t)
	defer ts.Close()

	resp := rawPost(t, ts.URL+"/api/catalog/provider/models", map[string]any{
		"provider": "bad",
	}, "")
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("unsupported provider should be rejected with 422, got %d", resp.StatusCode)
	}
	_ = resp.Body.Close()
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

func getJSONList(t *testing.T, url string, token string) []any {
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
	var out []any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	return out
}

func rawGet(t *testing.T, url string, token string) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, url, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
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

func errorDetail(t *testing.T, resp *http.Response) string {
	t.Helper()
	defer resp.Body.Close()
	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	detail, _ := body["detail"].(string)
	return detail
}

func rawPatch(t *testing.T, url string, payload map[string]any, token string) *http.Response {
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

func jsonID(value any) string {
	return fmt.Sprintf("%.0f", value.(float64))
}
