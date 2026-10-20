import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '../../prisma/prisma.service';

/** 檔名只允許 UUID + 副檔名字元;防路徑穿越 / 異常 DB 值 */
const SAFE_FILENAME = /^[A-Za-z0-9._-]+$/;
const DOWNLOAD_TIMEOUT_MS = 15_000;
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * 開機媒體補檔(idempotent)。
 *
 * 情境:新開一個正式 service 時,DB 的 media_assets metadata 轉過來了,但
 * 圖檔本體在「各 service 各自的 Volume」上不會跟著 DB 走 → 新 Volume 是空的,
 * 商品圖 404。
 *
 * 設計:
 *   - 開關 = `MEDIA_BACKFILL_SOURCE_URL` 是否有設(沒設 → 完全略過,測試站自己不會亂補)
 *   - 只補「DB 有登記(deletedAt=null)但 Volume 缺」的檔,從來源站 `/uploads/<filename>` 抓
 *   - 已存在的檔不覆蓋;補完後下次開機偵測到都在 → 秒過
 *   - 非阻塞:背景跑,不擋 boot / healthz;任何失敗只 log,不影響服務
 */
@Injectable()
export class MediaBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MediaBackfillService.name);
  private readonly uploadDir: string;
  private readonly sourceBase: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.uploadDir = this.config.get<string>('UPLOAD_DIR') ?? '/app/uploads';
    this.sourceBase = (this.config.get<string>('MEDIA_BACKFILL_SOURCE_URL') ?? '').replace(/\/+$/, '');
  }

  onApplicationBootstrap(): void {
    // 開機一律印一行狀態(info 級),方便直接從 log 判斷有沒有啟用、寫哪個目錄
    if (!this.sourceBase) {
      this.logger.log(
        `媒體補檔未啟用:MEDIA_BACKFILL_SOURCE_URL 未設(uploadDir=${this.uploadDir})`,
      );
      return;
    }
    this.logger.log(
      `媒體補檔啟用:來源=${this.sourceBase} → uploadDir=${this.uploadDir}`,
    );
    // fire-and-forget:不 await,避免延遲啟動;內部自行處理所有錯誤
    void this.run();
  }

  private async run(): Promise<void> {
    try {
      await fs.mkdir(this.uploadDir, { recursive: true });

      const assets = await this.prisma.mediaAsset.findMany({
        where: { deletedAt: null },
        select: { filename: true },
      });

      const missing: string[] = [];
      for (const { filename } of assets) {
        if (!SAFE_FILENAME.test(filename)) {
          this.logger.warn(`媒體補檔:跳過異常檔名 ${filename}`);
          continue;
        }
        if (!(await this.fileExists(join(this.uploadDir, filename)))) {
          missing.push(filename);
        }
      }

      if (missing.length === 0) {
        this.logger.log(`媒體補檔:${assets.length} 個檔案都在 Volume,無需補檔`);
        return;
      }

      this.logger.log(
        `媒體補檔:偵測 ${missing.length}/${assets.length} 個檔案缺失,從 ${this.sourceBase} 補齊…`,
      );

      let ok = 0;
      let fail = 0;
      for (const filename of missing) {
        (await this.download(filename)) ? ok++ : fail++;
      }
      this.logger.log(`媒體補檔完成:成功 ${ok} / 失敗 ${fail}`);
    } catch (err) {
      this.logger.error(`媒體補檔異常(不影響服務):${(err as Error).message}`);
    }
  }

  private async download(filename: string): Promise<boolean> {
    const url = `${this.sourceBase}/uploads/${filename}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        this.logger.warn(`媒體補檔失敗 ${filename}:HTTP ${res.status}`);
        return false;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) {
        this.logger.warn(`媒體補檔略過 ${filename}:檔案大小異常(${buf.byteLength} bytes)`);
        return false;
      }
      // flag 'wx':只在檔案不存在時寫入(防與其他來源併發覆蓋)
      await fs.writeFile(join(this.uploadDir, filename), buf, { flag: 'wx' }).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== 'EEXIST') throw e; // 已存在視為成功
      });
      return true;
    } catch (err) {
      this.logger.warn(`媒體補檔失敗 ${filename}:${(err as Error).message}`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  private async fileExists(p: string): Promise<boolean> {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }
}
