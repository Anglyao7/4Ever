package tokenusage

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"4ever/backend/internal/auth"
	"4ever/backend/internal/httputil"
	"4ever/backend/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type Handler struct {
	DB *gorm.DB
}

type APIKeyResponse struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	Prefix     string     `json:"prefix"`
	Status     string     `json:"status"`
	LastUsedAt *time.Time `json:"last_used_at"`
	CreatedAt  time.Time  `json:"created_at"`
}

type APIKeyCreateRequest struct {
	Name string `json:"name" binding:"required,min=1,max=120"`
}

type APIKeyCreateResponse struct {
	Key    APIKeyResponse `json:"key"`
	RawKey string         `json:"raw_key"`
}

type APIKeyRevealResponse struct {
	RawKey *string `json:"raw_key"`
}

type APIKeyUpdateRequest struct {
	Name   *string `json:"name" binding:"omitempty,min=1,max=120"`
	Status *string `json:"status"`
}

type DeviceIn struct {
	DeviceID string `json:"deviceId" binding:"required,max=120"`
	Hostname string `json:"hostname"`
}

type BucketIn struct {
	Source          string    `json:"source" binding:"required,max=80"`
	Model           string    `json:"model"`
	ProjectKey      string    `json:"projectKey"`
	ProjectLabel    string    `json:"projectLabel"`
	BucketStart     time.Time `json:"bucketStart" binding:"required"`
	DeviceID        *string   `json:"deviceId"`
	Hostname        *string   `json:"hostname"`
	InputTokens     int       `json:"inputTokens"`
	OutputTokens    int       `json:"outputTokens"`
	ReasoningTokens int       `json:"reasoningTokens"`
	CachedTokens    int       `json:"cachedTokens"`
	TotalTokens     int       `json:"totalTokens"`
}

type SessionIn struct {
	Source           string           `json:"source" binding:"required,max=80"`
	ProjectKey       string           `json:"projectKey"`
	ProjectLabel     string           `json:"projectLabel"`
	SessionHash      string           `json:"sessionHash" binding:"required,max=120"`
	DeviceID         *string          `json:"deviceId"`
	Hostname         *string          `json:"hostname"`
	FirstMessageAt   time.Time        `json:"firstMessageAt" binding:"required"`
	LastMessageAt    time.Time        `json:"lastMessageAt" binding:"required"`
	DurationSeconds  int              `json:"durationSeconds"`
	ActiveSeconds    int              `json:"activeSeconds"`
	MessageCount     int              `json:"messageCount"`
	UserMessageCount int              `json:"userMessageCount"`
	InputTokens      int              `json:"inputTokens"`
	OutputTokens     int              `json:"outputTokens"`
	ReasoningTokens  int              `json:"reasoningTokens"`
	CachedTokens     int              `json:"cachedTokens"`
	TotalTokens      int              `json:"totalTokens"`
	PrimaryModel     string           `json:"primaryModel"`
	ModelUsages      []map[string]any `json:"modelUsages"`
}

type IngestRequest struct {
	SchemaVersion *int        `json:"schemaVersion"`
	Device        DeviceIn    `json:"device" binding:"required"`
	Buckets       []BucketIn  `json:"buckets"`
	Sessions      []SessionIn `json:"sessions"`
}

type IngestResponse struct {
	OK           bool   `json:"ok"`
	BucketCount  int    `json:"bucketCount"`
	SessionCount int    `json:"sessionCount"`
	DeviceID     string `json:"deviceId"`
}

type Overview struct {
	InputTokens     int `json:"input_tokens"`
	OutputTokens    int `json:"output_tokens"`
	ReasoningTokens int `json:"reasoning_tokens"`
	CachedTokens    int `json:"cached_tokens"`
	TotalTokens     int `json:"total_tokens"`
	ActiveSeconds   int `json:"active_seconds"`
	Sessions        int `json:"sessions"`
	Messages        int `json:"messages"`
	Devices         int `json:"devices"`
	Sources         int `json:"sources"`
	Projects        int `json:"projects"`
	Models          int `json:"models"`
}

type TrendPoint struct {
	Date          string `json:"date"`
	TotalTokens   int    `json:"total_tokens"`
	ActiveSeconds int    `json:"active_seconds"`
	Sessions      int    `json:"sessions"`
}

