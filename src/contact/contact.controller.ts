import { Body, Controller, Post } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { ContactService } from './contact.service';
import { ContactMessageDto } from './dto/contact-message.dto';

@Controller('contact')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @Public()
  @Post('message')
  sendMessage(@Body() dto: ContactMessageDto) {
    return this.contactService.sendMessage(dto);
  }
}
