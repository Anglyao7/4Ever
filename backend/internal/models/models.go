package models

import "time"

type User struct {
	ID           string     `gorm:"column:id;size:64;primaryKey"`
	Username     string     `gorm:"column:username;size:80;uniqueIndex;not null"`
	Email        string     `gorm:"column:email;size:160;uniqueIndex;not null"`
	DisplayName  string     `gorm:"column:display_name;size:120;not null"`
	AvatarPath   *string    `gorm:"column:avatar_path;size:500"`
	PasswordHash string     `gorm:"column:password_hash;size:240;not null"`
	Role         string     `gorm:"column:role;size:40;not null;default:member"`
	LoginCount   int        `gorm:"column:login_count;not null;default:0"`
	LastLoginAt  *time.Time `gorm:"column:last_login_at"`
	CreatedAt    time.Time  `gorm:"column:created_at;autoCreateTime"`
	UpdatedAt    time.Time  `gorm:"column:updated_at;autoUpdateTime"`
}

func (User) TableName() string { return "users" }

type AuthSession struct {
	ID        uint      `gorm:"column:id;primaryKey;autoIncrement"`
	UserID    string    `gorm:"column:user_id;size:64;index;not null"`
	TokenHash string    `gorm:"column:token_hash;size:128;uniqueIndex;not null"`
	CreatedAt time.Time `gorm:"column:created_at;autoCreateTime"`
}

func (AuthSession) TableName() string { return "auth_sessions" }

type ModelProfile struct {
	ID           string    `gorm:"column:id;size:64;primaryKey"`
	Name         string    `gorm:"column:name;size:120;not null"`
	Provider     string    `gorm:"column:provider;size:40;not null"`
	BaseURL      string    `gorm:"column:base_url;size:500;not null"`
	APIKey       *string   `gorm:"column:api_key;type:text"`
	Model        string    `gorm:"column:model;size:160;not null"`
	SystemPrompt *string   `gorm:"column:system_prompt;type:text"`
	Temperature  float64   `gorm:"column:temperature;not null;default:0.7"`
	MaxTokens    int       `gorm:"column:max_tokens;not null;default:1024"`
	CreatedAt    time.Time `gorm:"column:created_at;autoCreateTime"`
	UpdatedAt    time.Time `gorm:"column:updated_at;autoUpdateTime"`
}

func (ModelProfile) TableName() string { return "model_profiles" }

type ModuleSetting struct {
	ModuleID  string    `gorm:"column:module_id;size:64;primaryKey"`
	Enabled   bool      `gorm:"column:enabled;not null;default:true"`
	Locked    bool      `gorm:"column:locked;not null;default:false"`
	CreatedAt time.Time `gorm:"column:created_at;autoCreateTime"`
	UpdatedAt time.Time `gorm:"column:updated_at;autoUpdateTime"`
}

func (ModuleSetting) TableName() string { return "module_settings" }

type MCPServerSetting struct {
	ServerID  string    `gorm:"column:server_id;size:120;primaryKey"`
	Enabled   bool      `gorm:"column:enabled;not null;default:true"`
	CreatedAt time.Time `gorm:"column:created_at;autoCreateTime"`
	UpdatedAt time.Time `gorm:"column:updated_at;autoUpdateTime"`
}

func (MCPServerSetting) TableName() string { return "mcp_server_settings" }

type AgentPromptSetting struct {
	AgentID       string    `gorm:"column:agent_id;size:120;primaryKey"`
	PromptVersion string    `gorm:"column:prompt_version;size:80;not null;default:''"`
	SystemPrompt  string    `gorm:"column:system_prompt;type:text;not null;default:''"`
	UpdatedBy     *string   `gorm:"column:updated_by;size:64"`
	CreatedAt     time.Time `gorm:"column:created_at;autoCreateTime"`
	UpdatedAt     time.Time `gorm:"column:updated_at;autoUpdateTime"`
}

func (AgentPromptSetting) TableName() string { return "agent_prompt_settings" }

