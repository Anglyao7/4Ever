package maps

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"4ever/backend/internal/config"
	"4ever/backend/internal/httputil"
	"github.com/gin-gonic/gin"
)

const tencentSuggestionURL = "https://apis.map.qq.com/ws/place/v1/suggestion"

type Handler struct {
	Settings config.Settings
}

type CityResult struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	Region string  `json:"region"`
	Lat    float64 `json:"lat"`
	Lon    float64 `json:"lon"`
}

func Register(group *gin.RouterGroup, h Handler) {
	r := group.Group("/maps")
	r.GET("/tencent/config", h.Config)
	r.GET("/tencent/city-search", h.CitySearch)
}

func (h Handler) Config(c *gin.Context) {
	if h.Settings.TencentMapKey == "" {
		httputil.Error(c, http.StatusServiceUnavailable, "Tencent map key is not configured.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"map_key": h.Settings.TencentMapKey})
}

func (h Handler) CitySearch(c *gin.Context) {
	rawQuery, exists := c.GetQuery("q")
	if !exists {
		httputil.Error(c, http.StatusUnprocessableEntity, "q is required.")
		return
	}
	if len([]rune(rawQuery)) > 80 {
		httputil.Error(c, http.StatusUnprocessableEntity, "q must be 80 characters or fewer.")
		return
	}
	if h.Settings.TencentMapKey == "" {
		httputil.Error(c, http.StatusServiceUnavailable, "Tencent map key is not configured.")
		return
	}
	keyword := strings.TrimSpace(rawQuery)
	if keyword == "" {
		c.JSON(http.StatusOK, gin.H{"results": []CityResult{}})
		return
	}
	params := map[string]string{
		"keyword":    keyword,
		"key":        h.Settings.TencentMapKey,
		"region":     "中国",
		"region_fix": "0",
		"policy":     "1",
		"page_size":  "10",
	}
	if h.Settings.TencentMapSignatureKey != "" {
		params["sig"] = tencentSignature(params, h.Settings.TencentMapSignatureKey)
	}
	values := url.Values{}
	for key, value := range params {
		values.Set(key, value)
	}
	client := http.Client{Timeout: 8 * time.Second}
	resp, err := client.Get(tencentSuggestionURL + "?" + values.Encode())
	if err != nil {
		httputil.Error(c, http.StatusBadGateway, "Tencent city search failed.")
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		httputil.Error(c, http.StatusBadGateway, "Tencent city search failed.")
		return
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		httputil.Error(c, http.StatusBadGateway, "Tencent city search failed.")
		return
	}
	if fmt.Sprint(payload["status"]) != "0" && payload["status"] != float64(0) {
		message := fmt.Sprint(payload["message"])
		if message == "" || message == "<nil>" {
			message = "Tencent city search failed."
		}
		httputil.Error(c, http.StatusBadGateway, message)
		return
	}
	results := []CityResult{}
	seen := map[string]bool{}
	items, _ := payload["data"].([]any)
	for _, item := range items {
		row, ok := item.(map[string]any)
		if !ok {
			continue
		}
		location, _ := row["location"].(map[string]any)
		lat, ok1 := numberValue(location["lat"])
		lon, ok2 := numberValue(location["lng"])
		title := strings.TrimSpace(fmt.Sprint(row["title"]))
		if title == "" || !ok1 || !ok2 {
			continue
		}
		parts := []string{}
		used := map[string]bool{}
		for _, key := range []string{"province", "city", "district"} {
			value := strings.TrimSpace(fmt.Sprint(row[key]))
			if value != "" && value != "<nil>" && !used[value] {
				parts = append(parts, value)
				used[value] = true
			}
		}
		region := strings.Join(parts, " · ")
		if region == "" {
			region = strings.TrimSpace(fmt.Sprint(row["address"]))
		}
		if region == "" || region == "<nil>" {
			region = "中国"
		}
		id := fmt.Sprintf("tencent:%s:%.6f:%.6f", title, lat, lon)
		if seen[id] {
			continue
		}
		seen[id] = true
		results = append(results, CityResult{ID: id, Name: title, Region: region, Lat: lat, Lon: lon})
	}
	c.JSON(http.StatusOK, gin.H{"results": results})
}

func tencentSignature(params map[string]string, key string) string {
	keys := make([]string, 0, len(params))
	for name := range params {
		keys = append(keys, name)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, name := range keys {
		parts = append(parts, name+"="+params[name])
	}
	sum := md5.Sum([]byte("/ws/place/v1/suggestion?" + strings.Join(parts, "&") + key))
	return hex.EncodeToString(sum[:])
}

func numberValue(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case int:
		return float64(typed), true
	default:
		return 0, false
	}
}
