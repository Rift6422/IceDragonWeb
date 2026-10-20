import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediaAsset, Prisma } from '@prisma/client';
import { promises as fs } from 'node:fs';
import { join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export interface MediaListItem {
  id: string;
  url: string;
  filename: string;
  original_name: string | null;
  mime_type: string;
  size_bytes: number;
  uploaded_at: Date;
  deleted_at: Date | null;
}

@Injectable()
export class AdminMediaService {
  private readonly logger = new Logger(AdminMediaService.name);
  private readonly uploadDir: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.uploadDir = this.config.get<string>('UPLOAD_DIR') ?? '/app/uploads';
  }

  /** 啟動前確保目錄存在(若 Volume 還沒 mount 過,首次 write 會 fail otherwise) */
  async ensureUploadDir(): Promise<void> {
    await fs.mkdir(this.uploadDir, { recursive: true });
  }

  async upload(input: {
    buffer: Buffer;
    mimetype: string;
    originalname: string;
    size: number;
    uploadedBy: string;
  }): Promise<MediaListItem> {
    if (!ALLOWED_MIMES.has(input.mimetype)) {
      throw new BadRequestException(
        `不支援的檔案類型 ${input.mimetype}(允許:JPG / PNG / WebP / GIF)`,
      );
    }
    if (input.size > MAX_BYTES) {
      throw new BadRequestException(`檔案過大(限制 5MB,實際 ${(input.size / 1024 / 1024).toFixed(2)}MB)`);
    }

    await this.ensureUploadDir();

    const ext = this.pickExt(input.mimetype, input.originalname);
    const id = randomUUID();
    const filename = `${id}${ext}`;
    const fullPath = join(this.uploadDir, filename);

    await fs.writeFile(fullPath, input.buffer);

    const asset = await this.prisma.mediaAsset.create({
      data: {
        id,
        filename,
        originalName: input.originalname.slice(0, 200),
        mimeType: input.mimetype,
        sizeBytes: input.size,
        uploadedBy: input.uploadedBy,
      },
    });

    return this.shape(asset);
  }

  async list(query: { limit?: number; offset?: number; includeDeleted?: boolean }): Promise<{
    total: number;
    items: MediaListItem[];
    /** 軟刪總數,供 UI 顯示「已刪除 N 筆」切換 */
    deleted_count: number;
  }> {
    const where: Prisma.MediaAssetWhereInput = query.includeDeleted ? {} : { deletedAt: null };
    const [total, rows, deletedCount] = await Promise.all([
      this.prisma.mediaAsset.count({ where }),
      this.prisma.mediaAsset.findMany({
        where,
        orderBy: { uploadedAt: 'desc' },
        take: Math.min(query.limit ?? 100, 200),
        skip: query.offset ?? 0,
      }),
      this.prisma.mediaAsset.count({ where: { deletedAt: { not: null } } }),
    ]);
    return { total, items: rows.map((r) => this.shape(r)), deleted_count: deletedCount };
  }

  async softDelete(id: string): Promise<{ id: string; deleted: boolean }> {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset || asset.deletedAt) {
      throw new NotFoundException(`Media ${id} not found`);
    }
    await this.prisma.mediaAsset.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    // 檔案保留磁碟上,定期清理由維運處理(避免誤刪)
    return { id, deleted: true };
  }

  async restore(id: string): Promise<MediaListItem> {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) {
      throw new NotFoundException(`Media ${id} not found`);
    }
    if (!asset.deletedAt) {
      throw new BadRequestException(`Media ${id} 不在已刪除狀態`);
    }
    const restored = await this.prisma.mediaAsset.update({
      where: { id },
      data: { deletedAt: null },
    });
    return this.shape(restored);
  }

  private shape(asset: MediaAsset): MediaListItem {
    return {
      id: asset.id,
      url: `/uploads/${asset.filename}`,
      filename: asset.filename,
      original_name: asset.originalName,
      mime_type: asset.mimeType,
      size_bytes: asset.sizeBytes,
      uploaded_at: asset.uploadedAt,
      deleted_at: asset.deletedAt,
    };
  }

  private pickExt(mime: string, original: string): string {
    const fromOrig = extname(original).toLowerCase();
    if (fromOrig && /^\.(jpg|jpeg|png|webp|gif)$/.test(fromOrig)) return fromOrig;
    switch (mime) {
      case 'image/jpeg':
        return '.jpg';
      case 'image/png':
        return '.png';
      case 'image/webp':
        return '.webp';
      case 'image/gif':
        return '.gif';
      default:
        return '.bin';
    }
  }
}
