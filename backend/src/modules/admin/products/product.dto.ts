import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsJSON,
  IsNotEmpty,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ProductStatus } from '@prisma/client';

export class CreateProductDto {
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @Matches(/^[A-Z0-9_]+$/, { message: 'code must be UPPER_SNAKE_CASE' })
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(15)
  mycard_item_code?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name_display!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name_internal!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsNumberString({ no_symbols: false }, { message: 'amount must be numeric' })
  amount!: string;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  /** ProductEffect JSON — 結構見 schema.prisma Appendix A */
  @IsObject()
  effects!: Record<string, unknown>;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99999)
  sort_order?: number;

  /** PlayFab catalog itemId(限購查詢 + 派發識別用)*/
  @IsOptional()
  @IsString()
  @MaxLength(64)
  playfab_item_id?: string;

  /** PlayFab storeID(空時 fallback 到 GAME_BACKEND_STORE_ID env)*/
  @IsOptional()
  @IsString()
  @MaxLength(64)
  playfab_store_id?: string;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MaxLength(15)
  mycard_item_code?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name_display?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name_internal?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsNumberString({ no_symbols: false })
  amount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsObject()
  effects?: Record<string, unknown>;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99999)
  sort_order?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  playfab_item_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  playfab_store_id?: string;
}

export class ListProductsDto {
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 100;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
