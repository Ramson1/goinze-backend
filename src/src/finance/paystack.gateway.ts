import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface PaystackInitInput {
  txRef: string;
  amount: number;
  currency: string;
  email: string;
  redirectUrl: string;
  title?: string;
  description?: string;
}

export interface PaystackInitResult {
  checkoutUrl: string;
  /** True when this is a live Paystack checkout link. */
  live: boolean;
}

export interface PaystackVerifyResult {
  status: string;
  amount: number;
  currency: string;
  txRef: string;
  gatewayRef: string;
}

/**
 * Thin Paystack gateway wrapper.
 *
 * When PAYSTACK_SECRET_KEY is configured it calls the live API. Otherwise
 * it runs in "dev mode" and returns a placeholder checkout URL so the full
 * admissions → payment → onboarding flow can be exercised without live keys.
 *
 * NOTE: Paystack amounts are in **kobo** (₦1 = 100 kobo). The initialize()
 * method automatically converts naira to kobo before sending to Paystack.
 */
@Injectable()
export class PaystackGateway {
  private readonly logger = new Logger(PaystackGateway.name);
  private readonly baseUrl = 'https://api.paystack.co';

  constructor(private readonly config: ConfigService) {}

  private get secretKey(): string | undefined {
    return this.config.get<string>('PAYSTACK_SECRET_KEY') || undefined;
  }

  /** Public key for client-side checkout (served to frontend). */
  get publicKey(): string | undefined {
    return this.config.get<string>('PAYSTACK_PUBLIC_KEY') || undefined;
  }

  /** Webhook secret for HMAC signature verification. */
  get webhookSecret(): string | undefined {
    return this.config.get<string>('PAYSTACK_WEBHOOK_SECRET') || undefined;
  }

  /** Portal Access Fee — secondary account public key. */
  get portalAccessPublicKey(): string | undefined {
    return this.config.get<string>('PAYSTACK_PORTAL_ACCESS_PUBLIC_KEY') || undefined;
  }

  /** Portal Access Fee — secondary account secret key. */
  get portalAccessSecretKey(): string | undefined {
    return this.config.get<string>('PAYSTACK_PORTAL_ACCESS_SECRET_KEY') || undefined;
  }

  get isConfigured(): boolean {
    return Boolean(this.secretKey);
  }

  /**
   * Initialize a payment and return a hosted checkout URL.
   *
   * IMPORTANT: Paystack expects amounts in **kobo** (₦1 = 100 kobo).
   * The input amount is in naira, so we multiply by 100 here.
   */
  async initialize(input: PaystackInitInput): Promise<PaystackInitResult> {
    if (!this.isConfigured) {
      this.logger.warn(
        `PAYSTACK_SECRET_KEY not set — returning dev checkout for ${input.txRef}`,
      );
      return {
        checkoutUrl: `${input.redirectUrl}?reference=${input.txRef}&status=success&dev=1`,
        live: false,
      };
    }

    // Convert naira to kobo (Paystack requires amounts in kobo)
    const amountInKobo = Math.round(input.amount * 100);

    const res = await fetch(`${this.baseUrl}/transaction/initialize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        reference: input.txRef,
        amount: amountInKobo,
        currency: input.currency,
        callback_url: input.redirectUrl,
        customer: { email: input.email },
        metadata: {
          custom_fields: [
            {
              display_name: 'Description',
              variable_name: 'description',
              value: input.description ?? input.title ?? 'Goinzeschool Payment',
            },
          ],
        },
      }),
    });

    const json = (await res.json()) as any;
    if (!res.ok || json?.status !== true) {
      throw new Error(
        `Paystack initialize failed: ${json?.message ?? res.statusText}`,
      );
    }
    return { checkoutUrl: json.data.authorization_url, live: true };
  }

  /** Verify a transaction by its reference (our payment reference). */
  async verify(txRef: string): Promise<PaystackVerifyResult> {
    if (!this.isConfigured) {
      // Dev mode: treat every verification as successful.
      return {
        status: 'success',
        amount: 0,
        currency: 'NGN',
        txRef,
        gatewayRef: `DEV-${txRef}`,
      };
    }

    const res = await fetch(
      `${this.baseUrl}/transaction/verify/${encodeURIComponent(txRef)}`,
      { headers: { Authorization: `Bearer ${this.secretKey}` } },
    );
    const json = (await res.json()) as any;
    if (!res.ok || json?.status !== true) {
      throw new Error(`Paystack verify failed: ${json?.message ?? res.statusText}`);
    }
    const d = json.data;
    return {
      status: d.status, // 'success', 'failed', 'abandoned'
      amount: Number(d.amount) / 100, // Convert kobo back to naira
      currency: d.currency ?? 'NGN',
      txRef: d.reference,
      gatewayRef: d.reference,
    };
  }

  /** Verify a transaction using the Portal Access secondary account secret key. */
  async verifyWithPortalAccessKey(txRef: string): Promise<PaystackVerifyResult> {
    const portalSecretKey = this.portalAccessSecretKey;
    if (!portalSecretKey) {
      throw new Error('PAYSTACK_PORTAL_ACCESS_SECRET_KEY not configured');
    }

    const res = await fetch(
      `${this.baseUrl}/transaction/verify/${encodeURIComponent(txRef)}`,
      { headers: { Authorization: `Bearer ${portalSecretKey}` } },
    );
    const json = (await res.json()) as any;
    if (!res.ok || json?.status !== true) {
      throw new Error(`Paystack verify failed: ${json?.message ?? res.statusText}`);
    }
    const d = json.data;
    return {
      status: d.status,
      amount: Number(d.amount) / 100, // Convert kobo back to naira
      currency: d.currency ?? 'NGN',
      txRef: d.reference,
      gatewayRef: d.reference,
    };
  }
}
