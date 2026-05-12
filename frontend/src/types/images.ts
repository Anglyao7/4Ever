export interface ImageGenerationConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  size: string;
  prompt: string;
}

export interface ImageGenerationResponse {
  status: string;
  message: string;
}

