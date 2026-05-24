export interface PlatformModule {
  id: string;
  name: string;
  description: string;
  category: string;
  enabled?: boolean;
  locked?: boolean;
}

export interface AdminModule {
  id: string;
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  locked: boolean;
}

export interface TencentMapConfig {
  map_key: string;
}
