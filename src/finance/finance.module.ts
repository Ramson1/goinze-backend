import { Module } from '@nestjs/common';
import { FinanceService } from './finance.service';
import { FinanceController } from './finance.controller';
import { FlutterwaveGateway } from './flutterwave.gateway';
import { ReceiptsModule } from '../receipts/receipts.module';
import { CommunicationModule } from '../communication/communication.module';

@Module({
  imports: [ReceiptsModule, CommunicationModule],
  controllers: [FinanceController],
  providers: [FinanceService, FlutterwaveGateway],
  exports: [FinanceService, FlutterwaveGateway],
})
export class FinanceModule {}
