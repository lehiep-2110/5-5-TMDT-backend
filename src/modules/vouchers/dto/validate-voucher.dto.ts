import { IsNumber, IsString, Length, Min } from 'class-validator';

export class ValidateVoucherDto {
  @IsString()
  @Length(2, 50)
  code!: string;

  @IsNumber({}, { message: 'Subtotal phải là số.' })
  @Min(0)
  subtotal!: number;
}