type RankItem struct {
	Key             string `json:"key"`
	Label           string `json:"label"`
	TotalTokens     int    `json:"total_tokens"`
	InputTokens     int    `json:"input_tokens"`
	OutputTokens    int    `json:"output_tokens"`
	ReasoningTokens int    `json:"reasoning_tokens"`
	CachedTokens    int    `json:"cached_tokens"`
	Sessions        int    `json:"sessions"`
}

type HeatmapKeyBreakdown struct {
	KeyID       string `json:"key_id"`
	KeyName     string `json:"key_name"`
	TotalTokens int    `json:"total_tokens"`
}

type HeatmapCell struct {
	Day           string                `json:"day"`
	Hour          int                   `json:"hour"`
	TotalTokens   int                   `json:"total_tokens"`
	ActiveSeconds int                   `json:"active_seconds"`
	KeyBreakdown  []HeatmapKeyBreakdown `json:"key_breakdown"`
}

type DeviceSummary struct {
	DeviceID      string     `json:"device_id"`
	Hostname      string     `json:"hostname"`
	TotalTokens   int        `json:"total_tokens"`
	ActiveSeconds int        `json:"active_seconds"`
	Sessions      int        `json:"sessions"`
	Sources       int        `json:"sources"`
	LastSeenAt    *time.Time `json:"last_seen_at"`
}

type Dashboard struct {
	Range        string          `json:"range"`
	Overview     Overview        `json:"overview"`
	TokenTrend   []TrendPoint    `json:"token_trend"`
	Heatmap      []HeatmapCell   `json:"heatmap"`
	BySource     []RankItem      `json:"by_source"`
	ByModel      []RankItem      `json:"by_model"`
	ByProject    []RankItem      `json:"by_project"`
	Devices      []DeviceSummary `json:"devices"`
	LastSyncedAt *time.Time      `json:"last_synced_at"`
}

type LeaderboardEntry struct {
	Rank          int    `json:"rank"`
	UserID        string `json:"user_id"`
	Username      string `json:"username"`
	DisplayName   string `json:"display_name"`
	TotalTokens   int    `json:"total_tokens"`
	ActiveSeconds int    `json:"active_seconds"`
	Sessions      int    `json:"sessions"`
}

type Leaderboard struct {
	Entries []LeaderboardEntry `json:"entries"`
}

var displayTZ = time.FixedZone("CST", 8*60*60)

func Register(group *gin.RouterGroup, h Handler) {
	r := group.Group("/token-usage")
	r.GET("/keys", h.ListKeys)
	r.POST("/keys", h.CreateKey)
	r.GET("/keys/:key_id/reveal", h.RevealKey)
	r.PATCH("/keys/:key_id", h.UpdateKey)
	r.POST("/ingest", h.Ingest)
	r.GET("/dashboard", h.Dashboard)
	r.GET("/leaderboard", h.Leaderboard)
}

func (h Handler) ListKeys(c *gin.Context) {
	user, ok := auth.ResolveUser(c, h.DB)
	if !ok {
		return
	}
	var records []models.TokenUsageAPIKey
	h.DB.Where("user_id = ?", user.ID).Order("created_at DESC").Find(&records)
	out := make([]APIKeyResponse, 0, len(records))
	for _, record := range records {
		out = append(out, toAPIKey(record))
	}
	c.JSON(http.StatusOK, out)
}

func (h Handler) CreateKey(c *gin.Context) {
	user, ok := auth.ResolveUser(c, h.DB)
	if !ok {
		return
	}
	var req APIKeyCreateRequest
	if !httputil.BindJSON(c, &req) {
		return
	}
	rawKey := "4ev_tok_" + randomURLSafe(28)
	id := randomHex(12)
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = "本机 CLI"
	}
	record := models.TokenUsageAPIKey{
		ID: id, UserID: user.ID, Name: name, Prefix: rawKey[:14], KeyHash: hashUsageKey(rawKey), RawKey: &rawKey, Status: "active",
	}
	if err := h.DB.Create(&record).Error; err != nil {
		httputil.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, APIKeyCreateResponse{Key: toAPIKey(record), RawKey: rawKey})
}

