import {
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ReceiptsService } from './receipts.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';

@Controller('receipts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReceiptsController {
  constructor(private readonly receiptsService: ReceiptsService) {}

  @Post('payment/:paymentId')
  @Roles('SCHOOL_ADMIN', 'ACCOUNTANT', 'STUDENT')
  generate(@Param('paymentId') paymentId: string) {
    return this.receiptsService.generateForPayment(paymentId);
  }

  @Get('payment/:paymentId')
  @Roles('SCHOOL_ADMIN', 'ACCOUNTANT', 'STUDENT')
  findByPayment(@Param('paymentId') paymentId: string) {
    return this.receiptsService.findByPayment(paymentId);
  }

  /** Public verification endpoint (e.g. for employers / portal lookup). */
  @Public()
  @Get('verify/:code')
  verify(@Param('code') code: string) {
    return this.receiptsService.verify(code);
  }
}
