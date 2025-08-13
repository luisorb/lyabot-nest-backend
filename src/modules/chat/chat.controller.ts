import { Controller, Post, Body, Sse, MessageEvent, Query, Logger } from '@nestjs/common';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dtos/send-message.dto';
import { Observable, from, map } from 'rxjs';
import { StreamResponseDto } from './dtos/stream-response.dto';
import { ApiOperation, ApiBody, ApiResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';

@ApiTags('Chat')
@Controller('chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly configService: ConfigService
  ) {}

  @ApiOperation({ summary: 'Enviar mensaje y recibir respuesta completa' })
  @ApiBody({ type: SendMessageDto })
  @ApiResponse({ status: 200, description: 'Respuesta del modelo' })
  @Post('message')
  async sendMessage(@Body() sendMessageDto: SendMessageDto) {
    try {
      this.logger.log(`Processing message for model: ${sendMessageDto.model}`);
      const response = await this.chatService.generateResponse(
        sendMessageDto.prompt,
        sendMessageDto.model,
      );
      
      return {
        success: true,
        response,
        model: sendMessageDto.model || this.configService.get<string>('DEFAULT_MODEL', 'gemma3:4b'),
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error(`Error processing message: ${error.message}`);
      throw error;
    }
  }

  @ApiOperation({ summary: 'Stream de respuesta del modelo' })
  @ApiQuery({ name: 'prompt', required: true })
  @ApiQuery({ name: 'model', required: false })
  @ApiResponse({ status: 200, description: 'Stream de eventos SSE' })
  @Sse('stream')
  streamResponse(
    @Query('prompt') prompt: string,
    @Query('model') model?: string
  ): Observable<MessageEvent> {
    try {
      const usedModel = model || this.configService.get<string>('DEFAULT_MODEL', 'gemma3:4b');
      this.logger.log(`Starting stream for model: ${usedModel}`);
      
      const stream = this.chatService.generateResponseStream(prompt, usedModel);

      return from(stream).pipe(
        map((data) => {
          const response: StreamResponseDto = {
            content: data.response,
            done: data.done,
            model: usedModel
          };
          
          if (data.done) {
            this.logger.log(`Stream completed for model: ${usedModel}`);
          }
          
          return { data: response };
        })
      );
    } catch (error) {
      this.logger.error(`Stream error: ${error.message}`);
      return new Observable(subscriber => {
        subscriber.next({
          data: {
            content: `Error: ${error.message}`,
            done: true,
            model: model || 'unknown'
          } as StreamResponseDto
        });
        subscriber.complete();
      });
    }
  }
}