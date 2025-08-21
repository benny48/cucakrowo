import { Module } from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { PayrollResolver } from './payroll.resolver';

// === Sesuaikan dengan modul yang kamu punya ===
// Pastikan kedua module di bawah menyediakan OdooAuthService & RedisService via DI.
import { OdooAuthService } from '../odoo-auth/odoo-auth.service';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [RedisModule],
  providers: [PayrollService, PayrollResolver, OdooAuthService],
  // exports: [PayrollService, OdooAuthService],
})
export class PayrollModule {}
