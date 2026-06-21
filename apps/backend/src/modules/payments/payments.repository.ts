import { Injectable } from "@nestjs/common";
import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import { dynamodbDocumentClient } from "../../infrastructure/dynamodb/dynamodb.client.js";
import type { Payment, PaymentStatus } from "./payment.types.js";

interface CreatePaymentIdempotencyArgs {
  payment: Payment;
  idempotencyKey: string;
  requestHash: string;
  responseSnapshot: unknown;
  ttl: number;
}

interface IdempotencyRecord {
  requestHash: string;
  paymentId: string;
  responseSnapshot: unknown;
  status: "COMPLETED";
}

@Injectable()
export class PaymentsRepository {
  private readonly paymentsTable = "Payments";
  private readonly idempotencyTable = "IdempotencyKeys";
  private readonly client = dynamodbDocumentClient;

  async put(payment: Payment) {
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.paymentsTable,
              Item: this.toPaymentItem(payment),
              ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)"
            }
          }
        ]
      })
    );
    return payment;
  }

  async createWithIdempotency(args: CreatePaymentIdempotencyArgs) {
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.paymentsTable,
              Item: this.toPaymentItem(args.payment),
              ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)"
            }
          },
          {
            Put: {
              TableName: this.idempotencyTable,
              Item: {
                PK: idempotencyPk(args.payment.merchantId),
                SK: idempotencySk(args.idempotencyKey),
                requestHash: args.requestHash,
                paymentId: args.payment.paymentId,
                responseSnapshot: args.responseSnapshot,
                status: "COMPLETED",
                ttl: args.ttl
              },
              ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)"
            }
          }
        ]
      })
    );

    return args.payment;
  }

  async findIdempotencyRecord(args: {
    merchantId: string;
    idempotencyKey: string;
  }): Promise<IdempotencyRecord | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.idempotencyTable,
        Key: {
          PK: idempotencyPk(args.merchantId),
          SK: idempotencySk(args.idempotencyKey)
        }
      })
    );

    return (result.Item as IdempotencyRecord | undefined) ?? null;
  }

  async findById(paymentId: string) {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.paymentsTable,
        IndexName: "byPaymentId",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: {
          ":pk": paymentIdPk(paymentId)
        },
        Limit: 1
      })
    );

    const item = result.Items?.[0];
    return item ? this.fromPaymentItem(item) : null;
  }

  async list(filters: { merchantId: string; status?: string }) {
    const command = filters.status
      ? new QueryCommand({
          TableName: this.paymentsTable,
          IndexName: "byStatusDate",
          KeyConditionExpression: "GSI2PK = :pk AND begins_with(GSI2SK, :statusPrefix)",
          ExpressionAttributeValues: {
            ":pk": merchantPk(filters.merchantId),
            ":statusPrefix": `STATUS#${filters.status}#`
          },
          ScanIndexForward: false
        })
      : new QueryCommand({
          TableName: this.paymentsTable,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :paymentPrefix)",
          ExpressionAttributeValues: {
            ":pk": merchantPk(filters.merchantId),
            ":paymentPrefix": "PAYMENT#"
          },
          ScanIndexForward: false
        });

    const result = await this.client.send(command);
    const items = (result.Items ?? [])
      .map((item) => this.fromPaymentItem(item))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return { items, nextCursor: null };
  }

  async updateStatus(paymentId: string, status: PaymentStatus) {
    const current = await this.findById(paymentId);
    if (!current) {
      return null;
    }

    const updated: Payment = {
      ...current,
      status,
      updatedAt: new Date().toISOString()
    };

    await this.client.send(
      new UpdateCommand({
        TableName: this.paymentsTable,
        Key: {
          PK: merchantPk(updated.merchantId),
          SK: paymentSk(updated.paymentId)
        },
        ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)",
        UpdateExpression: "SET #status = :status, updatedAt = :updatedAt, GSI2SK = :gsi2sk",
        ExpressionAttributeNames: {
          "#status": "status"
        },
        ExpressionAttributeValues: {
          ":status": updated.status,
          ":updatedAt": updated.updatedAt,
          ":gsi2sk": statusDateSk(updated.status, updated.createdAt, updated.paymentId)
        }
      })
    );

    return updated;
  }

  private toPaymentItem(payment: Payment) {
    return {
      ...payment,
      PK: merchantPk(payment.merchantId),
      SK: paymentSk(payment.paymentId),
      GSI1PK: paymentIdPk(payment.paymentId),
      GSI1SK: paymentIdPk(payment.paymentId),
      GSI2PK: merchantPk(payment.merchantId),
      GSI2SK: statusDateSk(payment.status, payment.createdAt, payment.paymentId),
      GSI3PK: merchantPk(payment.merchantId),
      GSI3SK: referenceDateSk(payment.reference, payment.createdAt, payment.paymentId),
      ttl: Math.floor(new Date(payment.expiresAt).getTime() / 1000) + 24 * 60 * 60
    };
  }

  private fromPaymentItem(item: Record<string, unknown>): Payment {
    return {
      paymentId: String(item.paymentId),
      merchantId: String(item.merchantId),
      amount: Number(item.amount),
      currency: "ARS",
      status: item.status as PaymentStatus,
      reference: String(item.reference),
      description: item.description ? String(item.description) : undefined,
      qrPayload: String(item.qrPayload),
      transactionId: item.transactionId ? String(item.transactionId) : undefined,
      paymentMethod: item.paymentMethod === "WALLET_QR" ? "WALLET_QR" : undefined,
      createdAt: String(item.createdAt),
      updatedAt: String(item.updatedAt),
      expiresAt: String(item.expiresAt),
      correlationId: String(item.correlationId)
    };
  }
}

function merchantPk(merchantId: string) {
  return `MERCHANT#${merchantId}`;
}

function paymentSk(paymentId: string) {
  return `PAYMENT#${paymentId}`;
}

function paymentIdPk(paymentId: string) {
  return `PAYMENT#${paymentId}`;
}

function idempotencyPk(merchantId: string) {
  return `MERCHANT#${merchantId}#ENDPOINT#POST:/v1/payments`;
}

function idempotencySk(idempotencyKey: string) {
  return `IDEMPOTENCY#${idempotencyKey}`;
}

function statusDateSk(status: PaymentStatus, createdAt: string, paymentId: string) {
  return `STATUS#${status}#CREATED_AT#${createdAt}#PAYMENT#${paymentId}`;
}

function referenceDateSk(reference: string, createdAt: string, paymentId: string) {
  return `REFERENCE#${reference}#CREATED_AT#${createdAt}#PAYMENT#${paymentId}`;
}
