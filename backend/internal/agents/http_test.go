package agents

import (
	"strings"
	"testing"
)

func TestRedactAndTrimMCPPayload(t *testing.T) {
	payload := map[string]any{
		"authorization": "Bearer live-key",
		"api_key":       "secret-key",
		"token":         "token-value",
		"secret":        "secret-value",
		"content":       strings.Repeat("x", 80),
	}

	result := redactAndTrim(payload, 60)
	text, ok := result["text"].(string)
	if !ok {
		t.Fatalf("expected trimmed payload to be returned as text, got %#v", result)
	}
	for _, forbidden := range []string{"authorization", "api_key", "token", "secret"} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("payload should redact %s, got %s", forbidden, text)
		}
	}
	if !strings.Contains(text, "... [trimmed]") {
		t.Fatalf("payload should be trimmed, got %s", text)
	}
}

func TestParseMCPPayloadSupportsSSEAndScalarJSONRPCResults(t *testing.T) {
	result, err := parseMCPPayload("text/event-stream", []byte("event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":\"tools/list\",\"result\":{\"tools\":[{\"name\":\"webSearchPrime\"}]}}\n\n"))
	if err != nil {
		t.Fatal(err)
	}
	tools := result["tools"].([]any)
	if tools[0].(map[string]any)["name"] != "webSearchPrime" {
		t.Fatalf("unexpected tools result: %#v", result)
	}

	scalar, err := parseMCPPayload("application/json", []byte(`{"jsonrpc":"2.0","id":"x","result":"ok"}`))
	if err != nil {
		t.Fatal(err)
	}
	if scalar["value"] != "ok" {
		t.Fatalf("scalar JSON-RPC result should be wrapped, got %#v", scalar)
	}
}

func TestParseMCPPayloadReportsInvalidSSEJSON(t *testing.T) {
	_, err := parseMCPPayload("text/event-stream", []byte("event: message\ndata: not-json\n\n"))
	if err == nil || !strings.Contains(err.Error(), "invalid SSE JSON") {
		t.Fatalf("expected invalid SSE JSON error, got %v", err)
	}
}
