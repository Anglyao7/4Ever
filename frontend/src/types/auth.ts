export interface AuthUser {
  id: string;
  username: string;
  email: string;
  display_name: string;
  avatar_url?: string | null;
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
  avatar_url?: string | null;
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
}

export interface AvatarUploadPayload {
  filename: string;
  content_type: string;
  data_base64: string;
}

export interface PasswordChangePayload {
  current_password: string;
  new_password: string;
}