type AdminAuditLog struct {
	ID         uint      `gorm:"column:id;primaryKey;autoIncrement"`
	ActorID    string    `gorm:"column:actor_id;size:64;index;not null"`
	Action     string    `gorm:"column:action;size:80;not null"`
	TargetType string    `gorm:"column:target_type;size:40;not null"`
	TargetID   string    `gorm:"column:target_id;size:120;not null"`
	Detail     *string   `gorm:"column:detail;type:text"`
	CreatedAt  time.Time `gorm:"column:created_at;autoCreateTime"`
}

func (AdminAuditLog) TableName() string { return "admin_audit_logs" }

type AdminUserFlag struct {
	UserID      string    `gorm:"column:user_id;size:64;primaryKey"`
	RiskFlagged bool      `gorm:"column:risk_flagged;not null;default:false"`
	Note        *string   `gorm:"column:note;type:text"`
	UpdatedBy   *string   `gorm:"column:updated_by;size:64"`
	UpdatedAt   time.Time `gorm:"column:updated_at;autoUpdateTime"`
}

func (AdminUserFlag) TableName() string { return "admin_user_flags" }

type ChatMessage struct {
	ID        uint      `gorm:"column:id;primaryKey;autoIncrement"`
	ThreadID  string    `gorm:"column:thread_id;size:80;index;not null"`
	Role      string    `gorm:"column:role;size:20;not null"`
	Content   string    `gorm:"column:content;type:text;not null"`
	CreatedAt time.Time `gorm:"column:created_at;autoCreateTime"`
}

func (ChatMessage) TableName() string { return "chat_messages" }

type WorkflowAgentRun struct {
	ID                  string     `gorm:"column:id;size:80;primaryKey"`
	ThreadID            string     `gorm:"column:thread_id;size:120;index;not null;default:''"`
	CheckpointID        string     `gorm:"column:checkpoint_id;size:120;not null;default:''"`
	TemplateID          string     `gorm:"column:template_id;size:120;index;not null"`
	AgentID             string     `gorm:"column:agent_id;size:120;index;not null"`
	AgentPromptVersion  string     `gorm:"column:agent_prompt_version;size:80;not null;default:''"`
	AgentPromptChecksum string     `gorm:"column:agent_prompt_checksum;size:80;not null;default:''"`
	Status              string     `gorm:"column:status;size:24;not null;default:success"`
	GraphStepsJSON      string     `gorm:"column:graph_steps_json;type:text;not null;default:'[]'"`
	EventsJSON          string     `gorm:"column:events_json;type:text;not null;default:'[]'"`
	MCPServerIDsJSON    string     `gorm:"column:mcp_server_ids_json;type:text;not null"`
	InputJSON           string     `gorm:"column:input_json;type:text;not null"`
	CanvasJSON          string     `gorm:"column:canvas_json;type:text;not null;default:''"`
	NodeResultsJSON     string     `gorm:"column:node_results_json;type:text;not null"`
	ReviewStatus        string     `gorm:"column:review_status;size:24;not null;default:not_required"`
	ReviewNote          string     `gorm:"column:review_note;type:text;not null;default:''"`
	ReviewedAt          *time.Time `gorm:"column:reviewed_at"`
	StartedAt           time.Time  `gorm:"column:started_at;not null"`
	EndedAt             *time.Time `gorm:"column:ended_at"`
	CreatedAt           time.Time  `gorm:"column:created_at;autoCreateTime"`
}

func (WorkflowAgentRun) TableName() string { return "workflow_agent_runs" }

