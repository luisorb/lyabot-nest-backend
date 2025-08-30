import { Controller, Post, Body, Sse, MessageEvent, Query, Logger, Get } from '@nestjs/common';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dtos/send-message.dto';
import { Observable, from, map } from 'rxjs';
import { StreamResponseDto } from './dtos/stream-response.dto';
import { ApiOperation, ApiBody, ApiResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { EnhancedMessageDto } from './dtos/enhanced-message.dto';

@ApiTags('Chat')
@Controller('chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);
  private conversationContext = new Map<string, string[]>();

  constructor(
    private readonly chatService: ChatService,
    private readonly configService: ConfigService
  ) {}

  private getDefaultModel(): string {
    return this.configService.get<string>('DEFAULT_MODEL', 'gemma3:4b');
  }

  @ApiOperation({ summary: 'Enviar mensaje y recibir respuesta completa' })
  @ApiBody({ type: SendMessageDto })
  @ApiResponse({ status: 200, description: 'Respuesta del modelo' })
  @Post('message')
  async sendMessage(@Body() sendMessageDto: SendMessageDto) {
    try {
    const usedModel = sendMessageDto.model || this.getDefaultModel();
    this.logger.log(`Processing message for model: ${usedModel}`);
    
    const response = await this.chatService.generateResponse(
      sendMessageDto.prompt,
      usedModel,
      sendMessageDto.temperature,
      sendMessageDto.maxTokens
    );
    
    return {
      success: true,
      response: response.response,
      model: usedModel,
      timestamp: new Date().toISOString(),
      tokens: {
            prompt: response.promptTokens,
            completion: response.completionTokens,
            total: response.totalTokens
          }
    };
    } catch (error) {
    this.logger.error(`Error processing message: ${error.message}`);
    throw error;
    }
  }

  @ApiOperation({ summary: 'Respuesta mejorada con contexto y post-procesamiento' })
  @ApiBody({ type: EnhancedMessageDto })
  @Post('enhanced-message')
  async sendEnhancedMessage(@Body() enhancedMessageDto: EnhancedMessageDto) {
    try {
    const usedModel = enhancedMessageDto.model || this.getDefaultModel();
    const { prompt, temperature, maxTokens, sessionId = 'default', useContext = true } = enhancedMessageDto;
    
    this.logger.log(`Processing enhanced message for session: ${sessionId}`);
    
    let context: string[] = [];
    if (useContext) {
      context = this.getConversationContext(sessionId);
    }

    const response = await this.chatService.generateEnhancedResponse(
      prompt,
      usedModel,
      temperature,
      maxTokens,
      context
    );

    // Actualizar contexto si está habilitado
    if (useContext) {
      this.updateContext(sessionId, prompt, response);
    }

    return {
      success: true,
      response: response.content,
      model: usedModel,
      timestamp: new Date().toISOString(),
      contextLength: context.length,
      formatted: response.formatted,
      tokens: response.tokens
    };
    } catch (error) {
    this.logger.error(`Error in enhanced message: ${error.message}`);
    throw error;
    }
  }

  @ApiOperation({ summary: 'Stream de respuesta del modelo' })
  @ApiQuery({ name: 'prompt', required: true })
  @ApiQuery({ name: 'model', required: false })
  @ApiQuery({ name: 'temperature', required: false, type: Number })
  @ApiQuery({ name: 'maxTokens', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Stream de eventos SSE' })
  @Sse('stream')
  streamResponse(
    @Query('prompt') prompt: string,
    @Query('model') model?: string,
    @Query('temperature') temperature?: number,
    @Query('maxTokens') maxTokens?: number
  ): Observable<MessageEvent> {
    try {
    const usedModel = model || this.getDefaultModel();
    this.logger.log(`Starting stream for model: ${usedModel}`);
    
    const stream = this.chatService.generateResponseStream(
      prompt, 
      usedModel, 
      temperature, 
      maxTokens
    );

    return from(stream).pipe(
      map((data) => {
      const response: StreamResponseDto = {
        content: data.response,
        done: data.done,
        model: usedModel,
        tokens: data.tokens
      };
      
       if (data.done) {
          const totalTokens = data.tokens?.total ?? 'N/A';
          const speed = data.tokens?.speed ?? 'N/A';
          this.logger.log(`Stream completed for model: ${usedModel}. Tokens: ${totalTokens} - Speed: ${speed} t/s`);
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
        model: model || 'unknown',
        error: error.message
      } as StreamResponseDto
      });
      subscriber.complete();
    });
    }
  }

  @ApiOperation({ summary: 'Limpiar contexto de conversación' })
  @ApiQuery({ name: 'sessionId', required: false })
  @Get('clear-context')
  clearContext(@Query('sessionId') sessionId?: string) {
    const targetSessionId = sessionId || 'default';
    this.conversationContext.delete(targetSessionId);
    return {
      success: true,
      message: `Contexto limpiado para sesión: ${targetSessionId}`,
      timestamp: new Date().toISOString()
    };
  }

  @ApiOperation({ summary: 'Obtener información del contexto' })
  @ApiQuery({ name: 'sessionId', required: false })
  @Get('context-info')
  getContextInfo(@Query('sessionId') sessionId?: string) {
    const targetSessionId = sessionId || 'default';
    const context = this.conversationContext.get(targetSessionId) || [];
    
    return {
      sessionId: targetSessionId,
      contextLength: context.length,
      messages: context,
      timestamp: new Date().toISOString()
    };
  }

  private getConversationContext(sessionId: string): string[] {
    return this.conversationContext.get(sessionId) || [];
  }

  private updateContext(sessionId: string, prompt: string, response: any) {
    const context = this.getConversationContext(sessionId);
    context.push(`Usuario: ${prompt}`, `Asistente: ${response.content}`);
    
    // Limitar tamaño del contexto (últimos 6 mensajes)
    if (context.length > 6) {
      context.splice(0, 2);
    }
    
    this.conversationContext.set(sessionId, context);
  }
}