func (h Handler) RevealKey(c *gin.Context) {
	record, ok := h.resolveOwnedKey(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, APIKeyRevealResponse{RawKey: record.RawKey})
}

func (h Handler) UpdateKey(c *gin.Context) {
	record, ok := h.resolveOwnedKey(c)
	if !ok {
		return
	}
	var req APIKeyUpdateRequest
	if !httputil.BindJSON(c, &req) {
		return
	}
	if req.Name != nil {
		record.Name = strings.TrimSpace(*req.Name)
	}
	if req.Status != nil {
		status := strings.TrimSpace(*req.Status)
		if status != "active" && status != "disabled" {
			httputil.Error(c, http.StatusUnprocessableEntity, "status must be active or disabled")
			return
		}
		record.Status = status
	}
	h.DB.Save(&record)
	c.JSON(http.StatusOK, toAPIKey(record))
}

func (h Handler) Ingest(c *gin.Context) {
	apiKey, ok := h.resolveUsageKey(c)
	if !ok {
		return
	}
	var req IngestRequest
	if !httputil.BindJSON(c, &req) {
		return
	}
	if !validateIngestRequest(c, req) {
		return
	}
	now := time.Now().UTC()
	apiKey.LastUsedAt = &now
	h.DB.Save(&apiKey)

	bucketCount := 0
	for _, bucket := range req.Buckets {
		deviceID := req.Device.DeviceID
		if bucket.DeviceID != nil && strings.TrimSpace(*bucket.DeviceID) != "" {
			deviceID = strings.TrimSpace(*bucket.DeviceID)
		}
		hostname := req.Device.Hostname
		if bucket.Hostname != nil && strings.TrimSpace(*bucket.Hostname) != "" {
			hostname = *bucket.Hostname
		}
		modelName := defaultString(bucket.Model, "unknown")
		projectKey := defaultString(bucket.ProjectKey, "unknown")
		projectLabel := defaultString(bucket.ProjectLabel, projectKey)
		total := bucket.TotalTokens
		if total == 0 {
			total = bucket.InputTokens + bucket.OutputTokens + bucket.ReasoningTokens + bucket.CachedTokens
		}
		var existing models.TokenUsageBucket
		err := h.DB.Where(
			"user_id = ? AND api_key_id = ? AND device_id = ? AND source = ? AND model = ? AND project_key = ? AND bucket_start = ?",
			apiKey.UserID, apiKey.ID, deviceID, bucket.Source, modelName, projectKey, toUTC(bucket.BucketStart),
		).First(&existing).Error
		values := models.TokenUsageBucket{
			UserID: apiKey.UserID, APIKeyID: &apiKey.ID, DeviceID: deviceID, Hostname: hostname, Source: bucket.Source,
			Model: modelName, ProjectKey: projectKey, ProjectLabel: projectLabel, BucketStart: toUTC(bucket.BucketStart),
			InputTokens: bucket.InputTokens, OutputTokens: bucket.OutputTokens, ReasoningTokens: bucket.ReasoningTokens,
			CachedTokens: bucket.CachedTokens, TotalTokens: total,
		}
		if err == nil {
			values.ID = existing.ID
			values.CreatedAt = existing.CreatedAt
			h.DB.Save(&values)
		} else {
			h.DB.Create(&values)
		}
		bucketCount++
	}

	sessionCount := 0
	for _, session := range req.Sessions {
		deviceID := req.Device.DeviceID
		if session.DeviceID != nil && strings.TrimSpace(*session.DeviceID) != "" {
			deviceID = strings.TrimSpace(*session.DeviceID)
		}
		hostname := req.Device.Hostname
		if session.Hostname != nil && strings.TrimSpace(*session.Hostname) != "" {
			hostname = *session.Hostname
		}
		projectKey := defaultString(session.ProjectKey, "unknown")
		projectLabel := defaultString(session.ProjectLabel, projectKey)
		total := session.TotalTokens
		if total == 0 {
			total = session.InputTokens + session.OutputTokens + session.ReasoningTokens + session.CachedTokens
		}
		modelUsages, _ := json.Marshal(session.ModelUsages)
		var existing models.TokenUsageSession
		err := h.DB.Where(
			"user_id = ? AND api_key_id = ? AND device_id = ? AND source = ? AND session_hash = ?",
			apiKey.UserID, apiKey.ID, deviceID, session.Source, session.SessionHash,
		).First(&existing).Error
		values := models.TokenUsageSession{
			UserID: apiKey.UserID, APIKeyID: &apiKey.ID, DeviceID: deviceID, Hostname: hostname, Source: session.Source,
			ProjectKey: projectKey, ProjectLabel: projectLabel, SessionHash: session.SessionHash,
			FirstMessageAt: toUTC(session.FirstMessageAt), LastMessageAt: toUTC(session.LastMessageAt),
			DurationSeconds: session.DurationSeconds, ActiveSeconds: session.ActiveSeconds, MessageCount: session.MessageCount,
			UserMessageCount: session.UserMessageCount, InputTokens: session.InputTokens, OutputTokens: session.OutputTokens,
			ReasoningTokens: session.ReasoningTokens, CachedTokens: session.CachedTokens, TotalTokens: total,
			PrimaryModel: session.PrimaryModel, ModelUsagesJSON: string(modelUsages),
		}
		if err == nil {
			values.ID = existing.ID
			values.CreatedAt = existing.CreatedAt
			h.DB.Save(&values)
		} else {
			h.DB.Create(&values)
		}
		sessionCount++
	}
	c.JSON(http.StatusOK, IngestResponse{OK: true, BucketCount: bucketCount, SessionCount: sessionCount, DeviceID: req.Device.DeviceID})
}

