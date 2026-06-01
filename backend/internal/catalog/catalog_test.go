package catalog

import "testing"

func TestGeminiEndpointMatchesPythonAdapterContract(t *testing.T) {
	model := "models/gemini-2.5-flash"
	cases := map[string]string{
		"https://generativelanguage.googleapis.com/v1beta":                                      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
		"https://generativelanguage.googleapis.com/v1beta/models":                               "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
		"https://generativelanguage.googleapis.com/v1beta/models/gemini-custom:generateContent": "https://generativelanguage.googleapis.com/v1beta/models/gemini-custom:generateContent",
	}
	for baseURL, expected := range cases {
		if got := geminiEndpoint(baseURL, model); got != expected {
			t.Fatalf("gemini endpoint mismatch for %s: got %s want %s", baseURL, got, expected)
		}
	}
}

func TestOpenAIContentArrayIsFlattenedToText(t *testing.T) {
	content := contentToText([]any{
		map[string]any{"type": "text", "text": "first"},
		map[string]any{"type": "input_image", "image_url": "ignored"},
		map[string]any{"type": "text", "text": "second"},
	})
	if content != "first\nsecond" {
		t.Fatalf("unexpected flattened content: %q", content)
	}
}

func TestChatProviderRequestUsesPythonSchemaGenerationDefaults(t *testing.T) {
	req := ChatCompletionRequest{
		Model:    "model-1",
		Messages: []map[string]any{{"role": "user", "content": "hello"}},
	}

	_, openAI, _ := buildChatProviderRequest("openai", req)
	if openAI["temperature"] != 0.7 || openAI["max_tokens"] != 1024 {
		t.Fatalf("openai defaults should match Python schema: %#v", openAI)
	}

	_, anthropic, _ := buildChatProviderRequest("anthropic", req)
	if anthropic["temperature"] != 0.7 || anthropic["max_tokens"] != 1024 {
		t.Fatalf("anthropic defaults should match Python schema: %#v", anthropic)
	}

	_, gemini, _ := buildChatProviderRequest("gemini", req)
	generation, ok := gemini["generationConfig"].(map[string]any)
	if !ok || generation["temperature"] != 0.7 || generation["maxOutputTokens"] != 1024 {
		t.Fatalf("gemini defaults should match Python schema: %#v", gemini)
	}
}

func TestAppendProviderPathMatchesPythonAdapter(t *testing.T) {
	cases := map[string]string{
		"https://api.example.com/v1":        "https://api.example.com/v1/models",
		"https://api.example.com/v1/":       "https://api.example.com/v1/models",
		"https://api.example.com/v1/models": "https://api.example.com/v1/models",
	}
	for baseURL, expected := range cases {
		if got := appendProviderPath(baseURL, "models"); got != expected {
			t.Fatalf("provider model path mismatch for %s: got %s want %s", baseURL, got, expected)
		}
	}
}

func TestParseChatContentMatchesPythonAdapterErrors(t *testing.T) {
	cases := []struct {
		provider string
		payload  map[string]any
		detail   string
	}{
		{"openai", map[string]any{}, "OpenAI-compatible response did not include choices[0].message.content."},
		{"anthropic", map[string]any{"content": map[string]any{}}, "Anthropic response did not include a valid content list."},
		{"gemini", map[string]any{}, "Gemini response did not include candidates[0].content.parts."},
	}
	for _, tc := range cases {
		if _, detail := parseChatContent(tc.provider, tc.payload); detail != tc.detail {
			t.Fatalf("%s malformed response detail mismatch: got %q want %q", tc.provider, detail, tc.detail)
		}
	}
}

func TestParseChatContentJoinsTextLikePythonAdapter(t *testing.T) {
	anthropic, detail := parseChatContent("anthropic", map[string]any{
		"content": []any{
			map[string]any{"type": "text", "text": "first"},
			map[string]any{"type": "tool_use", "text": "ignored"},
			map[string]any{"type": "text", "text": "second"},
		},
	})
	if detail != "" || anthropic != "first\nsecond" {
		t.Fatalf("anthropic content mismatch: %q detail=%q", anthropic, detail)
	}

	gemini, detail := parseChatContent("gemini", map[string]any{
		"candidates": []any{map[string]any{"content": map[string]any{"parts": []any{
			map[string]any{"text": "first"},
			map[string]any{"text": ""},
			map[string]any{"text": "second"},
		}}}},
	})
	if detail != "" || gemini != "first\nsecond" {
		t.Fatalf("gemini content mismatch: %q detail=%q", gemini, detail)
	}
}
