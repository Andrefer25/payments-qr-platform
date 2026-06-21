export const PAYMENT_STATUSES = [
  "PENDING",
  "PROCESSING",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "CANCELLED"
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export type Currency = "ARS";

export interface Payment {
  paymentId: string;
  merchantId: string;
  amount: number;
  currency: Currency;
  status: PaymentStatus;
  reference: string;
  description?: string;
  qrPayload: string;
  transactionId?: string;
  paymentMethod?: "WALLET_QR";
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  correlationId: string;
}

export interface CreatePaymentRequest {
  amount: number;
  currency: Currency;
  reference: string;
  description?: string;
}

export interface CreatePaymentResponse {
  paymentId: string;
  status: Extract<PaymentStatus, "PENDING">;
  amount: number;
  currency: Currency;
  reference: string;
  qrPayload: string;
  expiresAt: string;
  correlationId: string;
}