func (h Handler) Dashboard(c *gin.Context) {
	user, ok := auth.ResolveUser(c, h.DB)
	if !ok {
		return
	}
	rangeValue := c.DefaultQuery("range", "30d")
	start, end, ok := usageRange(c, rangeValue, c.Query("custom_start"), c.Query("custom_end"))
	if !ok {
		return
	}
	var buckets []models.TokenUsageBucket
	bq := h.DB.Where("user_id = ?", user.ID)
	if start != nil {
		bq = bq.Where("bucket_start >= ?", *start)
	}
	if end != nil {
		bq = bq.Where("bucket_start <= ?", *end)
	}
	bq.Order("bucket_start ASC").Find(&buckets)
	var sessions []models.TokenUsageSession
	sq := h.DB.Where("user_id = ?", user.ID)
	if start != nil {
		sq = sq.Where("first_message_at >= ?", *start)
	}
	if end != nil {
		sq = sq.Where("first_message_at <= ?", *end)
	}
	sq.Order("last_message_at DESC").Find(&sessions)
	var lastSynced *time.Time
	var latest models.TokenUsageBucket
	if err := h.DB.Where("user_id = ?", user.ID).Order("updated_at DESC").First(&latest).Error; err == nil {
		lastSynced = &latest.UpdatedAt
	}
	c.JSON(http.StatusOK, Dashboard{
		Range: rangeValue, Overview: buildOverview(buckets, sessions), TokenTrend: buildTrend(buckets, sessions),
		Heatmap: buildHeatmap(buckets, sessions, h.keyNames(user.ID)), BySource: rankBuckets(buckets, sessions, "source"),
		ByModel: rankBuckets(buckets, sessions, "model"), ByProject: rankBuckets(buckets, sessions, "project_key"),
		Devices: buildDevices(buckets, sessions), LastSyncedAt: lastSynced,
	})
}

