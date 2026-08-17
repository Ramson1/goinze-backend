import { Injectable, NotFoundException } from '@nestjs/common';
import {
  generateReceiptNumber,
  generateVerificationCode,
} from '../../lib/utils';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Receipts: generate a receipt for a successful payment and verify receipts
 * by their verification code.
 */
@Injectable()
export class ReceiptsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Generate (or return existing) receipt for a payment. */
  async generateForPayment(paymentId: string) {
    const payment = await this.prisma.db.payment.findUnique({
      where: { id: paymentId },
      include: { receipt: true, student: true },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.receipt) return payment.receipt;

    const receiptNumber = generateReceiptNumber();
    const verificationCode = generateVerificationCode();

    return this.prisma.db.receipt.create({
      data: {
        paymentId,
        receiptNumber,
        verificationCode,
        qrData: `goinzeschool://receipt/${verificationCode}`,
      },
    });
  }

  /** Verify a receipt by its verification code. */
  async verify(code: string) {
    const receipt = await this.prisma.db.receipt.findUnique({
      where: { verificationCode: code.toUpperCase() },
      include: { payment: { include: { student: true, feeStructure: true } } },
    });
    if (!receipt) {
      throw new NotFoundException('Receipt not found or invalid code');
    }
    return {
      valid: true,
      receiptNumber: receipt.receiptNumber,
      issuedAt: receipt.createdAt,
      payment: receipt.payment,
    };
  }

  /** Look up a receipt by payment id (404 if none). */
  async findByPayment(paymentId: string) {
    const receipt = await this.prisma.db.receipt.findUnique({
      where: { paymentId },
      include: { payment: true },
    });
    if (!receipt) throw new NotFoundException('Receipt not found');
    return receipt;
  }
}
