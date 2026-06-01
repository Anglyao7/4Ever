package catalog

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"4ever/backend/internal/config"
	"4ever/backend/internal/httputil"
	"github.com/gin-gonic/gin"
)

type Handler struct {
	Settings config.Settings
}

type ProviderInfo struct {
	ID             string `json:"id"`
	Label          string `json:"label"`
	DefaultBaseURL string `json:"default_base_url"`
	DefaultModel   string `json:"default_model"`
	AuthLabel      string `json:"auth_label"`
	Endpoint       string `json:"endpoint"`
}

type ProviderConnectionRequest struct {
	Provider *string `json:"provider"`
	BaseURL  *string `json:"base_url"`
	APIKey   *string `json:"api_key"`
}

type ProviderModel struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

type ProviderConnectionResponse struct {
	OK         bool            `json:"ok"`
	Message    string          `json:"message"`
	ModelCount int             `json:"model_count"`
	Models     []ProviderModel `json:"models"`
}

type ProviderModelsResponse struct {
	Models []ProviderModel `json:"models"`
}

var Providers = []ProviderInfo{
	{ID: "openai", Label: "OpenAI Compatible", DefaultBaseURL: "https://api.openai.com/v1", DefaultModel: "gpt-4.1-mini", AuthLabel: "Authorization: Bearer", Endpoint: "POST /chat/completions"},
	{ID: "anthropic", Label: "Anthropic Messages", DefaultBaseURL: "https://api.anthropic.com/v1", DefaultModel: "claude-sonnet-4-20250514", AuthLabel: "x-api-key", Endpoint: "POST /messages"},
	{ID: "gemini", Label: "Gemini GenerateContent", DefaultBaseURL: "https://generativelanguage.googleapis.com/v1beta", DefaultModel: "gemini-2.5-flash", AuthLabel: "x-goog-api-key", Endpoint: "POST /models/{model}:generateContent"},
}

func Register(group *gin.RouterGroup, h Handler) {
	r := group.Group("/catalog")
	r.GET("/providers", h.Providers)
	r.POST("/provider/test", h.TestProvider)
	r.POST("/provider/models", h.ProviderModels)
}

func (h Handler) Providers(c *gin.Context) {
	c.JSON(http.StatusOK, Providers)
}

func (h Handler) TestProvider(c *gin.Context) {
	models, ok := h.fetchModels(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, ProviderConnectionResponse{OK: true, Message: "连接正常，模型列表可访问。", ModelCount: len(models), Models: models})
}

func (h Handler) ProviderModels(c *gin.Context) {
	models, ok := h.fetchModels(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, ProviderModelsResponse{Models: models})
}

func (h Handler) fetchModels(c *gin.Context) ([]ProviderModel, bool) {
	var req ProviderConnectionRequest
	if !httputil.BindJSON(c, &req) {
		return nil, false
	}
	provider := normalizeProvider(req.Provider)
	if !isSupportedProvider(provider) {
		httputil.Error(c, http.StatusUnprocessableEntity, "Unsupported provider format: "+provider)
		return nil, false
	}
	baseURL := providerBaseURL(provider, req.BaseURL)
	headers := providerHeaders(provider, req.APIKey)
	request, _ := http.NewRequest(http.MethodGet, appendProviderPath(baseURL, "models"), nil)
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	client := http.Client{Timeout: time.Duration(h.Settings.AITimeoutSeconds * float64(time.Second))}
	resp, err := client.Do(request)
	if err != nil {
		httputil.Error(c, http.StatusBadGateway, "Provider model request failed: "+err.Error())
		return nil, false
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		httputil.Error(c, http.StatusBadGateway, "Provider returned HTTP "+resp.Status+": "+string(body))
		return nil, false
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		httputil.Error(c, http.StatusBadGateway, "Provider returned a non-JSON model response.")
		return nil, false
	}
	return parseModels(provider, payload), true
}

type ChatCompletionRequest struct {
	Provider     *string          `json:"provider"`
	BaseURL      *string          `json:"base_url"`
	APIKey       *string          `json:"api_key"`
	Model        string           `json:"model" binding:"required"`
	Messages     []map[string]any `json:"messages" binding:"required"`
	SystemPrompt *string          `json:"system_prompt"`
	Temperature  *float64         `json:"temperature"`
	MaxTokens    *int             `json:"max_tokens"`
}

type ChatCompletionResponse struct {
	Provider string         `json:"provider"`
	Model    string         `json:"model"`
	Content  string         `json:"content"`
	Usage    map[string]any `json:"usage,omitempty"`
	Raw      map[string]any `json:"raw,omitempty"`
}