func (h Handler) Leaderboard(c *gin.Context) {
	if _, ok := auth.ResolveUser(c, h.DB); !ok {
		return
	}
	rangeValue := c.DefaultQuery("range", "30d")
	start, end, ok := usageRange(c, rangeValue, c.Query("custom_start"), c.Query("custom_end"))
	if !ok {
		return
	}
	type row struct {
		ID          string
		Username    string
		DisplayName string
		Total       int
	}
	rows := []row{}
	query := h.DB.Table("users").Select("users.id, users.username, users.display_name, COALESCE(SUM(token_usage_buckets.total_tokens), 0) as total").
		Joins("JOIN token_usage_buckets ON token_usage_buckets.user_id = users.id")
	if start != nil {
		query = query.Where("token_usage_buckets.bucket_start >= ?", *start)
	}
	if end != nil {
		query = query.Where("token_usage_buckets.bucket_start <= ?", *end)
	}
	query.Group("users.id, users.username, users.display_name").Order("total DESC").Limit(20).Scan(&rows)
	entries := []LeaderboardEntry{}
	for i, row := range rows {
		sq := h.DB.Model(&models.TokenUsageSession{}).Where("user_id = ?", row.ID)
		if start != nil {
			sq = sq.Where("first_message_at >= ?", *start)
		}
		if end != nil {
			sq = sq.Where("first_message_at <= ?", *end)
		}
		var sessions int64
		var activeSeconds int
		sq.Count(&sessions)
		sq.Select("COALESCE(SUM(active_seconds), 0)").Scan(&activeSeconds)
		entries = append(entries, LeaderboardEntry{Rank: i + 1, UserID: row.ID, Username: row.Username, DisplayName: row.DisplayName, TotalTokens: row.Total, ActiveSeconds: activeSeconds, Sessions: int(sessions)})
	}
	c.JSON(http.StatusOK, Leaderboard{Entries: entries})
}

func (h Handler) resolveOwnedKey(c *gin.Context) (models.TokenUsageAPIKey, bool) {
	user, ok := auth.ResolveUser(c, h.DB)
	if !ok {
		return models.TokenUsageAPIKey{}, false
	}
	var record models.TokenUsageAPIKey
	if err := h.DB.Where("id = ? AND user_id = ?", c.Param("key_id"), user.ID).First(&record).Error; err != nil {
		httputil.Error(c, http.StatusNotFound, "Token usage API key not found.")
		return models.TokenUsageAPIKey{}, false
	}
	return record, true
}

func (h Handler) resolveUsageKey(c *gin.Context) (models.TokenUsageAPIKey, bool) {
	header := c.GetHeader("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		httputil.Error(c, http.StatusUnauthorized, "Missing token usage API key.")
		return models.TokenUsageAPIKey{}, false
	}
	rawKey := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
	var record models.TokenUsageAPIKey
	if err := h.DB.Where("key_hash = ?", hashUsageKey(rawKey)).First(&record).Error; err != nil || record.Status != "active" {
		httputil.Error(c, http.StatusUnauthorized, "Invalid token usage API key.")
		return models.TokenUsageAPIKey{}, false
	}
	return record, true
}

func (h Handler) keyNames(userID string) map[string]string {
	var records []models.TokenUsageAPIKey
	h.DB.Where("user_id = ?", userID).Find(&records)
	result := map[string]string{}
	for _, record := range records {
		result[record.ID] = record.Name
	}
	return result
}

func toAPIKey(record models.TokenUsageAPIKey) APIKeyResponse {
	return APIKeyResponse{ID: record.ID, Name: record.Name, Prefix: record.Prefix, Status: record.Status, LastUsedAt: record.LastUsedAt, CreatedAt: record.CreatedAt}
}

func hashUsageKey(rawKey string) string {
	sum := sha256.Sum256([]byte(rawKey))
	return hex.EncodeToString(sum[:])
}

func randomHex(bytes int) string {
	buf := make([]byte, bytes)
	_, _ = rand.Read(buf)
	return hex.EncodeToString(buf)
}

func randomURLSafe(bytes int) string {
	buf := make([]byte, bytes)
	_, _ = rand.Read(buf)
	return base64.RawURLEncoding.EncodeToString(buf)
}

func toUTC(value time.Time) time.Time {
	return value.UTC()
}

func validateIngestRequest(c *gin.Context, req IngestRequest) bool {
	if req.SchemaVersion == nil {
		httputil.Error(c, http.StatusUnprocessableEntity, "schemaVersion is required.")
		return false
	}
	if *req.SchemaVersion != 2 {
		httputil.Error(c, http.StatusUnprocessableEntity, "schemaVersion must be 2.")
		return false
	}
	if strings.TrimSpace(req.Device.DeviceID) == "" {
		httputil.Error(c, http.StatusUnprocessableEntity, "deviceId is required.")
		return false
	}
	if len(req.Buckets) > 500 {
		httputil.Error(c, http.StatusUnprocessableEntity, "buckets cannot contain more than 500 items.")
		return false
	}
	if len(req.Sessions) > 1000 {
		httputil.Error(c, http.StatusUnprocessableEntity, "sessions cannot contain more than 1000 items.")
		return false
	}
	for _, bucket := range req.Buckets {
		if !validateBucket(c, bucket) {
			return false
		}
	}
	for _, session := range req.Sessions {
		if !validateSession(c, session) {
			return false
		}
	}
	return true
}

