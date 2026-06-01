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
