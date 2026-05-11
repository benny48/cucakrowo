import { Module } from '@nestjs/common';

import { ContractResolver } from './contract.resolver';
import { ContractService } from './contract.service';
import { OdooAuthService } from '../odoo-auth/odoo-auth.service';

@Module({
  providers: [
    ContractResolver,
    ContractService,
    OdooAuthService,
  ],
})
export class ContractModule {}