func CompleteChat(settings config.Settings, req ChatCompletionRequest) (ChatCompletionResponse, int, string) {
	provider, status, detail := validateChatRequest(req)
	if status >= 400 {
		return ChatCompletionResponse{}, status, detail
	}
	url, payload, headers := buildChatProviderRequest(provider, req)
	body, _ := json.Marshal(payload)
	httpReq, _ := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	for key, value := range headers {
		httpReq.Header.Set(key, value)
	}
	client := http.Client{Timeout: time.Duration(settings.AITimeoutSeconds * float64(time.Second))}
	resp, err := client.Do(httpReq)
	if err != nil {
		return ChatCompletionResponse{}, http.StatusBadGateway, "Provider request failed: " + err.Error()
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return ChatCompletionResponse{}, http.StatusBadGateway, "Provider returned HTTP " + resp.Status + ": " + string(respBody)
	}
	var data map[string]any
	if err := json.Unmarshal(respBody, &data); err != nil {
		return ChatCompletionResponse{}, http.StatusBadGateway, "Provider returned a non-JSON response."
	}
	content, parseDetail := parseChatContent(provider, data)
	if parseDetail != "" {
		return ChatCompletionResponse{}, http.StatusBadGateway, parseDetail
	}
	if content == "" {
		return ChatCompletionResponse{}, http.StatusBadGateway, "Provider returned an empty response."
	}
	usage := mapValue(data["usage"])
	if provider == "gemini" {
		usage = mapValue(data["usageMetadata"])
	}
	return ChatCompletionResponse{Provider: provider, Model: req.Model, Content: content, Usage: usage, Raw: data}, http.StatusOK, ""
}

func StreamChat(settings config.Settings, req ChatCompletionRequest, onChunk func(string) error) (int, string) {
	provider, status, detail := validateChatRequest(req)
	if status >= 400 {
		return status, detail
	}
	if provider != "openai" {
		resp, status, detail := CompleteChat(settings, req)
		if status >= 400 {
			return status, detail
		}
		if err := onChunk(resp.Content); err != nil {
			return http.StatusInternalServerError, err.Error()
		}
		return http.StatusOK, ""
	}

	url, payload, headers := buildChatProviderRequest(provider, req)
	payload["stream"] = true
	body, _ := json.Marshal(payload)
	httpReq, _ := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	for key, value := range headers {
		httpReq.Header.Set(key, value)
	}
	client := http.Client{Timeout: time.Duration(settings.AITimeoutSeconds * float64(time.Second))}
	resp, err := client.Do(httpReq)
	if err != nil {
		return http.StatusBadGateway, "Provider stream request failed: " + err.Error()
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return http.StatusBadGateway, "Provider returned HTTP " + resp.Status + ": " + string(respBody)
	}
	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		chunk := parseOpenAIStreamLine(scanner.Text())
		if chunk == "" {
			continue
		}
		if err := onChunk(chunk); err != nil {
			return http.StatusInternalServerError, err.Error()
		}
	}
	if err := scanner.Err(); err != nil {
		return http.StatusBadGateway, "Provider stream request failed: " + err.Error()
	}
	return http.StatusOK, ""
}

func normalizeProvider(provider *string) string {
	if provider == nil {
		return "openai"
	}
	return strings.TrimSpace(strings.ToLower(*provider))
}

func isSupportedProvider(provider string) bool {
	switch provider {
	case "openai", "anthropic", "gemini":
		return true
	default:
		return false
	}
}

func validateChatRequest(req ChatCompletionRequest) (string, int, string) {
	provider := normalizeProvider(req.Provider)
	if !isSupportedProvider(provider) {
		return provider, http.StatusUnprocessableEntity, "Unsupported provider format: " + provider
	}
	if strings.TrimSpace(req.Model) == "" {
		return provider, http.StatusUnprocessableEntity, "Model is required."
	}
	if len(req.Messages) == 0 {
		return provider, http.StatusUnprocessableEntity, "At least one message is required."
	}
	for _, message := range req.Messages {
		role, ok := message["role"].(string)
		role = strings.TrimSpace(role)
		if !ok {
			return provider, http.StatusUnprocessableEntity, "Message role must be system, user, or assistant."
		}
		if role != "system" && role != "user" && role != "assistant" {
			return provider, http.StatusUnprocessableEntity, "Message role must be system, user, or assistant."
		}
		content, ok := message["content"].(string)
		if !ok {
			return provider, http.StatusUnprocessableEntity, "Message content is required."
		}
		if strings.TrimSpace(content) == "" {
			return provider, http.StatusUnprocessableEntity, "Message content is required."
		}
	}
	if req.Temperature != nil && (*req.Temperature < 0 || *req.Temperature > 2) {
		return provider, http.StatusUnprocessableEntity, "Temperature must be between 0 and 2."
	}
	if req.MaxTokens != nil && (*req.MaxTokens < 1 || *req.MaxTokens > 100000) {
		return provider, http.StatusUnprocessableEntity, "Max tokens must be between 1 and 100000."
	}
	return provider, http.StatusOK, ""
}

