import { Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name);
  private readonly redisClient: Redis;

  constructor() {
    const host = process.env.REDIS_HOST || 'localhost';
    const port = parseInt(process.env.REDIS_PORT || '6379');
    const db = parseInt(process.env.REDIS_DB || '0');

    this.logger.log(
      `📌 Menginisialisasi koneksi Redis: ${host}:${port} (DB: ${db})`,
    );

    this.redisClient = new Redis({
      host,
      port,
      password: process.env.REDIS_PASSWORD,
      db,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        this.logger.warn(
          `⚠️ Redis koneksi gagal, mencoba ulang dalam ${delay}ms...`,
        );
        return delay;
      },
    });

    this.redisClient.on('connect', () => {
      this.logger.log('✅ Redis terhubung berhasil');
    });

    this.redisClient.on('error', (err) => {
      this.logger.error(`❌ Redis error: ${err.message}`, err.stack);
    });
  }

  async get(key: string): Promise<string | null> {
    try {
      const result = await this.redisClient.get(key);
      if (result) {
        this.logger.debug(`📖 Redis GET: ${key} (${result.length} bytes)`);
      } else {
        this.logger.debug(`📖 Redis GET: ${key} (cache miss)`);
      }
      return result;
    } catch (error) {
      this.logger.error(
        `❌ Redis GET error untuk key ${key}: ${error.message}`,
      );
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    try {
      if (ttlSeconds) {
        await this.redisClient.set(key, value, 'EX', ttlSeconds);
        this.logger.debug(
          `📝 Redis SET: ${key} (${value.length} bytes, TTL: ${ttlSeconds}s)`,
        );
      } else {
        await this.redisClient.set(key, value);
        this.logger.debug(
          `📝 Redis SET: ${key} (${value.length} bytes, no TTL)`,
        );
      }
    } catch (error) {
      this.logger.error(
        `❌ Redis SET error untuk key ${key}: ${error.message}`,
      );
    }
  }

  async del(key: string | string[]): Promise<void> {
    try {
      if (Array.isArray(key)) {
        if (key.length === 0) return;
        const result = await this.redisClient.del(...key);
        this.logger.debug(
          `🗑️ Redis DEL: ${key.length} keys (${result} keys removed)`,
        );
      } else {
        const result = await this.redisClient.del(key);
        this.logger.debug(`🗑️ Redis DEL: ${key} (${result} keys removed)`);
      }
    } catch (error) {
      this.logger.error(`❌ Redis DEL error: ${error.message}`);
    }
  }

  async keys(pattern: string): Promise<string[]> {
    try {
      const keys = await this.redisClient.keys(pattern);
      this.logger.debug(
        `🔍 Redis KEYS: ${pattern} (${keys.length} keys found)`,
      );
      return keys;
    } catch (error) {
      this.logger.error(
        `❌ Redis KEYS error untuk pattern ${pattern}: ${error.message}`,
      );
      return [];
    }
  }

  async flushAll(): Promise<void> {
    try {
      await this.redisClient.flushall();
      this.logger.warn('⚠️ Redis FLUSHALL: Semua data cache dihapus');
    } catch (error) {
      this.logger.error(`❌ Redis FLUSHALL error: ${error.message}`);
    }
  }

  // tambahkan di RedisService
  async delPattern(pattern: string): Promise<number> {
    try {
      this.logger.debug(`🧹 DELPATTERN start: ${pattern}`);
      let cursor = '0';
      let totalRemoved = 0;

      do {
        // SCAN agar tidak blocking seperti KEYS
        const [nextCursor, keys] = await this.redisClient.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          '1000',
        );
        cursor = nextCursor;

        if (keys.length > 0) {
          // gunakan UNLINK (non-blocking) jika tersedia, fallback ke DEL
          const pipeline = this.redisClient.pipeline();
          for (const k of keys) {
            // @ts-ignore ioredis punya unlink; kalau tidak ada akan jatuh ke del
            if (typeof (this.redisClient as any).unlink === 'function') {
              (pipeline as any).unlink(k);
            } else {
              pipeline.del(k);
            }
          }
          const res = await pipeline.exec();
          totalRemoved += res?.length ?? 0;
          this.logger.debug(
            `🧹 DELPATTERN batch: ${keys.length} keys for ${pattern}`,
          );
        }
      } while (cursor !== '0');

      this.logger.log(
        `✅ DELPATTERN done: ${totalRemoved} keys removed for ${pattern}`,
      );
      return totalRemoved;
    } catch (error: any) {
      this.logger.error(
        `❌ Redis DELPATTERN error untuk pattern ${pattern}: ${error.message}`,
      );
      return 0;
    }
  }
}
