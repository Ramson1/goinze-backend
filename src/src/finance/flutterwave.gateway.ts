import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface FlutterwaveInitInput {
  txRef: string;
  amount: number;
  currency: string;
  email: string;
  redirectUrl: string;
  title?: string;
  description?: string;
}

export interface FlutterwaveInitResult {
  checkoutUrl: string;
  /** True when this is a live Flutterwave checkout link. */
  live: boolean;
}

export interface FlutterwaveVerifyResult {
  status: string;
  amount: number;
  currency: string;
  txRef: string;
  flwRef: string;
}

/**
 * Thin Flutterwave v3 gateway wrapper.
 *
 * When FLUTTERWAVE_SECRET_KEY is configured it calls the live API. Otherwise
 * it runs in "dev mode" and returns a placeholder checkout URL so the full
 * admissions → payment → onboarding flow can be exercised without live keys.
 */
@Injectable()
export class FlutterwaveGateway {
  private readonly logger = new Logger(FlutterwaveGateway.name);
  private readonly baseUrl = 'https://api.flutterwave.com/v3';

  constructor(private readonly config: ConfigService) {}

  private get secretKey(): string | undefined {
    return this.config.get<string>('FLUTTERWAVE_SECRET_KEY') || undefined;
  }

  /** Public key for client-side checkout (served to frontend). */
  get publicKey(): string | undefined {
    return this.config.get<string>('FLUTTERWAVE_PUBLIC_KEY') || undefined;
  }

  /** Encryption key for enhanced payload security (optional). */
  get encryptionKey(): string | undefined {
    return this.config.get<string>('FLUTTERWAVE_ENCRYPTION_KEY') || undefined;
  }

  /** Webhook hash for signature verification. */
  get webhookHash(): string | undefined {
    return this.config.get<string>('FLUTTERWAVE_WEBHOOK_HASH') || undefined;
  }

  /** Portal Access Fee — secondary account public key. */
  get portalAccessPublicKey(): string | undefined {
    return this.config.get<string>('FLUTTERWAVE_PORTAL_ACCESS_PUBLIC_KEY') || undefined;
  }

  /** Portal Access Fee — secondary account secret key. */
  get portalAccessSecretKey(): string | undefined {
    return this.config.get<string>('FLUTTERWAVE_PORTAL_ACCESS_SECRET_KEY') || undefined;
  }

  get isConfigured(): boolean {
    return Boolean(this.secretKey);
  }

  /** Initialize a payment and return a hosted checkout URL. */
  async initialize(input: FlutterwaveInitInput): Promise<FlutterwaveInitResult> {
    if (!this.isConfigured) {
      this.logger.warn(
        `FLUTTERWAVE_SECRET_KEY not set — returning dev checkout for ${input.txRef}`,
      );
      return {
        checkoutUrl: `${input.redirectUrl}?tx_ref=${input.txRef}&status=successful&dev=1`,
        live: false,
      };
    }

    const res = await fetch(`${this.baseUrl}/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tx_ref: input.txRef,
        amount: input.amount,
        currency: input.currency,
        redirect_url: input.redirectUrl,
        customer: { email: input.email },
        customizations: {
          title: input.title ?? 'Goinzeschool Payment',
          description: input.description ?? '',
        },
      }),
    });

    const json = (await res.json()) as any;
    if (!res.ok || json?.status !== 'success') {
      throw new Error(
        `Flutterwave initialize failed: ${json?.message ?? res.statusText}`,
      );
    }
    return { checkoutUrl: json.data.link, live: true };
  }

  /** Verify a transaction by its tx_ref (our payment reference). */
  async verify(txRef: string): Promise<FlutterwaveVerifyResult> {
    if (!this.isConfigured) {
      // Dev mode: treat every verification as successful.
      return {
        status: 'successful',
        amount: 0,
        currency: 'NGN',
        txRef,
        flwRef: `DEV-${txRef}`,
      };
    }

    const res = await fetch(
      `${this.baseUrl}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`,
      { headers: { Authorization: `Bearer ${this.secretKey}` } },
    );
    const json = (await res.json()) as any;
    if (!res.ok || json?.status !== 'success') {
      throw new Error(`Flutterwave verify failed: ${json?.message ?? res.statusText}`);
    }
    const d = json.data;
    return {
      status: d.status,
      amount: Number(d.amount),
      currency: d.currency,
      txRef: d.tx_ref,
      flwRef: d.flw_ref,
    };
  }

  /** Verify a transaction using the Portal Access secondary account secret key. */
  async verifyWithPortalAccessKey(txRef: string): Promise<FlutterwaveVerifyResult> {
    const portalSecretKey = this.portalAccessSecretKey;
    if (!portalSecretKey) {
      throw new Error('FLUTTERWAVE_PORTAL_ACCESS_SECRET_KEY not configured');
    }

    const res = await fetch(
      `${this.baseUrl}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`,
      { headers: { Authorization: `Bearer ${portalSecretKey}` } },
    );
    const json = (await res.json()) as any;
    if (!res.ok || json?.status !== 'success') {
      throw new Error(`Flutterwave verify failed: ${json?.message ?? res.statusText}`);
    }
    const d = json.data;
    return {
      status: d.status,
      amount: Number(d.amount),
      currency: d.currency,
      txRef: d.tx_ref,
      flwRef: d.flw_ref,
    };
  }
}
