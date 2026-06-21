const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export type PaymentStatus =
  | "PENDING"
  | "PROCESSING"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "CANCELLED";

export interface Payment {
  paymentId: string;
  merchantId: string;
  amount: number;
  currency: "ARS";
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
  currency: "ARS";
  reference: string;
  description?: string;
}

export interface CreatePaymentResponse {
  paymentId: string;
  status: Extract<PaymentStatus, "PENDING">;
  amount: number;
  currency: "ARS";
  reference: string;
  qrPayload: string;
  expiresAt: string;
  correlationId: string;
}

export interface PaymentsListResponse {
  items: Payment[];
  nextCursor: string | null;
}

export async function createPayment(input: CreatePaymentRequest) {
  return request<CreatePaymentResponse>("/v1/payments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID()
    },
    body: JSON.stringify(input)
  });
}

export async function getPayment(paymentId: string) {
  return request<Payment>(`/v1/payments/${paymentId}`);
}

export async function listPayments() {
  return request<PaymentsListResponse>("/v1/payments");
}

export async function confirmPayment(paymentId: string) {
  return request<Payment>(`/v1/payments/${paymentId}/confirm`, { method: "POST" });
}

export async function cancelPayment(paymentId: string) {
  return request<Payment>(`/v1/payments/${paymentId}/cancel`, { method: "POST" });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, init);
  const payload = await parseJson(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(payload, response.status));
  }

  return payload as T;
}

async function parseJson(response: Response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function getErrorMessage(payload: unknown, status: number) {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (typeof record.message === "string") {
      return record.message;
    }
    if (typeof record.code === "string") {
      return record.code;
    }
  }

  return `Request failed with status ${status}`;
}
