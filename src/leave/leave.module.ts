import { Module } from '@nestjs/common';
import { LeaveService } from './leave.service';
import { LeaveResolver } from './leave.resolver';
import { OdooAuthService } from 'src/odoo-auth/odoo-auth.service';
import { RedisModule } from 'src/redis/redis.module';

@Module({
  imports: [RedisModule],
  providers: [LeaveService, LeaveResolver, OdooAuthService],
})
export class LeaveModule {}
