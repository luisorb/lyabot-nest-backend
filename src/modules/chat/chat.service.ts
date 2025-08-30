import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ChatResponseStream, EnhancedResponse } from './interfaces/chat.interface';

@Injectable()
export class ChatService {
  private readonly ollamaUrl: string;
  private readonly logger = new Logger(ChatService.name);
  private responseMetrics = new Map<string, { total: number; successful: number }>();

  constructor(private configService: ConfigService) {
     const url = this.configService.get<string>('OLLAMA_BASE_URL');
    if (url === undefined) {
       throw new Error('OLLAMA_BASE_URL no está configurado');
     }
     this.ollamaUrl = url;
   }

  private getDefaultModel(): string {
     return this.configService.get<string>('DEFAULT_MODEL', 'gemma3:4b');
  }

  private enhancePrompt(userPrompt: string, context: string[] = []): string {
    const contextText = context.length > 0 
      ? `Contexto de la conversación:\n${context.join('\n')}\n\n`
      : '';

    return `${contextText}Eres un asistente AI útil, preciso y profesional. Responde en el mismo idioma que el usuario.

Instrucciones importantes:
- Proporciona respuestas claras, concisas y bien estructuradas
- Si es una pregunta técnica, sé preciso y detallado
- Si es una pregunta creativa, sé innovador pero coherente
- Mantén un tono profesional pero amigable
- Organiza la información de manera lógica usando párrafos y listas cuando sea apropiado
- Verifica la coherencia de tu respuesta
- Puedes utilizar emojis la respuesta

Prompt del usuario: "${userPrompt}"

Por favor, genera una respuesta de alta calidad:`;
  }

async generateResponse(
  prompt: string, 
  model?: string, 
  temperature?: number, 
  maxTokens?: number
 ): Promise<{ response: string; promptTokens: number; completionTokens: number; totalTokens: number }> {
  const usedModel = model || this.getDefaultModel();
  const config = this.getModelConfig(usedModel, temperature, maxTokens);
  
  const response = await axios.post(`${this.ollamaUrl}/api/generate`, {
   model: usedModel,
   prompt,
   stream: false,
   options: {
    temperature: config.temperature,
    num_predict: config.maxTokens,
    top_p: 0.9,
    repeat_penalty: 1.1
   }
  });

  this.trackResponseQuality(usedModel, true);

    const promptTokens = response.data.prompt_eval_count;
    const completionTokens = response.data.eval_count;
    const totalTokens = promptTokens + completionTokens;

  return {
      response: response.data.response,
      promptTokens,
      completionTokens,
      totalTokens
    };
 }

 async generateEnhancedResponse(
  prompt: string, 
  model?: string, 
  temperature?: number, 
  maxTokens?: number,
  context: string[] = []
 ): Promise<EnhancedResponse> {
  const usedModel = model || this.getDefaultModel();
  const config = this.getModelConfig(usedModel, temperature, maxTokens);
  const enhancedPrompt = this.enhancePrompt(prompt, context);

  try {
   const response = await axios.post(`${this.ollamaUrl}/api/generate`, {
    model: usedModel,
    prompt: enhancedPrompt,
    stream: false,
    options: {
     temperature: config.temperature,
     num_predict: config.maxTokens,
     top_p: 0.9,
     repeat_penalty: 1.1
    }
   });

   const rawResponse = response.data.response;
   const processedResponse = this.postProcessResponse(rawResponse);

   this.trackResponseQuality(usedModel, true);

   // Captura los conteos de tokens de la respuesta de Ollama
   const promptTokens = response.data.prompt_eval_count;
   const completionTokens = response.data.eval_count;
   const totalTokens = promptTokens + completionTokens;
      const totalDuration = response.data.total_duration || 1; // Prevenir división por cero
      const tokensPerSecond = (completionTokens / (totalDuration / 1e9)).toFixed(2); // Convertir ns a s

   return {
    content: processedResponse,
    formatted: this.formatResponse(processedResponse),
    tokens: {
     prompt: promptTokens,
     completion: completionTokens,
     total: totalTokens,
     speed: tokensPerSecond // Añade la velocidad de tokens
    },
    model: usedModel
   };
  } catch (error) {
   this.trackResponseQuality(usedModel, false);
   this.logger.error(`Enhanced response error: ${error.message}`);
   throw error;
  }
 }