func providerBaseURL(provider string, value *string) string {
	if value != nil && strings.TrimSpace(*value) != "" {
		return strings.TrimRight(strings.TrimSpace(*value), "/")
	}
	for _, item := range Providers {
		if item.ID == provider {
			return item.DefaultBaseURL
		}
	}
	return Providers[0].DefaultBaseURL
}

func providerHeaders(provider string, apiKey *string) map[string]string {
	headers := map[string]string{"Content-Type": "application/json"}
	key := ""
	if apiKey != nil {
		key = strings.TrimSpace(*apiKey)
	}
	switch provider {
	case "openai":
		if key != "" {
			headers["Authorization"] = "Bearer " + key
		}
	case "anthropic":
		headers["anthropic-version"] = "2023-06-01"
		if key != "" {
			headers["x-api-key"] = key
		}
	case "gemini":
		if key != "" {
			headers["x-goog-api-key"] = key
		}
	}
	return headers
}

func appendProviderPath(baseURL string, suffix string) string {
	base := strings.TrimRight(baseURL, "/")
	suffix = strings.Trim(suffix, "/")
	if strings.HasSuffix(base, "/"+suffix) {
		return base
	}
	return base + "/" + suffix
}

func parseModels(provider string, payload map[string]any) []ProviderModel {
	models := []ProviderModel{}
	var raw any
	if provider == "gemini" {
		raw = payload["models"]
	} else {
		raw = payload["data"]
	}
	items, _ := raw.([]any)
	for _, item := range items {
		row, ok := item.(map[string]any)
		if !ok {
			continue
		}
		id := stringValue(row["id"])
		label := id
		if provider == "anthropic" {
			label = stringValue(row["display_name"])
			if label == "" {
				label = id
			}
		}
		if provider == "gemini" {
			id = strings.TrimPrefix(stringValue(row["name"]), "models/")
			label = stringValue(row["displayName"])
			if label == "" {
				label = id
			}
		}
		if id != "" {
			models = append(models, ProviderModel{ID: id, Label: label})
		}
	}
	return models
}

func buildChatProviderRequest(provider string, req ChatCompletionRequest) (string, map[string]any, map[string]string) {
	baseURL := providerBaseURL(provider, req.BaseURL)
	headers := providerHeaders(provider, req.APIKey)
	switch provider {
	case "anthropic":
		messages := []map[string]any{}
		systemPrompt := ""
		if req.SystemPrompt != nil {
			systemPrompt = strings.TrimSpace(*req.SystemPrompt)
		}
		for _, message := range req.Messages {
			role := stringValue(message["role"])
			content := stringValue(message["content"])
			if role == "system" {
				if systemPrompt != "" {
					systemPrompt += "\n\n"
				}
				systemPrompt += content
				continue
			}
			if role == "assistant" {
				role = "assistant"
			} else {
				role = "user"
			}
			messages = append(messages, map[string]any{"role": role, "content": content})
		}
		payload := map[string]any{"model": req.Model, "max_tokens": chatMaxTokens(req), "messages": messages}
		if systemPrompt != "" {
			payload["system"] = systemPrompt
		}
		payload["temperature"] = chatTemperature(req)
		return strings.TrimRight(baseURL, "/") + "/messages", payload, headers
	case "gemini":
		contents := []map[string]any{}
		systemPrompt := ""
		if req.SystemPrompt != nil {
			systemPrompt = strings.TrimSpace(*req.SystemPrompt)
		}
		for _, message := range req.Messages {
			role := stringValue(message["role"])
			content := stringValue(message["content"])
			if role == "system" {
				if systemPrompt != "" {
					systemPrompt += "\n\n"
				}
				systemPrompt += content
				continue
			}
			geminiRole := "user"
			if role == "assistant" {
				geminiRole = "model"
			}
			contents = append(contents, map[string]any{"role": geminiRole, "parts": []map[string]string{{"text": content}}})
		}
		payload := map[string]any{"contents": contents}
		payload["generationConfig"] = map[string]any{"temperature": chatTemperature(req), "maxOutputTokens": chatMaxTokens(req)}
		if systemPrompt != "" {
			payload["systemInstruction"] = map[string]any{"parts": []map[string]string{{"text": systemPrompt}}}
		}
		return geminiEndpoint(baseURL, req.Model), payload, headers
	default:
		messages := []map[string]any{}
		if req.SystemPrompt != nil && strings.TrimSpace(*req.SystemPrompt) != "" {
			messages = append(messages, map[string]any{"role": "system", "content": strings.TrimSpace(*req.SystemPrompt)})
		}
		messages = append(messages, req.Messages...)
		payload := map[string]any{"model": req.Model, "messages": messages, "stream": false}
		payload["temperature"] = chatTemperature(req)
		payload["max_tokens"] = chatMaxTokens(req)
		return strings.TrimRight(baseURL, "/") + "/chat/completions", payload, headers
	}
}

