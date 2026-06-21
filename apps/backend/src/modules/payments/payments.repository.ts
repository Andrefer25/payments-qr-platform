import { Injectable } from "@nestjs/common";
import type { Payment, PaymentStatus } from "./payment.types.js";

@Injectable()
export class PaymentsRepository {
  private readonly payments = new Map<string, Payment>();

  async put(payment: Payment) {
    this.payments.set(payment.paymentId, payment);
    return payment;
  }

  async findById(paymentId: string) {
    return this.payments.get(paymentId) ?? null;
  }

  async list(filters: { merchantId: string; status?: string }) {
    const items = [...this.payments.values()]
      .filter((payment) => payment.merchantId === filters.merchantId)
      .filter((payment) => !filters.status || payment.status === filters.status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return { items, nextCursor: null };
  }

  async updateStatus(paymentId: string, status: PaymentStatus) {
    const current = this.payments.get(paymentId);
    if (!current) {
      return null;
    }

    const updated = {
      ...current,
      status,
      updatedAt: new Date().toISOString()
    };
    this.payments.set(paymentId, updated);
    return updated;
  }
}
