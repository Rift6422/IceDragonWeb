import { Module } from '@nestjs/common';
import { MyCardApiService } from './api-client/mycard-api.service';
import { MyCardHashFactory } from './hash/mycard-hash.factory';

@Module({
  providers: [MyCardApiService, MyCardHashFactory],
  exports: [MyCardApiService, MyCardHashFactory],
})
export class MyCardModule {}