func chatTemperature(req ChatCompletionRequest) float64 {
	if req.Temperature == nil {
		return 0.7
	}
	return *req.Temperature
}

func chatMaxTokens(req ChatCompletionRequest) int {
	if req.MaxTokens == nil {
		return 1024
	}
	return *req.MaxTokens
}

func parseChatContent(provider string, data map[string]any) (string, string) {
	switch provider {
	case "anthropic":
		raw, exists := data["content"]
		if !exists {
			return "", ""
		}
		if text, ok := raw.(string); ok {
			return text, ""
		}
		items, ok := raw.([]any)
		if !ok {
			return "", "Anthropic response did not include a valid content list."
		}
		parts := []string{}
		for _, item := range items {
			row, ok := item.(map[string]any)
			if ok && stringValue(row["type"]) == "text" {
				parts = append(parts, stringValue(row["text"]))
			}
		}
		return strings.TrimSpace(strings.Join(parts, "\n")), ""
	case "gemini":
		candidates, ok := data["candidates"].([]any)
		if !ok || len(candidates) == 0 {
			return "", "Gemini response did not include candidates[0].content.parts."
		}
		candidate, ok := candidates[0].(map[string]any)
		if !ok {
			return "", "Gemini response did not include candidates[0].content.parts."
		}
		content, ok := candidate["content"].(map[string]any)
		if !ok {
			return "", "Gemini response did not include candidates[0].content.parts."
		}
		parts, ok := content["parts"].([]any)
		if !ok {
			return "", "Gemini response did not include candidates[0].content.parts."
		}
		out := []string{}
		for _, part := range parts {
			row, _ := part.(map[string]any)
			text := stringValue(row["text"])
			if text != "" {
				out = append(out, text)
			}
		}
		return strings.TrimSpace(strings.Join(out, "\n")), ""
	default:
		choices, ok := data["choices"].([]any)
		if !ok || len(choices) == 0 {
			return "", "OpenAI-compatible response did not include choices[0].message.content."
		}
		choice, ok := choices[0].(map[string]any)
		if !ok {
			return "", "OpenAI-compatible response did not include choices[0].message.content."
		}
		message, ok := choice["message"].(map[string]any)
		if !ok {
			return "", "OpenAI-compatible response did not include choices[0].message.content."
		}
		content, exists := message["content"]
		if !exists {
			return "", "OpenAI-compatible response did not include choices[0].message.content."
		}
		return contentToText(content), ""
	}
}

func geminiEndpoint(baseURL string, model string) string {
	base := strings.TrimRight(baseURL, "/")
	if strings.HasSuffix(base, ":generateContent") {
		return base
	}
	cleanModel := strings.TrimPrefix(model, "models/")
	if strings.HasSuffix(base, "/models") {
		return base + "/" + cleanModel + ":generateContent"
	}
	return base + "/models/" + cleanModel + ":generateContent"
}

func contentToText(content any) string {
	switch typed := content.(type) {
	case string:
		return typed
	case []any:
		parts := []string{}
		for _, item := range typed {
			row, ok := item.(map[string]any)
			if !ok {
				continue
			}
			text := stringValue(row["text"])
			if text != "" {
				parts = append(parts, text)
			}
		}
		return strings.Join(parts, "\n")
	default:
		return stringValue(content)
	}
}

func parseOpenAIStreamLine(line string) string {
	if !strings.HasPrefix(line, "data:") {
		return ""
	}
	raw := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
	if raw == "" || raw == "[DONE]" {
		return ""
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return ""
	}
	choices, _ := payload["choices"].([]any)
	if len(choices) == 0 {
		return ""
	}
	choice, _ := choices[0].(map[string]any)
	delta, _ := choice["delta"].(map[string]any)
	return stringValue(delta["content"])
}

func mapValue(value any) map[string]any {
	if value == nil {
		return nil
	}
	row, _ := value.(map[string]any)
	return row
}

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return typed
	default:
		return fmt.Sprint(typed)
	}
}