type WorkflowAgentCheckpoint struct {
	ID             uint      `gorm:"column:id;primaryKey;autoIncrement"`
	RunID          string    `gorm:"column:run_id;size:80;index;not null;uniqueIndex:uq_workflow_agent_checkpoint_step"`
	ThreadID       string    `gorm:"column:thread_id;size:120;index;not null;default:''"`
	CheckpointID   string    `gorm:"column:checkpoint_id;size:160;index;not null"`
	GraphStep      string    `gorm:"column:graph_step;size:80;not null;uniqueIndex:uq_workflow_agent_checkpoint_step"`
	NodeID         string    `gorm:"column:node_id;size:120;not null;default:''"`
	Status         string    `gorm:"column:status;size:24;not null;default:success"`
	StateJSON      string    `gorm:"column:state_json;type:text;not null;default:'{}'"`
	NodeResultJSON string    `gorm:"column:node_result_json;type:text;not null;default:'{}'"`
	EventsJSON     string    `gorm:"column:events_json;type:text;not null;default:'[]'"`
	CreatedAt      time.Time `gorm:"column:created_at;autoCreateTime"`
}

func (WorkflowAgentCheckpoint) TableName() string { return "workflow_agent_checkpoints" }

type DirectMessage struct {
	ID                 uint      `gorm:"column:id;primaryKey;autoIncrement"`
	SenderID           string    `gorm:"column:sender_id;size:64;index;not null"`
	RecipientID        string    `gorm:"column:recipient_id;size:64;index;not null"`
	Content            string    `gorm:"column:content;type:text;not null"`
	AttachmentsJSON    *string   `gorm:"column:attachments_json;type:text"`
	ReplyToMessageID   *uint     `gorm:"column:reply_to_message_id"`
	ReplyToPreviewJSON *string   `gorm:"column:reply_to_preview_json;type:text"`
	CreatedAt          time.Time `gorm:"column:created_at;autoCreateTime"`
}

func (DirectMessage) TableName() string { return "direct_messages" }

type FriendRequest struct {
	ID          uint       `gorm:"column:id;primaryKey;autoIncrement"`
	RequesterID string     `gorm:"column:requester_id;size:64;index;not null;uniqueIndex:uq_friend_request_pair"`
	AddresseeID string     `gorm:"column:addressee_id;size:64;index;not null;uniqueIndex:uq_friend_request_pair"`
	Status      string     `gorm:"column:status;size:20;not null;default:pending"`
	CreatedAt   time.Time  `gorm:"column:created_at;autoCreateTime"`
	RespondedAt *time.Time `gorm:"column:responded_at"`
}

func (FriendRequest) TableName() string { return "friend_requests" }

type Friendship struct {
	ID        uint      `gorm:"column:id;primaryKey;autoIncrement"`
	UserAID   string    `gorm:"column:user_a_id;size:64;index;not null;uniqueIndex:uq_friendship_pair"`
	UserBID   string    `gorm:"column:user_b_id;size:64;index;not null;uniqueIndex:uq_friendship_pair"`
	CreatedAt time.Time `gorm:"column:created_at;autoCreateTime"`
}

func (Friendship) TableName() string { return "friendships" }

type TokenUsageAPIKey struct {
	ID         string     `gorm:"column:id;size:80;primaryKey"`
	UserID     string     `gorm:"column:user_id;size:64;index;not null"`
	Name       string     `gorm:"column:name;size:120;not null"`
	Prefix     string     `gorm:"column:prefix;size:24;index;not null"`
	KeyHash    string     `gorm:"column:key_hash;size:128;uniqueIndex;not null"`
	RawKey     *string    `gorm:"column:raw_key;type:text"`
	Status     string     `gorm:"column:status;size:24;not null;default:active"`
	LastUsedAt *time.Time `gorm:"column:last_used_at"`
	CreatedAt  time.Time  `gorm:"column:created_at;autoCreateTime"`
	UpdatedAt  time.Time  `gorm:"column:updated_at;autoUpdateTime"`
}

func (TokenUsageAPIKey) TableName() string { return "token_usage_api_keys" }

