package images

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"4ever/backend/internal/httputil"
	"github.com/gin-gonic/gin"
)

type Handler struct{}

type GenerationRequest struct {
	Provider string  `json:"provider" binding:"required"`
	BaseURL  *string `json:"base_url"`
	APIKey   *string `json:"api_key"`
	Model    string  `json:"model" binding:"required"`
	Prompt   string  `json:"prompt" binding:"required"`
	Size     string  `json:"size" binding:"required"`
}

type GeneratedImage struct {
	URL           any `json:"url,omitempty"`
	B64JSON       any `json:"b64_json,omitempty"`
	RevisedPrompt any `json:"revised_prompt,omitempty"`
}

type GenerationResponse struct {
	Status  string           `json:"status"`
	Message string           `json:"message"`
	Images  []GeneratedImage `json:"images"`
	Prompt  string           `json:"prompt"`
}

func Register(group *gin.RouterGroup, h Handler) {
	r := group.Group("/images")
	r.POST("/generate", h.Generate)
}

func (Handler) Generate(c *gin.Context) {
	var req GenerationRequest
	if !httputil.BindJSON(c, &req) {
		return
	}
	provider := strings.ToLower(strings.TrimSpace(req.Provider))
	if provider != "openai" && provider != "custom" {
		httputil.Error(c, http.StatusNotImplemented, "Image provider '"+req.Provider+"' is not supported yet.")
		return
	}
	apiKey := ""
	if req.APIKey != nil {
		apiKey = strings.TrimSpace(*req.APIKey)
	}
	if apiKey == "" {
		httputil.Error(c, http.StatusBadRequest, "Image generation requires an API key.")
		return
	}
	baseURL := "https://api.openai.com/v1"
	if req.BaseURL != nil && strings.TrimSpace(*req.BaseURL) != "" {
		baseURL = strings.TrimSpace(*req.BaseURL)
	}
	payload := map[string]any{"model": req.Model, "prompt": req.Prompt, "size": req.Size}
	body, _ := json.Marshal(payload)
	httpReq, _ := http.NewRequest(http.MethodPost, strings.TrimRight(baseURL, "/")+"/images/generations", bytes.NewReader(body))
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	httpReq.Header.Set("Content-Type", "application/json")
	client := http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		httputil.Error(c, http.StatusBadGateway, "Image provider request failed: "+err.Error())
		return
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		httputil.Error(c, http.StatusBadGateway, providerErrorDetail(respBody, resp.Status))
		return
	}
	var data map[string]any
	if err := json.Unmarshal(respBody, &data); err != nil {
		httputil.Error(c, http.StatusBadGateway, "Image provider returned a non-JSON response.")
		return
	}
	items, _ := data["data"].([]any)
	images := []GeneratedImage{}
	for _, item := range items {
		row, ok := item.(map[string]any)
		if !ok {
			continue
		}
		images = append(images, GeneratedImage{URL: row["url"], B64JSON: row["b64_json"], RevisedPrompt: row["revised_prompt"]})
	}
	if len(images) == 0 {
		httputil.Error(c, http.StatusBadGateway, "Image provider returned no images.")
		return
	}
	suffix := "s"
	if len(images) == 1 {
		suffix = ""
	}
	c.JSON(http.StatusOK, GenerationResponse{Status: "success", Message: "Generated " + strconvItoa(len(images)) + " image" + suffix + ".", Images: images, Prompt: req.Prompt})
}

func providerErrorDetail(body []byte, status string) string {
	var payload map[string]any
	if json.Unmarshal(body, &payload) == nil {
		if errorValue, ok := payload["error"].(map[string]any); ok {
			if message, ok := errorValue["message"].(string); ok && message != "" {
				return message
			}
		}
		for _, key := range []string{"detail", "message"} {
			if message, ok := payload[key].(string); ok && message != "" {
				return message
			}
		}
	}
	if len(body) > 0 {
		return string(body)
	}
	return "Image provider returned HTTP " + status + "."
}

func strconvItoa(value int) string {
	if value == 0 {
		return "0"
	}
	out := ""
	for value > 0 {
		out = string(rune('0'+value%10)) + out
		value /= 10
	}
	return out
}
