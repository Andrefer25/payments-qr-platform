import { Controller, Get, MessageEvent, Sse } from "@nestjs/common";
import { interval, map, Observable } from "rxjs";

@Controller("payment-events")
export class RealtimeController {
  @Sse()
  @Get()
  stream(): Observable<MessageEvent> {
    return interval(20_000).pipe(
      map(() => ({
        type: "heartbeat",
        data: { timestamp: new Date().toISOString() }
      }))
    );
  }
}
