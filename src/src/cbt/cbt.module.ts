import { Module } from '@nestjs/common';
import { CbtService } from './cbt.service';
import { CbtController } from './cbt.controller';
import { CommunicationModule } from '../communication/communication.module';

@Module({
  imports: [CommunicationModule],
  controllers: [CbtController],
  providers: [CbtService],
  exports: [CbtService],
})
export class CbtModule {}
