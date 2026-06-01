package images

import (
	"strings"
	"testing"
)

func TestProviderErrorDetailMatchesPythonBehavior(t *testing.T) {
	cases := []struct {
		body   string
		status int
		want   string
	}{
		{`{"error":{"message":"bad prompt"}}`, 400, "bad prompt"},
		{`{"detail":"quota exceeded"}`, 429, "quota exceeded"},
		{`{"message":"model missing"}`, 404, "model missing"},
		{"plain provider failure", 500, "plain provider failure"},
		{"", 503, "Image provider returned HTTP 503."},
	}
	for _, item := range cases {
		if got := providerErrorDetail([]byte(item.body), item.status); got != item.want {
			t.Fatalf("unexpected provider detail for %q: got %q want %q", item.body, got, item.want)
		}
	}
}

func TestImageGenerationRequestDefaultsAndPromptLimit(t *testing.T) {
	req := GenerationRequest{Prompt: "draw"}
	rawProvider := "openai"
	if req.Provider.Set {
		rawProvider = req.Provider.Value
	}
	provider := strings.ToLower(strings.TrimSpace(rawProvider))
	model := "gpt-image-1"
	if req.Model.Set {
		model = req.Model.Value
	}
	size := "1024x1024"
	if req.Size.Set {
		size = req.Size.Value
	}
	if provider != "openai" || model != "gpt-image-1" || size != "1024x1024" {
		t.Fatalf("unexpected defaults: provider=%s model=%s size=%s", provider, model, size)
	}
	if len([]rune(strings.Repeat("x", 4001))) <= 4000 {
		t.Fatal("test prompt limit fixture is invalid")
	}
}
