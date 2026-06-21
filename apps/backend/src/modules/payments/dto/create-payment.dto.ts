import { IsIn, IsNumber, IsOptional, IsString, MaxLength, Min } from "class-validator";

export class CreatePaymentDto {
  @IsNumber()
  @Min(1)
  amount!: number;

  @IsIn(["ARS"])
  currency!: "ARS";

  @IsString()
  @MaxLength(80)
  reference!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  description?: string;
}
