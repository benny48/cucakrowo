import { Module } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { AttendanceResolver } from './attendance.resolver';
import { OdooAuthService } from 'src/odoo-auth/odoo-auth.service';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [RedisModule],
  providers: [AttendanceService, AttendanceResolver, OdooAuthService],
})
export class AttendanceModule {}
