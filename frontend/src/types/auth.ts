export interface AuthUser {
  id: string;
  username: string;
  email: string;
  display_name: string;
  avatar_url?: string | null;
  cover_url?: string | null;
  bio: string;
  location: string;
  role: string;
  created_at: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface UserSearchResult {
  id: string;
  username: string;
  email: string;
  display_name: string;
  status: string;
  bio: string;
  location: string;
  avatar_url?: string | null;
  cover_url?: string | null;
}

export interface AdminUser {
  id: string;
  username: string;
  email: string;
  display_name: string;
  avatar_url?: string | null;
  role: string;
  login_count: number;
  session_count: number;
  message_count: number;
  friend_count: number;
  risk_flagged: boolean;
  risk_note?: string | null;
  last_login_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminOverview {
  user_count: number;
  admin_count: number;
  active_session_count: number;
  direct_message_count: number;
  enabled_module_count: number;
  disabled_module_count: number;
}

export interface AdminAuditLog {
  id: number;
  actor_id: string;
  actor_name: string;
  action: string;
  target_type: string;
  target_id: string;
  detail?: string | null;
  created_at: string;
}

export interface SignInPayload {
  identifier: string;
  password: string;
}

export interface SignUpPayload {
  username: string;
  email: string;
  password: string;
  display_name?: string;
}

export interface AccountUpdatePayload {
  display_name?: string;
  email?: string;
  bio?: string;
  location?: string;
}

export interface AvatarUploadPayload {
  filename: string;
  content_type: string;
  data_base64: string;
}

export type ProfileCoverUploadPayload = AvatarUploadPayload;

export interface PasswordChangePayload {
  current_password: string;
  new_password: string;
}

export interface BoundPlatform {
  id: string;
  name: string;
  description: string;
  status: "active" | "empty" | string;
  detail: string;
}

export interface PlatformSummary {
  platforms: BoundPlatform[];
}
