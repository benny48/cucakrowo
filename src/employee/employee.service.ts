import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import axios from 'axios';
import { OdooAuthService } from '../odoo-auth/odoo-auth.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class EmployeeService {
  private readonly logger = new Logger(EmployeeService.name);

  constructor(
    private readonly odooAuthService: OdooAuthService,
    private readonly redisService: RedisService,
  ) {}

  private readonly odooUrl = process.env.ODOO_URL;
  private readonly CACHE_TTL = 3600; // 1 jam
  private readonly EMPLOYEE_CACHE_KEY = 'employees:all';
  private readonly MOBILE_APP_VERSION = process.env.MOBILE_APP_VERSION || '';
  private readonly MOBILE_APP_FORCE_UPDATE =
    String(process.env.MOBILE_APP_FORCE_UPDATE || 'true').toLowerCase() ===
    'true';

  private getEmployeeByIdCacheKey(id: number): string {
    return `employee:id:${id}`;
  }

  private getValidateCacheKey(username: string, appVersion?: string): string {
    return `employee:validate:${username}:${appVersion || 'no_version'}`;
  }

  private assertMobileVersion(appVersion?: string): void {
    if (!this.MOBILE_APP_FORCE_UPDATE) {
      return;
    }

    const clientVersion = String(appVersion || '').trim();
    const serverVersion = String(this.MOBILE_APP_VERSION || '').trim();

    if (!serverVersion) {
      this.logger.warn(
        '⚠️ MOBILE_APP_VERSION belum diset, pengecekan versi dilewati',
      );
      return;
    }

    if (!clientVersion) {
      this.logger.warn('❌ Client tidak mengirim appVersion');
      throw new UnauthorizedException(
        `Versi aplikasi wajib dikirim. Gunakan versi ${serverVersion}`,
      );
    }

    if (clientVersion !== serverVersion) {
      this.logger.warn(
        `❌ Versi aplikasi tidak cocok. client=${clientVersion}, server=${serverVersion}`,
      );
      throw new UnauthorizedException(
        `Versi aplikasi tidak didukung. Gunakan versi ${serverVersion}`,
      );
    }
  }

  async getEmployees(): Promise<any[]> {
    const cachedEmployees = await this.redisService.get(
      this.EMPLOYEE_CACHE_KEY,
    );
    if (cachedEmployees) {
      this.logger.log('✅ Data karyawan diambil dari REDIS cache');
      return JSON.parse(cachedEmployees);
    }

    this.logger.log('⚠️ Cache miss! Mengambil data karyawan dari ODOO...');

    const uid = await this.odooAuthService.authenticate();
    if (!uid) throw new Error('Gagal autentikasi ke Odoo');

    const response = await axios.post(this.odooUrl, {
      jsonrpc: '2.0',
      method: 'call',
      id: new Date().getTime(),
      params: {
        service: 'object',
        method: 'execute_kw',
        args: [
          process.env.ODOO_DB,
          uid,
          process.env.ODOO_PASSWORD,
          'hr.employee',
          'search_read',
          [[]],
          {
            fields: [
              'id',
              'name',
              'username',
              'password',
              'position',
              'latitude',
              'longitude',
              'lock_location',
              'mobile_id',
              'distance_work',
            ],
          },
        ],
      },
    });

    const employees = response.data.result || [];

    await this.redisService.set(
      this.EMPLOYEE_CACHE_KEY,
      JSON.stringify(employees),
      this.CACHE_TTL,
    );

    this.logger.log(
      `✅ Data ${employees.length} karyawan berhasil disimpan ke cache (TTL: ${this.CACHE_TTL}s)`,
    );

    return employees;
  }

  async getEmployeeById(id: number): Promise<any> {
    const cacheKey = this.getEmployeeByIdCacheKey(id);
    const cachedEmployee = await this.redisService.get(cacheKey);

    if (cachedEmployee) {
      this.logger.log(`✅ Data karyawan ID ${id} diambil dari REDIS cache`);
      return JSON.parse(cachedEmployee);
    }

    this.logger.log(
      `⚠️ Cache miss! Mengambil data karyawan ID ${id} dari ODOO...`,
    );

    const uid = await this.odooAuthService.authenticate();
    if (!uid) throw new Error('Gagal autentikasi ke Odoo');

    const response = await axios.post(this.odooUrl, {
      jsonrpc: '2.0',
      method: 'call',
      id: new Date().getTime(),
      params: {
        service: 'object',
        method: 'execute_kw',
        args: [
          process.env.ODOO_DB,
          uid,
          process.env.ODOO_PASSWORD,
          'hr.employee',
          'search_read',
          [[['id', '=', id]]],
          {
            fields: [
              'id',
              'name',
              'username',
              'position',
              'latitude',
              'longitude',
              'lock_location',
              'mobile_id',
              'distance_work',
            ],
            limit: 1,
          },
        ],
      },
    });

    const employee = response.data.result?.[0];
    if (!employee) {
      this.logger.warn(`❌ Karyawan ID ${id} tidak ditemukan`);
      throw new Error('Karyawan tidak ditemukan');
    }

    await this.redisService.set(
      cacheKey,
      JSON.stringify(employee),
      this.CACHE_TTL,
    );

    this.logger.log(
      `✅ Data karyawan ID ${id} berhasil disimpan ke cache (TTL: ${this.CACHE_TTL}s)`,
    );

    return employee;
  }

  async createEmployee(name: string, job_title: string): Promise<any> {
    this.logger.log(`🔄 Membuat karyawan baru: ${name}, ${job_title}`);

    const uid = await this.odooAuthService.authenticate();
    if (!uid) throw new Error('Gagal autentikasi ke Odoo');

    const response = await axios.post(this.odooUrl, {
      jsonrpc: '2.0',
      method: 'call',
      id: new Date().getTime(),
      params: {
        service: 'object',
        method: 'execute_kw',
        args: [
          process.env.ODOO_DB,
          uid,
          process.env.ODOO_PASSWORD,
          'hr.employee',
          'create',
          [{ name, job_title }],
        ],
      },
    });

    const newEmployeeId = response.data.result;
    const newEmployee = { id: newEmployeeId, name, job_title };

    await this.invalidateEmployeeCaches(newEmployeeId);
    this.logger.log('🗑️ Cache karyawan diinvalidasi karena ada data baru');

    return newEmployee;
  }

  async validateEmployee(
    username: string,
    password: string,
    appVersion?: string,
  ): Promise<any> {
    this.assertMobileVersion(appVersion);

    const cacheKey = this.getValidateCacheKey(username, appVersion);
    const cachedEmployee = await this.redisService.get(cacheKey);

    if (cachedEmployee) {
      this.logger.log(
        `✅ Data validasi untuk ${username} diambil dari REDIS cache`,
      );
      const employee = JSON.parse(cachedEmployee);
      if (employee.password === password) {
        return {
          ...employee,
          app_version: this.MOBILE_APP_VERSION,
        };
      }
      this.logger.log(
        `⚠️ Password tidak cocok untuk cached user ${username}, mencoba dari sumber data`,
      );
    }

    this.logger.log(
      `⚠️ Cache miss untuk validasi ${username}, mengambil data dari ODOO...`,
    );

    const employees = await this.getEmployees();
    const employee = employees.find(
      (emp) => emp.username === username && emp.password === password,
    );

    if (!employee) {
      this.logger.warn(
        `❌ Validasi gagal: Username ${username} atau password salah`,
      );
      throw new Error('Username atau password salah');
    }

    await this.redisService.set(cacheKey, JSON.stringify(employee), 1800);

    this.logger.log(
      `✅ Data validasi untuk ${username} disimpan ke cache (TTL: 1800s)`,
    );

    return {
      ...employee,
      app_version: this.MOBILE_APP_VERSION,
    };
  }

  async updateEmployeeLocation(
    id: number,
    latitude: number,
    longitude: number,
  ): Promise<any> {
    this.logger.log(
      `🛰️ Update lokasi karyawan ID ${id}: lat=${latitude}, long=${longitude}`,
    );

    const uid = await this.odooAuthService.authenticate();
    if (!uid) throw new Error('Gagal autentikasi ke Odoo');

    const response = await axios.post(this.odooUrl, {
      jsonrpc: '2.0',
      method: 'call',
      id: new Date().getTime(),
      params: {
        service: 'object',
        method: 'execute_kw',
        args: [
          process.env.ODOO_DB,
          uid,
          process.env.ODOO_PASSWORD,
          'hr.employee',
          'write',
          [
            [id],
            { latitude, longitude, lock_location: true, distance_work: 50 },
          ],
        ],
      },
    });

    await this.invalidateEmployeeCaches(id);
    this.logger.log(`📍 Lokasi karyawan ${id} berhasil diperbarui`);

    return response.data.result;
  }

  async invalidateEmployeeCaches(
    id?: number,
    username?: string,
  ): Promise<void> {
    await this.redisService.del(this.EMPLOYEE_CACHE_KEY);

    if (id) {
      await this.redisService.del(this.getEmployeeByIdCacheKey(id));
    }

    if (username) {
      await this.redisService.del(this.getValidateCacheKey(username));
    }
  }
}
