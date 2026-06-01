package config

import (
	"bufio"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Settings struct {
	BaseDir                  string
	AppName                  string
	AppHost                  string
	AppPort                  int
	APIPrefix                string
	AITimeoutSeconds         float64
	MCPTimeoutSeconds        float64
	MCPResultMaxChars        int
	BigModelMCPLive          bool
	AgentSynthesisProvider   string
	AgentSynthesisBaseURL    string
	AgentSynthesisAPIKey     string
	AgentSynthesisModel      string
	AgentSynthesisLive       bool
	AgentGraphRuntime        string
	AgentLanggraphCheckpoint string
	DatabaseURL              string
	MediaRoot                string
	AvatarUploadDirname      string
	TencentMapKey            string
	TencentMapSignatureKey   string
	CORSOrigins              []string
}

func Load() Settings {
	baseDir, _ := os.Getwd()
	loadEnvFile(filepath.Join(baseDir, ".env"))

	mediaRoot := getenv("MEDIA_ROOT", filepath.Join(baseDir, "media"))
	absMediaRoot, err := filepath.Abs(mediaRoot)
	if err == nil {
		mediaRoot = absMediaRoot
	}

	return Settings{
		BaseDir:                  baseDir,
		AppName:                  "4Ever Aggregation Platform",
		AppHost:                  getenv("APP_HOST", "127.0.0.1"),
		AppPort:                  getenvInt("APP_PORT", 7778),
		APIPrefix:                "/api",
		AITimeoutSeconds:         getenvFloat("AI_TIMEOUT_SECONDS", 120),
		MCPTimeoutSeconds:        getenvFloat("MCP_TIMEOUT_SECONDS", 30),
		MCPResultMaxChars:        getenvInt("MCP_RESULT_MAX_CHARS", 3000),
		BigModelMCPLive:          getenvBool("BIGMODEL_MCP_LIVE"),
		AgentSynthesisProvider:   strings.TrimSpace(strings.ToLower(os.Getenv("AGENT_SYNTHESIS_PROVIDER"))),
		AgentSynthesisBaseURL:    strings.TrimSpace(os.Getenv("AGENT_SYNTHESIS_BASE_URL")),
		AgentSynthesisAPIKey:     strings.TrimSpace(os.Getenv("AGENT_SYNTHESIS_API_KEY")),
		AgentSynthesisModel:      strings.TrimSpace(os.Getenv("AGENT_SYNTHESIS_MODEL")),
		AgentSynthesisLive:       getenvBool("AGENT_SYNTHESIS_LIVE"),
		AgentGraphRuntime:        strings.TrimSpace(strings.ToLower(getenv("AGENT_GRAPH_RUNTIME", "auto"))),
		AgentLanggraphCheckpoint: strings.TrimSpace(os.Getenv("AGENT_LANGGRAPH_CHECKPOINT_PATH")),
		DatabaseURL:              getenv("DATABASE_URL", "sqlite:///./4ever.db"),
		MediaRoot:                mediaRoot,
		AvatarUploadDirname:      getenv("AVATAR_UPLOAD_DIRNAME", "avatars"),
		TencentMapKey:            os.Getenv("TENCENT_MAP_KEY"),
		TencentMapSignatureKey:   os.Getenv("TENCENT_MAP_SIGNATURE_KEY"),
		CORSOrigins:              splitCSV(getenv("CORS_ORIGINS", "http://localhost:7777,http://127.0.0.1:7777")),
	}
}

func loadEnvFile(path string) {
	file, err := os.Open(path)
	if err != nil {
		return
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") || !strings.Contains(line, "=") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		key := strings.TrimSpace(parts[0])
		if key == "" || os.Getenv(key) != "" {
			continue
		}
		value := strings.TrimSpace(parts[1])
		value = strings.Trim(value, `"'`)
		_ = os.Setenv(key, value)
	}
}

func getenv(key string, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}

func getenvInt(key string, fallback int) int {
	value, err := strconv.Atoi(os.Getenv(key))
	if err != nil {
		return fallback
	}
	return value
}

func getenvFloat(key string, fallback float64) float64 {
	value, err := strconv.ParseFloat(os.Getenv(key), 64)
	if err != nil {
		return fallback
	}
	return value
}

func getenvBool(key string) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(key))) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func splitCSV(value string) []string {
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			result = append(result, part)
		}
	}
	return result
}