type TokenUsageBucket struct {
	ID               uint      `gorm:"column:id;primaryKey;autoIncrement"`
	UserID           string    `gorm:"column:user_id;size:64;index;not null;uniqueIndex:uq_token_usage_bucket_scope"`
	APIKeyID         *string   `gorm:"column:api_key_id;size:80;uniqueIndex:uq_token_usage_bucket_scope"`
	DeviceID         string    `gorm:"column:device_id;size:120;index;not null;uniqueIndex:uq_token_usage_bucket_scope"`
	Hostname         string    `gorm:"column:hostname;size:160;not null;default:''"`
	Source           string    `gorm:"column:source;size:80;index;not null;uniqueIndex:uq_token_usage_bucket_scope"`
	Model            string    `gorm:"column:model;size:160;index;not null;uniqueIndex:uq_token_usage_bucket_scope"`
	ProjectKey       string    `gorm:"column:project_key;size:160;index;not null;uniqueIndex:uq_token_usage_bucket_scope"`
	ProjectLabel     string    `gorm:"column:project_label;size:240;not null;default:''"`
	BucketStart      time.Time `gorm:"column:bucket_start;index;not null;uniqueIndex:uq_token_usage_bucket_scope"`
	InputTokens      int       `gorm:"column:input_tokens;not null;default:0"`
	OutputTokens     int       `gorm:"column:output_tokens;not null;default:0"`
	ReasoningTokens  int       `gorm:"column:reasoning_tokens;not null;default:0"`
	CachedTokens     int       `gorm:"column:cached_tokens;not null;default:0"`
	TotalTokens      int       `gorm:"column:total_tokens;not null;default:0"`
	EstimatedCostUSD *float64  `gorm:"column:estimated_cost_usd"`
	CreatedAt        time.Time `gorm:"column:created_at;autoCreateTime"`
	UpdatedAt        time.Time `gorm:"column:updated_at;autoUpdateTime"`
}

func (TokenUsageBucket) TableName() string { return "token_usage_buckets" }

type TokenUsageSession struct {
	ID               uint      `gorm:"column:id;primaryKey;autoIncrement"`
	UserID           string    `gorm:"column:user_id;size:64;index;not null;uniqueIndex:uq_token_usage_session_scope"`
	APIKeyID         *string   `gorm:"column:api_key_id;size:80;uniqueIndex:uq_token_usage_session_scope"`
	DeviceID         string    `gorm:"column:device_id;size:120;index;not null;uniqueIndex:uq_token_usage_session_scope"`
	Hostname         string    `gorm:"column:hostname;size:160;not null;default:''"`
	Source           string    `gorm:"column:source;size:80;index;not null;uniqueIndex:uq_token_usage_session_scope"`
	ProjectKey       string    `gorm:"column:project_key;size:160;index;not null"`
	ProjectLabel     string    `gorm:"column:project_label;size:240;not null;default:''"`
	SessionHash      string    `gorm:"column:session_hash;size:120;index;not null;uniqueIndex:uq_token_usage_session_scope"`
	FirstMessageAt   time.Time `gorm:"column:first_message_at;index;not null"`
	LastMessageAt    time.Time `gorm:"column:last_message_at;not null"`
	DurationSeconds  int       `gorm:"column:duration_seconds;not null;default:0"`
	ActiveSeconds    int       `gorm:"column:active_seconds;not null;default:0"`
	MessageCount     int       `gorm:"column:message_count;not null;default:0"`
	UserMessageCount int       `gorm:"column:user_message_count;not null;default:0"`
	InputTokens      int       `gorm:"column:input_tokens;not null;default:0"`
	OutputTokens     int       `gorm:"column:output_tokens;not null;default:0"`
	ReasoningTokens  int       `gorm:"column:reasoning_tokens;not null;default:0"`
	CachedTokens     int       `gorm:"column:cached_tokens;not null;default:0"`
	TotalTokens      int       `gorm:"column:total_tokens;not null;default:0"`
	PrimaryModel     string    `gorm:"column:primary_model;size:160;not null;default:''"`
	ModelUsagesJSON  string    `gorm:"column:model_usages_json;type:text;not null;default:'[]'"`
	CreatedAt        time.Time `gorm:"column:created_at;autoCreateTime"`
	UpdatedAt        time.Time `gorm:"column:updated_at;autoUpdateTime"`
}

func (TokenUsageSession) TableName() string { return "token_usage_sessions" }
