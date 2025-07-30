import { Test, TestingModule } from '@nestjs/testing';
import { RedisFlushController } from './redis-flush.controller';

describe('RedisFlushController', () => {
  let controller: RedisFlushController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RedisFlushController],
    }).compile();

    controller = module.get<RedisFlushController>(RedisFlushController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
