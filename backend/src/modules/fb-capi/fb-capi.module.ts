import { Module } from '@nestjs/common';
import { FbCapiService } from './fb-capi.service';

@Module({
  providers: [FbCapiService],
  exports: [FbCapiService],
})
export class FbCapiModule {}
