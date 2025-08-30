import { TokenMetrics } from '../interfaces/chat.interface';

export class StreamResponseDto {
  content: string;
  done: boolean;
  model?: string;
  error?: string;
  tokens?: TokenMetrics;
}