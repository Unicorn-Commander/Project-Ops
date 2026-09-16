import { Body, Controller, Logger, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { User } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AssistantService } from './assistant.service';
import { ChatRequestDto } from './dto/chat.dto';

@ApiTags('assistant')
@ApiBearerAuth()
@Controller('assistant')
export class AssistantController {
  private readonly logger = new Logger(AssistantController.name);

  constructor(private readonly assistant: AssistantService) {}

  @Post('chat')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Send a chat message to the Project Ops Assistant.' })
  async chat(@Req() req: Request, @Body() body: ChatRequestDto) {
    const user = req.user as User;
    try {
      const result = await this.assistant.chat(user, body);
      return result;
    } catch (err) {
      const message = (err as Error).message;
      this.logger.warn(`assistant chat failed for ${user.email}: ${message}`);
      return { content: '', error: message };
    }
  }
}
