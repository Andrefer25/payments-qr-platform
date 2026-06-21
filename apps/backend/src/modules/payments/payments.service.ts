import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { CreatePaymentRequest, CreatePaymentResponse, Payment } from "./payment.types.js";
import { PaymentsRepository } from "./payments.repository.js";

@Injectable()
export class PaymentsService {
  constructor(private readonly paymentsRepository: PaymentsRepository) {}

  async create(args: {
    merchantId: string;
    idempotencyKey?: string;
    input: CreatePaymentRequest;
  }): Promise<CreatePaymentResponse> {
    if (!args.idempotencyKey) {
      throw new BadRequestException({
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "Idempotency-Key header is required"
      });
    }

    const requestHash = hashRequest(args.input);
    const existing = await this.paymentsRepository.findIdempotencyRecord({
      merchantId: args.merchantId,
      idempotencyKey: args.idempotencyKey
    });

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ConflictException({
          code: "IDEMPOTENCY_KEY_REUSED",
          message: "Idempotency-Key was already used with a different payload"
        });
      }

      return existing.responseSnapshot as CreatePaymentResponse;
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
    const paymentId = `pay_${randomUUID().slice(0, 8)}`;
    const correlationId = `corr_${randomUUID().slice(0, 8)}`;

    const payment: Payment = {
      paymentId,
      merchantId: args.merchantId,
      amount: args.input.amount,
      currency: args.input.currency,
      status: "PENDING",
      reference: args.input.reference,
      description: args.input.description,
      qrPayload: `payment://${paymentId}`,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      correlationId
    };

    const response: CreatePaymentResponse = {
      paymentId: payment.paymentId,
      status: "PENDING",
      amount: payment.amount,
      currency: payment.currency,
      reference: payment.reference,
      qrPayload: payment.qrPayload,
      expiresAt: payment.expiresAt,
      correlationId: payment.correlationId
    };

    await this.paymentsRepository.createWithIdempotency({
      payment,
      idempotencyKey: args.idempotencyKey,
      requestHash,
      responseSnapshot: response,
      ttl: Math.floor(now.getTime() / 1000) + 24 * 60 * 60
    });

    return response;
  }

  list(filters: { merchantId: string; status?: string }) {
    return this.paymentsRepository.list(filters);
  }

  async get(args: { merchantId: string; paymentId: string }) {
    const payment = await this.paymentsRepository.findById(args.paymentId);
    if (!payment || payment.merchantId !== args.merchantId) {
      throw new NotFoundException({ code: "PAYMENT_NOT_FOUND" });
    }
    return payment;
  }

  async cancel(args: { merchantId: string; paymentId: string }) {
    const payment = await this.get(args);
    if (payment.status !== "PENDING") {
      throw new ConflictException({ code: "PAYMENT_NOT_CANCELLABLE" });
    }
    return this.paymentsRepository.updateStatus(args.paymentId, "CANCELLED");
  }

  async confirm(args: { merchantId: string; paymentId: string }) {
    const payment = await this.get(args);
    if (payment.status !== "PENDING") {
      throw new ConflictException({ code: "PAYMENT_NOT_CONFIRMABLE" });
    }
    await this.paymentsRepository.updateStatus(args.paymentId, "PROCESSING");
    return this.paymentsRepository.updateStatus(args.paymentId, "APPROVED");
  }
}

function hashRequest(input: CreatePaymentRequest) {
  return createHash("sha256").update(stableStringify(input)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}
