import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ChatResponseStream } from './interfaces/chat.interface';

@Injectable()
export class ChatService {
  private readonly ollamaUrl: string;

  constructor(private configService: ConfigService) {
    const url = this.configService.get<string>('OLLAMA_BASE_URL');
    if (url === undefined) {
      throw new Error('OLLAMA_BASE_URL no está configurado');
    }
    this.ollamaUrl = url;
  }

  async generateResponse(prompt: string, model?: string): Promise<string> {
    const usedModel = model || this.configService.get<string>('DEFAULT_MODEL');
    
    const response = await axios.post(`${this.ollamaUrl}/api/generate`, {
      model: usedModel,
      prompt,
      stream: false,
    });

    return response.data.response;
  }

  async *generateResponseStream(prompt: string, model?: string): AsyncGenerator<ChatResponseStream> {
    const usedModel = model || this.configService.get<string>('DEFAULT_MODEL');
    
    const response = await axios.post(`${this.ollamaUrl}/api/generate`, {
      model: usedModel,
      prompt,
      stream: true,
    }, {
      responseType: 'stream',
    });

    for await (const chunk of response.data) {
      const data = chunk.toString();
      try {
        const parsedData = JSON.parse(data);
        yield parsedData;
      } catch (error) {
        console.error('Error parsing chunk:', error);
      }
    }
  }
}