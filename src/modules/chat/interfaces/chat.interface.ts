export interface TokenMetrics {
  prompt: number;
  completion: number;
  total: number;
  speed?: string; // Tasa de tokens por segundo
}

export interface ChatResponseStream {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  tokens?: TokenMetrics;
}

export interface EnhancedResponse {
  content: string;
  formatted: any;
  tokens?: TokenMetrics;
  model: string;
}

export interface ModelConfig {
  temperature: number;
  maxTokens: number;
}