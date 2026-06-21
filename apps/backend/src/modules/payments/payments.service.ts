import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { CreatePaymentRequest, CreatePaymentResponse } from "./payment.types.js";
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

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
    const paymentId = `pay_${randomUUID().slice(0, 8)}`;
    const correlationId = `corr_${randomUUID().slice(0, 8)}`;

    const payment = await this.paymentsRepository.put({
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
    });

    return {
      paymentId: payment.paymentId,
      status: "PENDING",
      amount: payment.amount,
      currency: payment.currency,
      reference: payment.reference,
      qrPayload: payment.qrPayload,
      expiresAt: payment.expiresAt,
      correlationId: payment.correlationId
    };
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
