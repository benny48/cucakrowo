import { Test, TestingModule } from '@nestjs/testing';
import { ContractResolver } from './contract.resolver';
import { ContractService } from './contract.service';

describe('ContractResolver', () => {
  let resolver: ContractResolver;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractResolver,
        ContractService,
      ],
    }).compile();

    resolver = module.get<ContractResolver>(ContractResolver);
  });

  it('should be defined', () => {
    expect(resolver).toBeDefined();
  });
});