func validateBucket(c *gin.Context, bucket BucketIn) bool {
	if negativeInts(bucket.InputTokens, bucket.OutputTokens, bucket.ReasoningTokens, bucket.CachedTokens, bucket.TotalTokens) {
		httputil.Error(c, http.StatusUnprocessableEntity, "Token counts must be greater than or equal to 0.")
		return false
	}
	return true
}

func validateSession(c *gin.Context, session SessionIn) bool {
	if negativeInts(
		session.DurationSeconds,
		session.ActiveSeconds,
		session.MessageCount,
		session.UserMessageCount,
		session.InputTokens,
		session.OutputTokens,
		session.ReasoningTokens,
		session.CachedTokens,
		session.TotalTokens,
	) {
		httputil.Error(c, http.StatusUnprocessableEntity, "Session counters must be greater than or equal to 0.")
		return false
	}
	return true
}

func negativeInts(values ...int) bool {
	for _, value := range values {
		if value < 0 {
			return true
		}
	}
	return false
}

func usageRange(c *gin.Context, value string, customStart string, customEnd string) (*time.Time, *time.Time, bool) {
	if customStart != "" || customEnd != "" {
		if customStart == "" || customEnd == "" {
			httputil.Error(c, http.StatusUnprocessableEntity, "Custom range requires both custom_start and custom_end.")
			return nil, nil, false
		}
		start, err1 := parseDateBoundary(customStart, false)
		end, err2 := parseDateBoundary(customEnd, true)
		if err1 != nil || err2 != nil {
			httputil.Error(c, http.StatusUnprocessableEntity, "Invalid custom range date.")
			return nil, nil, false
		}
		if start.After(end) {
			httputil.Error(c, http.StatusUnprocessableEntity, "custom_start cannot be later than custom_end.")
			return nil, nil, false
		}
		limit := start.AddDate(0, 6, 0).Add(24*time.Hour - time.Nanosecond)
		if end.After(limit) {
			httputil.Error(c, http.StatusUnprocessableEntity, "Custom range cannot exceed 6 months.")
			return nil, nil, false
		}
		return &start, &end, true
	}
	if value == "all" {
		return nil, nil, true
	}
	days := map[string]int{"1d": 1, "7d": 7, "30d": 30}[value]
	if days == 0 {
		days = 30
	}
	nowLocal := time.Now().UTC().In(displayTZ)
	endLocal := time.Date(nowLocal.Year(), nowLocal.Month(), nowLocal.Day(), 23, 59, 59, int(time.Second-time.Nanosecond), displayTZ)
	startLocal := time.Date(endLocal.Year(), endLocal.Month(), endLocal.Day(), 0, 0, 0, 0, displayTZ).AddDate(0, 0, -(days - 1))
	start := startLocal.UTC()
	end := endLocal.UTC()
	return &start, &end, true
}

func parseDateBoundary(value string, end bool) (time.Time, error) {
	parsed, err := time.ParseInLocation("2006-01-02", value, displayTZ)
	if err != nil {
		return time.Time{}, err
	}
	if end {
		parsed = time.Date(parsed.Year(), parsed.Month(), parsed.Day(), 23, 59, 59, int(time.Second-time.Nanosecond), displayTZ)
	}
	return parsed.UTC(), nil
}

func localDayHour(value time.Time) (string, int) {
	local := value.UTC().In(displayTZ)
	return local.Format("2006-01-02"), local.Hour()
}

