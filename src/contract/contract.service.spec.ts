import { Test, TestingModule } from '@nestjs/testing';
import { ContractService } from './contract.service';
import { OdooAuthService } from '../odoo-auth/odoo-auth.service';

describe('ContractService', () => {
  let service: ContractService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractService,
        OdooAuthService,
      ],
    }).compile();

    service = module.get<ContractService>(ContractService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});