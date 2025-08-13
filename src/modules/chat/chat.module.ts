import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ConfigService } from '@nestjs/config';

@Module({
  controllers: [ChatController],
  providers: [ChatService, ConfigService],
})
export class ChatModule {}