func buildOverview(buckets []models.TokenUsageBucket, sessions []models.TokenUsageSession) Overview {
	devices, sources, projects, modelNames := map[string]bool{}, map[string]bool{}, map[string]bool{}, map[string]bool{}
	out := Overview{Sessions: len(sessions)}
	for _, bucket := range buckets {
		out.InputTokens += bucket.InputTokens
		out.OutputTokens += bucket.OutputTokens
		out.ReasoningTokens += bucket.ReasoningTokens
		out.CachedTokens += bucket.CachedTokens
		out.TotalTokens += bucket.TotalTokens
		devices[bucket.DeviceID] = true
		sources[bucket.Source] = true
		projects[bucket.ProjectKey] = true
		modelNames[bucket.Model] = true
	}
	for _, session := range sessions {
		out.ActiveSeconds += session.ActiveSeconds
		out.Messages += session.MessageCount
	}
	out.Devices, out.Sources, out.Projects, out.Models = len(devices), len(sources), len(projects), len(modelNames)
	return out
}

func buildTrend(buckets []models.TokenUsageBucket, sessions []models.TokenUsageSession) []TrendPoint {
	type agg struct{ tokens, active, sessions int }
	byDay := map[string]*agg{}
	for _, bucket := range buckets {
		day, _ := localDayHour(bucket.BucketStart)
		if byDay[day] == nil {
			byDay[day] = &agg{}
		}
		byDay[day].tokens += bucket.TotalTokens
	}
	for _, session := range sessions {
		day, _ := localDayHour(session.FirstMessageAt)
		if byDay[day] == nil {
			byDay[day] = &agg{}
		}
		byDay[day].active += session.ActiveSeconds
		byDay[day].sessions++
	}
	days := sortedKeys(byDay)
	out := make([]TrendPoint, 0, len(days))
	for _, day := range days {
		row := byDay[day]
		out = append(out, TrendPoint{Date: day, TotalTokens: row.tokens, ActiveSeconds: row.active, Sessions: row.sessions})
	}
	return out
}

func buildHeatmap(buckets []models.TokenUsageBucket, sessions []models.TokenUsageSession, keyNames map[string]string) []HeatmapCell {
	type agg struct {
		tokens int
		active int
		keys   map[string]int
	}
	slots := map[string]*agg{}
	for _, bucket := range buckets {
		day, hour := localDayHour(bucket.BucketStart)
		key := fmt.Sprintf("%s|%02d", day, hour)
		if slots[key] == nil {
			slots[key] = &agg{keys: map[string]int{}}
		}
		slots[key].tokens += bucket.TotalTokens
		keyID := "unknown"
		if bucket.APIKeyID != nil && *bucket.APIKeyID != "" {
			keyID = *bucket.APIKeyID
		}
		slots[key].keys[keyID] += bucket.TotalTokens
	}
	for _, session := range sessions {
		day, hour := localDayHour(session.FirstMessageAt)
		key := fmt.Sprintf("%s|%02d", day, hour)
		if slots[key] == nil {
			slots[key] = &agg{keys: map[string]int{}}
		}
		slots[key].active += session.ActiveSeconds
	}
	keys := sortedKeys(slots)
	out := []HeatmapCell{}
	for _, key := range keys {
		parts := strings.Split(key, "|")
		hour := 0
		if len(parts) > 1 {
			hour, _ = strconv.Atoi(parts[1])
		}
		breakdown := []HeatmapKeyBreakdown{}
		keyIDs := sortedKeys(slots[key].keys)
		sort.Slice(keyIDs, func(i, j int) bool {
			left, right := slots[key].keys[keyIDs[i]], slots[key].keys[keyIDs[j]]
			if left == right {
				return keyNames[keyIDs[i]] < keyNames[keyIDs[j]]
			}
			return left > right
		})
		for _, keyID := range keyIDs {
			total := slots[key].keys[keyID]
			if total <= 0 {
				continue
			}
			name := keyNames[keyID]
			if name == "" {
				if keyID == "unknown" {
					name = "未知 Key"
				} else {
					name = keyID
				}
			}
			breakdown = append(breakdown, HeatmapKeyBreakdown{KeyID: keyID, KeyName: name, TotalTokens: total})
		}
		out = append(out, HeatmapCell{Day: parts[0], Hour: hour, TotalTokens: slots[key].tokens, ActiveSeconds: slots[key].active, KeyBreakdown: breakdown})
	}
	return out
}

