package server_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
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
