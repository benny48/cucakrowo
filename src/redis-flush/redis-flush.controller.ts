// src/redis-flush/redis-flush.controller.ts
import { Controller, Delete } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

@Controller('redis')
export class RedisFlushController {
  constructor(private readonly redisService: RedisService) {}

  @Delete('flush')
  async flush(): Promise<{ message: string }> {
    await this.redisService.flushAll();
    return { message: '✅ Semua data Redis telah dihapus (FLUSHALL)' };
  }
}
