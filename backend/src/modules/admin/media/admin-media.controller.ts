import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { AdminMediaService } from './admin-media.service';
import { AdminJwtGuard } from '../../../common/guards/admin-jwt.guard';
import { AdminIpWhitelistGuard } from '../../../common/guards/admin-ip-whitelist.guard';
import { CurrentAdmin } from '../../../common/decorators/current-admin.decorator';
import { AdminAuditService } from '../audit/admin-audit.service';

@Controller('admin/media')
@UseGuards(AdminIpWhitelistGuard, AdminJwtGuard)
export class AdminMediaController {
  constructor(
    private readonly media: AdminMediaService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get()
  list(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('include_deleted') includeDeleted?: string,
  ) {
    return this.media.list({
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
      includeDeleted: includeDeleted === 'true' || includeDeleted === '1',
    });
  }

  @Patch(':id/restore')
  async restore(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentAdmin() admin: { id: string },
    @Req() req: Request,
  ) {
    const result = await this.media.restore(id);
    await this.audit.log({
      adminId: admin.id,
      action: 'restore_media',
      targetType: 'media',
      targetId: id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']?.toString(),
    });
    return result;
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @CurrentAdmin() admin: { id: string },
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('未收到上傳檔案(field name 必須是 "file")');
    const result = await this.media.upload({
      buffer: file.buffer,
      mimetype: file.mimetype,
      originalname: file.originalname,
      size: file.size,
      uploadedBy: admin.id,
    });
    await this.audit.log({
      adminId: admin.id,
      action: 'upload_media',
      targetType: 'media',
      targetId: result.id,
      payload: { filename: result.filename, size: result.size_bytes, mime: result.mime_type },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']?.toString(),
    });
    return result;
  }

  @Delete(':id')
  async softDelete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentAdmin() admin: { id: string },
    @Req() req: Request,
  ) {
    const result = await this.media.softDelete(id);
    await this.audit.log({
      adminId: admin.id,
      action: 'delete_media',
      targetType: 'media',
      targetId: id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']?.toString(),
    });
    return result;
  }
}