func buildDevices(buckets []models.TokenUsageBucket, sessions []models.TokenUsageSession) []DeviceSummary {
	type agg struct {
		hostname string
		tokens   int
		active   int
		sessions int
		sources  map[string]bool
		lastSeen *time.Time
	}
	grouped := map[string]*agg{}
	ensure := func(id string) *agg {
		if grouped[id] == nil {
			grouped[id] = &agg{sources: map[string]bool{}}
		}
		return grouped[id]
	}
	for _, bucket := range buckets {
		row := ensure(bucket.DeviceID)
		if bucket.Hostname != "" {
			row.hostname = bucket.Hostname
		}
		row.tokens += bucket.TotalTokens
		row.sources[bucket.Source] = true
		if row.lastSeen == nil || bucket.BucketStart.After(*row.lastSeen) {
			t := bucket.BucketStart
			row.lastSeen = &t
		}
	}
	for _, session := range sessions {
		row := ensure(session.DeviceID)
		if session.Hostname != "" {
			row.hostname = session.Hostname
		}
		row.active += session.ActiveSeconds
		row.sessions++
		row.sources[session.Source] = true
		if row.lastSeen == nil || session.LastMessageAt.After(*row.lastSeen) {
			t := session.LastMessageAt
			row.lastSeen = &t
		}
	}
	out := []DeviceSummary{}
	for id, row := range grouped {
		out = append(out, DeviceSummary{DeviceID: id, Hostname: row.hostname, TotalTokens: row.tokens, ActiveSeconds: row.active, Sessions: row.sessions, Sources: len(row.sources), LastSeenAt: row.lastSeen})
	}
	sort.Slice(out, func(i, j int) bool {
		left, right := int64(0), int64(0)
		if out[i].LastSeenAt != nil {
			left = out[i].LastSeenAt.Unix()
		}
		if out[j].LastSeenAt != nil {
			right = out[j].LastSeenAt.Unix()
		}
		if left == right {
			return out[i].TotalTokens > out[j].TotalTokens
		}
		return left > right
	})
	if len(out) > 12 {
		out = out[:12]
	}
	return out
}

func rankBuckets(buckets []models.TokenUsageBucket, sessions []models.TokenUsageSession, attr string) []RankItem {
	grouped := map[string]*RankItem{}
	for _, bucket := range buckets {
		key, label := bucket.Source, bucket.Source
		if attr == "model" {
			key, label = bucket.Model, bucket.Model
		} else if attr == "project_key" {
			key, label = bucket.ProjectKey, bucket.ProjectLabel
		}
		if grouped[key] == nil {
			grouped[key] = &RankItem{Key: key, Label: label}
		}
		row := grouped[key]
		row.InputTokens += bucket.InputTokens
		row.OutputTokens += bucket.OutputTokens
		row.ReasoningTokens += bucket.ReasoningTokens
		row.CachedTokens += bucket.CachedTokens
		row.TotalTokens += bucket.TotalTokens
	}
	sessionCounts := map[string]int{}
	for _, session := range sessions {
		key := session.Source
		if attr == "project_key" {
			key = session.ProjectKey
		} else if attr == "model" {
			models := modelsFromSession(session)
			for _, model := range models {
				sessionCounts[model]++
			}
			continue
		}
		sessionCounts[key]++
	}
	for key, count := range sessionCounts {
		if grouped[key] != nil {
			grouped[key].Sessions = count
		}
	}
	out := []RankItem{}
	for _, row := range grouped {
		out = append(out, *row)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].TotalTokens == out[j].TotalTokens {
			return out[i].Label < out[j].Label
		}
		return out[i].TotalTokens > out[j].TotalTokens
	})
	if len(out) > 8 {
		out = out[:8]
	}
	return out
}

func modelsFromSession(session models.TokenUsageSession) []string {
	seen := map[string]bool{}
	var usages []map[string]any
	_ = json.Unmarshal([]byte(session.ModelUsagesJSON), &usages)
	for _, usage := range usages {
		model, _ := usage["model"].(string)
		if strings.TrimSpace(model) != "" {
			seen[model] = true
		}
	}
	if len(seen) == 0 && session.PrimaryModel != "" {
		seen[session.PrimaryModel] = true
	}
	out := sortedKeys(seen)
	return out
}

func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func defaultString(value string, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}
