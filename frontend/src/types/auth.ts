export interface AuthUser {
  id: string;
  username: string;
  email: string;
  display_name: string;
  role: string;
  created_at: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
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

export interface PasswordChangePayload {
  current_password: string;
  new_password: string;
}
