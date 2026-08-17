import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { SessionUser } from '../../lib/types';
import { FinanceService } from './finance.service';
import { FlutterwaveGateway } from './flutterwave.gateway';
import {
  CreateFeeStructureDto,
  UpdateFeeStructureDto,
  InitPaymentDto,
  VerifyPaymentDto,
  RefundDto,
  CreateScholarshipDto,
  CreateManualPaymentDto,
} from './dto/finance.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('finance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FinanceController {
  constructor(
    private readonly financeService: FinanceService,
    private readonly gateway: FlutterwaveGateway,
  ) {}

  // ---- Fee structures ----
  @Get('fee-structures')
  @Roles('SCHOOL_ADMIN', 'ACCOUNTANT')
  listFeeStructures(@CurrentUser() user: SessionUser) {
    return this.financeService.listFeeStructures(user.schoolId);
  }

  @Post('fee-structures')
  @Roles('SCHOOL_ADMIN', 'ACCOUNTANT')
  createFeeStructure(
    @CurrentUser() user: SessionUser,
    @Body() dto: CreateFeeStructureDto,
  ) {
    return this.financeService.createFeeStructure(user.schoolId, dto);
  }

  @Patch('fee-structures/:id')
  @Roles('SCHOOL_ADMIN', 'ACCOUNTANT')
  updateFeeStructure(
    @Param('id') id: string,
    @CurrentUser() user: SessionUser,
    @Body() dto: UpdateFeeStructureDto,
  ) {
    return this.financeService.updateFeeStructure(id, user.schoolId, dto);
  }

  @Delete('fee-structures/:id')
  @Roles('SCHOOL_ADMIN', 'ACCOUNTANT')
  deleteFeeStructure(
    @Param('id') id: string,
    @CurrentUser() user: SessionUser,
  ) {
    return this.financeService.deleteFeeStructure(id, user.schoolId);
  }

  // ---- Application fees (pre-submission, public) ----
  @Public()
  @Get('application-fees')
  applicationFees(@Query('schoolSlug') schoolSlug?: string) {
    // Resolve schoolId from slug if provided; otherwise return all.
    return this.financeService.getApplicationFees(null);
  }

  /** Public endpoint to expose Flutterwave config (public key) to frontend. */
  @Public()
  @Get('flutterwave-config')
  flutterwaveConfig() {
    return {
      publicKey: this.gateway.publicKey || '',
      isConfigured: this.gateway.isConfigured,
    };
  }

  // ---- Payments ----
  @Get('payments')
  @Roles('SCHOOL_ADMIN', 'ACCOUNTANT')
  listPayments(
    @CurrentUser() user: SessionUser,
    @Query() query: PaginationDto,
    @Query('status') status?: string,
  ) {
    return this.financeService.listPayments(user.schoolId, query, status);
  }

  @Public()
  @Post('payments/init')
  initPayment(
    @CurrentUser() user: SessionUser | undefined,
    @Body() dto: InitPaymentDto,
  ) {
    return this.financeService.initPayment(user?.schoolId ?? null, dto);
  }

  @Public()
  @Post('payments/verify')
  verifyPayment(@Body() dto: VerifyPaymentDto) {
    return this.financeService.verifyPayment(dto);
  }

  /** Flutterwave webhook (charge.completed). */
  @Public()
  @Post('payments/webhook')
  async webhook(
    @Body() payload: any,
    @Headers('verifi-hash') signature?: string,
  ) {
    return this.financeService.handleWebhook(payload, signature);
  }

  // ---- Manual payment (admin) ----
  @Post('payments/manual')
  @Roles('SCHOOL_ADMIN', 'ACCOUNTANT')
  createManualPayment(
    @CurrentUser() user: SessionUser,
    @Body() dto: CreateManualPaymentDto,
  ) {
    return this.financeService.createManualPayment(user.schoolId, dto, user.id);
  }

  // ---- Refunds ----
  @Post('refunds')
  @Roles('SCHOOL_ADMIN', 'ACCOUNTANT')
  refund(@CurrentUser() user: SessionUser, @Body() dto: RefundDto) {
    return this.financeService.refund(dto, user.id);
  }

  // ---- Scholarships ----
  @Get('scholarships')
  @Roles('SCHOOL_ADMIN', 'ACCOUNTANT')
  listScholarships(@CurrentUser() user: SessionUser) {
    return this.financeService.listScholarships(user.schoolId);
  }

  @Post('scholarships')
  @Roles('SCHOOL_ADMIN', 'ACCOUNTANT')
  createScholarship(
    @CurrentUser() user: SessionUser,
    @Body() dto: CreateScholarshipDto,
  ) {
    return this.financeService.createScholarship(user.schoolId, dto);
  }

  // ---- Student fee breakdown (admin) ----
  @Get('student-fees/:studentId')
  @Roles('SCHOOL_ADMIN', 'ACCOUNTANT')
  getStudentFees(@Param('studentId') studentId: string) {
    return this.financeService.studentFeeBreakdown(studentId);
  }

  // ---- Ledger ----
  @Get('ledger/:studentId')
  @Roles('SCHOOL_ADMIN', 'ACCOUNTANT', 'STUDENT')
  ledger(@Param('studentId') studentId: string) {
    return this.financeService.ledgerForStudent(studentId);
  }

  // ---- Dashboard summary ----
  @Get('dashboard')
  @Roles('SCHOOL_ADMIN', 'ACCOUNTANT')
  dashboard(@CurrentUser() user: SessionUser) {
    return this.financeService.dashboardSummary(user.schoolId);
  }
}
