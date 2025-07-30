// src/redis-flush/redis-flush.module.ts
import { Module } from '@nestjs/common';
import { RedisFlushController } from './redis-flush.controller';
import { RedisService } from '../redis/redis.service';

@Module({
  controllers: [RedisFlushController],
  providers: [RedisService], // gunakan service yang sudah ada
})
export class RedisFlushModule {}
