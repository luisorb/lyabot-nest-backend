export interface ChatResponseStream {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
}