 async *generateResponseStream(
  prompt: string, 
  model?: string, 
  temperature?: number, 
  maxTokens?: number
 ): AsyncGenerator<ChatResponseStream> {
  const usedModel = model || this.getDefaultModel();
  const config = this.getModelConfig(usedModel, temperature, maxTokens);
  
  const response = await axios.post(`${this.ollamaUrl}/api/generate`, {
   model: usedModel,
   prompt,
   stream: true,
   options: {
    temperature: config.temperature,
    num_predict: config.maxTokens,
    top_p: 0.9,
    repeat_penalty: 1.1
   }
  }, {
   responseType: 'stream',
  });

    let completionTokens = 0;
    let promptTokens = 0;
    const startTime = Date.now();

  for await (const chunk of response.data) {
   const data = chunk.toString();
   try {
    const parsedData = JSON.parse(data);

        // Los tokens de la respuesta se acumulan en cada chunk
        if (parsedData.eval_count) {
            completionTokens = parsedData.eval_count;
        }

        // Los tokens del prompt solo vienen en el último chunk
        if (parsedData.done && parsedData.prompt_eval_count) {
            promptTokens = parsedData.prompt_eval_count;
        }

        const elapsedSeconds = (Date.now() - startTime) / 1000;
        const tokensPerSecond = elapsedSeconds > 0 ? (completionTokens / elapsedSeconds).toFixed(2) : '0';

    yield {
     ...parsedData,
     tokens: {
            prompt: promptTokens,
            completion: completionTokens,
            total: promptTokens + completionTokens,
            speed: tokensPerSecond // Añade la velocidad de tokens en cada chunk
          }
    };
   } catch (error) {
    this.logger.error('Error parsing chunk:', error);
   }
  }

  this.trackResponseQuality(usedModel, true);
 }

  private getModelConfig(model: string, temperature?: number, maxTokens?: number) {
    const defaultConfigs: { [key: string]: { temperature: number; maxTokens: number } } = {
      'gemma3:4b': { temperature: 0.7, maxTokens: 2000 },
      'llama3': { temperature: 0.6, maxTokens: 3000 },
      'mistral': { temperature: 0.5, maxTokens: 2500 },
      'default': { temperature: 0.3, maxTokens: 1500 }
    };

    const config = defaultConfigs[model] || defaultConfigs.default;
    
    return {
      temperature: temperature !== undefined ? temperature : config.temperature,
      maxTokens: maxTokens !== undefined ? maxTokens : config.maxTokens
    };
  }

  private postProcessResponse(response: string): string {
    // Limpiar y formatear la respuesta
    let processed = response
      .replace(/\n\s*\n/g, '\n\n') // Normalizar saltos de línea
      .replace(/^\s+|\s+$/g, '')   // Trim espacios
      .replace(/([.!?])\s*/g, '$1 '); // Normalizar espacios después de puntuación

    // Asegurar que la respuesta tenga una estructura adecuada
    if (processed.length > 150 && !processed.includes('\n\n')) {
      processed = this.formatLongResponse(processed);
    }

    return processed;
  }

  private formatLongResponse(text: string): string {
    const sentences = text.split('. ');
    let formatted = '';
    let currentParagraph = '';

    for (const sentence of sentences) {
      if (currentParagraph.length + sentence.length > 120) {
        formatted += currentParagraph + '.\n\n';
        currentParagraph = sentence;
      } else {
        currentParagraph += (currentParagraph ? '. ' : '') + sentence;
      }
    }

    return formatted + currentParagraph + (currentParagraph.endsWith('.') ? '' : '.');
  }

  private formatResponse(response: string): any {
    const isLongResponse = response.length > 200 || response.includes('\n');
    
    return {
      type: isLongResponse ? 'detailed' : 'simple',
      content: response,
      summary: isLongResponse ? response.substring(0, 150) + '...' : response,
      length: response.length
    };
  }

  private trackResponseQuality(model: string, success: boolean) {
    const key = `${model}-${new Date().toISOString().split('T')[0]}`;
    const metrics = this.responseMetrics.get(key) || { total: 0, successful: 0 };
    
    metrics.total++;
    if (success) metrics.successful++;
    
    this.responseMetrics.set(key, metrics);
    
    this.logger.log(`Model: ${model}, Success: ${success}, Success Rate: ${((metrics.successful / metrics.total) * 100).toFixed(1)}%`);
  }

  getMetrics(): any {
    const metrics: any = {};
    this.responseMetrics.forEach((value, key) => {
      metrics[key] = {
        ...value,
        successRate: ((value.successful / value.total) * 100).toFixed(1) + '%'
      };
    });
    return metrics;
  }
}