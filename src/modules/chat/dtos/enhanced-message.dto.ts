import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNumber, IsBoolean, IsOptional, Min, Max } from 'class-validator';

export class EnhancedMessageDto {
  @ApiProperty({ description: 'Prompt del usuario' })
  @IsString()
  prompt: string;

  @ApiPropertyOptional({ description: 'Modelo a utilizar' })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({ 
    description: 'Temperatura (0.1-2.0)',
    minimum: 0.1,
    maximum: 2.0
  })
  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(2.0)
  temperature?: number;

  @ApiPropertyOptional({ 
    description: 'Máximo número de tokens',
    minimum: 50,
    maximum: 4000
  })
  @IsOptional()
  @IsNumber()
  @Min(50)
  @Max(4000)
  maxTokens?: number;

  @ApiPropertyOptional({ description: 'ID de sesión para contexto' })
  @IsOptional()
  @IsString()
  sessionId?: string;

  @ApiPropertyOptional({ description: 'Usar contexto de conversación' })
  @IsOptional()
  @IsBoolean()
  useContext?: boolean;
}