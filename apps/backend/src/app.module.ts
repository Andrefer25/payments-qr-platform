import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { HealthController } from "./modules/health/health.controller.js";
import { PaymentsModule } from "./modules/payments/payments.module.js";
import { RealtimeModule } from "./modules/realtime/realtime.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PaymentsModule,
    RealtimeModule
  ],
  controllers: [HealthController]
})
export class AppModule {}
