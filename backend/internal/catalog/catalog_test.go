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
