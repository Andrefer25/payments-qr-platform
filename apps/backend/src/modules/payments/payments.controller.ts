import { Body, Controller, Get, Headers, Param, Post, Query } from "@nestjs/common";
import { CreatePaymentDto } from "./dto/create-payment.dto.js";
import { PaymentsService } from "./payments.service.js";

@Controller("payments")
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  create(
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: CreatePaymentDto
  ) {
    return this.paymentsService.create({
      merchantId: "merchant-local",
      idempotencyKey,
      input: body
    });
  }

  @Get()
  list(@Query("status") status?: string) {
    return this.paymentsService.list({ merchantId: "merchant-local", status });
  }

  @Get(":paymentId")
  get(@Param("paymentId") paymentId: string) {
    return this.paymentsService.get({ merchantId: "merchant-local", paymentId });
  }

  @Post(":paymentId/cancel")
  cancel(@Param("paymentId") paymentId: string) {
    return this.paymentsService.cancel({ merchantId: "merchant-local", paymentId });
  }

  @Post(":paymentId/confirm")
  confirm(@Param("paymentId") paymentId: string) {
    return this.paymentsService.confirm({ merchantId: "merchant-local", paymentId });
  }
}
