export interface ImageGenerationConfig {
  profileId?: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  size: string;
  prompt: string;
}

export interface GeneratedImage {
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
}

export interface ImageGenerationResponse {
  status: string;
  message: string;
  images?: GeneratedImage[];
  prompt?: string;
}
