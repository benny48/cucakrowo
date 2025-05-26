import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { OdooAuthService } from '../odoo-auth/odoo-auth.service';
import { RedisService } from '../redis/redis.service';
import { CreateAttendanceDto } from './dto/create-attendance.dto/create-attendance.dto';
import * as moment from 'moment-timezone';

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    private readonly odooAuthService: OdooAuthService,
    private readonly redisService: RedisService,
  ) {}

  private readonly odooUrl = process.env.ODOO_URL;
  private readonly ATTENDANCE_CACHE_TTL = 900; // 15 menit dalam detik

  // Helper untuk membuat kunci cache berdasarkan employeeId dan tanggal
  private getAttendanceCacheKey(employeeId: number, date?: string): string {
    const formattedDate =
      date || moment().tz('Asia/Jakarta').format('YYYY-MM-DD');
    return `attendance:employee:${employeeId}:date:${formattedDate}`;
  }

  // Helper untuk memastikan field name adalah array
  private ensureNameIsArray(data: any): any {
    if (Array.isArray(data)) {
      return data.map((item) => {
        if (Array.isArray(item.name)) {
          return item; // sudah array
        } else {
          return {
            ...item,
            name: [String(item.name), `Employee ${item.name}`],
          };
        }
      });
    } else {
      // single object
      if (Array.isArray(data.name)) {
        return data; // sudah array
      } else {
        return {
          ...data,
          name: [String(data.name), `Employee ${data.name}`],
        };
      }
    }
  }

  async createAttendance(input: CreateAttendanceDto): Promise<any> {
    this.logger.log(
      `🔄 Membuat attendance baru untuk karyawan ID: ${input.employeeId}`,
    );

    const uid = await this.odooAuthService.authenticate();
    if (!uid) throw new Error('Gagal autentikasi ke Odoo');

    // Convert input tanggal_absen (WIB) to UTC before sending to Odoo
    const formattedDate = this.convertWIBtoUTC(input.tanggal_absen);
    const dayOfWeek = this.getDayOfWeek(input.tanggal_absen);
    const timeInFloat = this.convertTimeToFloat(input.tanggal_absen);
    const tanggal = this.convertToDateOnly(input.tanggal_absen);
    const base64Image = this.cleanBase64(input.attendace_image);

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
          'ssm.attendance',
          'create',
          [
            {
              name: input.employeeId,
              nik: input.nik,
              hari: dayOfWeek,
              tanggal_absen: formattedDate,
              time: timeInFloat,
              tangal: tanggal,
              punching_type: input.punching_type,
              attendace_image: base64Image,
            },
          ],
        ],
      },
    });

    const result = response.data.result;
    if (!result) {
      this.logger.error('❌ Gagal membuat attendance di Odoo');
      throw new Error('Gagal membuat attendance');
    }

    // Invalidasi cache untuk employee ini pada hari ini
    const cacheKey = this.getAttendanceCacheKey(input.employeeId);
    await this.redisService.del(cacheKey);
    this.logger.log(
      `🗑️ Cache attendance untuk karyawan ID ${input.employeeId} di-invalidasi`,
    );

    return result;
  }

  // Fungsi untuk mendapatkan data absensi berdasarkan employee ID dan tanggal hari ini
  async getAttendanceByEmployeeIdToday(employeeId: number): Promise<any> {
    // Cek cache terlebih dahulu
    const cacheKey = this.getAttendanceCacheKey(employeeId);
    const cachedAttendance = await this.redisService.get(cacheKey);

    if (cachedAttendance) {
      this.logger.log(
        `✅ Data attendance untuk karyawan ID ${employeeId} diambil dari REDIS cache`,
      );
      const parsed = JSON.parse(cachedAttendance);
      return this.ensureNameIsArray(parsed);
    }

    this.logger.log(
      `⚠️ Cache miss! Mengambil data attendance untuk karyawan ID ${employeeId} dari ODOO...`,
    );

    const uid = await this.odooAuthService.authenticate();
    if (!uid) throw new Error('Gagal autentikasi ke Odoo');

    // Mendapatkan tanggal hari ini dalam format YYYY-MM-DD
    const todayDate = moment().tz('Asia/Jakarta').format('YYYY-MM-DD');

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
          'ssm.attendance',
          'search_read',
          [
            [
              ['name.id', '=', employeeId],
              ['tangal', '=', todayDate],
            ],
          ],
          {
            fields: [
              'name',
              'nik',
              'hari',
              'tanggal_absen',
              'time',
              'tangal',
              'punching_type',
              'attendace_image',
            ],
          },
        ],
      },
    });

    const result = response.data.result || [];

    // Simpan ke cache dengan TTL 15 menit
    await this.redisService.set(
      cacheKey,
      JSON.stringify(result),
      this.ATTENDANCE_CACHE_TTL,
    );

    this.logger.log(
      `✅ Data ${result.length} attendance untuk karyawan ID ${employeeId} disimpan ke cache (TTL: ${this.ATTENDANCE_CACHE_TTL}s)`,
    );

    // Pastikan name adalah array sebelum return
    return this.ensureNameIsArray(result);
  }

  // Tambahan: fungsi untuk mendapatkan semua attendance berdasarkan rentang tanggal
  async getAttendanceByDateRange(
    startDate: string,
    endDate: string,
  ): Promise<any> {
    const cacheKey = `attendance:range:${startDate}:${endDate}`;
    const cachedData = await this.redisService.get(cacheKey);

    if (cachedData) {
      this.logger.log(
        `✅ Data attendance untuk rentang ${startDate} - ${endDate} diambil dari REDIS cache`,
      );
      const parsed = JSON.parse(cachedData);
      return this.ensureNameIsArray(parsed);
    }

    this.logger.log(
      `⚠️ Cache miss! Mengambil data attendance untuk rentang ${startDate} - ${endDate} dari ODOO...`,
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
          'ssm.attendance',
          'search_read',
          [
            [
              ['tangal', '>=', startDate],
              ['tangal', '<=', endDate],
            ],
          ],
          {
            fields: [
              'name',
              'nik',
              'hari',
              'tanggal_absen',
              'time',
              'tangal',
              'punching_type',
            ],
          },
        ],
      },
    });

    const result = response.data.result || [];

    // Simpan ke cache dengan TTL 30 menit untuk data historis
    await this.redisService.set(
      cacheKey,
      JSON.stringify(result),
      1800, // 30 menit untuk data historis
    );

    this.logger.log(
      `✅ Data ${result.length} attendance untuk rentang tanggal disimpan ke cache (TTL: 1800s)`,
    );

    // Pastikan name adalah array sebelum return
    return this.ensureNameIsArray(result);
  }

  // Fungsi untuk mendapatkan attendance berdasarkan employee ID dan rentang tanggal
  async getAttendanceByEmployeeIdAndDateRange(
    employeeId: number,
    startDate: string,
    endDate: string,
  ): Promise<any> {
    const cacheKey = `attendance:employee:${employeeId}:range:${startDate}:${endDate}`;
    const cachedData = await this.redisService.get(cacheKey);

    if (cachedData) {
      this.logger.log(
        `✅ Data attendance untuk employee ${employeeId} rentang ${startDate} - ${endDate} diambil dari REDIS cache`,
      );
      const parsed = JSON.parse(cachedData);
      return this.ensureNameIsArray(parsed);
    }

    this.logger.log(
      `⚠️ Cache miss! Mengambil data attendance untuk employee ${employeeId} rentang ${startDate} - ${endDate} dari ODOO...`,
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
          'ssm.attendance',
          'search_read',
          [
            [
              ['name.id', '=', employeeId],
              ['tangal', '>=', startDate],
              ['tangal', '<=', endDate],
            ],
          ],
          {
            fields: [
              'name',
              'nik',
              'hari',
              'tanggal_absen',
              'time',
              'tangal',
              'punching_type',
              'attendace_image',
            ],
          },
        ],
      },
    });

    const result = response.data.result || [];

    // Simpan ke cache dengan TTL 30 menit untuk data historis
    await this.redisService.set(
      cacheKey,
      JSON.stringify(result),
      1800, // 30 menit untuk data historis
    );

    this.logger.log(
      `✅ Data ${result.length} attendance untuk employee ${employeeId} rentang ${startDate} - ${endDate} disimpan ke cache (TTL: 1800s)`,
    );

    // Pastikan name adalah array sebelum return
    return this.ensureNameIsArray(result);
  }

  // Hapus prefix "data:image/...;base64,"
  private cleanBase64(base64String: string): string {
    if (base64String.includes('base64,')) {
      return base64String.split('base64,')[1]; // hanya base64 tanpa prefix
    }
    return base64String;
  }

  // Function to convert local WIB time (DD/MM/YYYY HH:mm:ss) to UTC
  private convertWIBtoUTC(date: string): string {
    // Parse the input date (DD/MM/YYYY HH:mm:ss)
    const parsedDate = moment(date, 'DD/MM/YYYY HH:mm:ss');

    // Convert to UTC by subtracting 7 hours (WIB -> UTC)
    const utcDate = parsedDate.subtract(7, 'hours'); // Convert WIB to UTC

    // Format the UTC time to the required format (YYYY-MM-DD HH:mm:ss)
    return utcDate.format('YYYY-MM-DD HH:mm:ss'); // Return UTC time
  }

  // Function to get the day of the week from the input date in Indonesian
  private getDayOfWeek(date: string): string {
    // Parse the input date (DD/MM/YYYY)
    const parsedDate = moment(date, 'DD/MM/YYYY HH:mm:ss');

    // Mapping day of the week in English to Indonesian
    const dayOfWeekInEnglish = parsedDate.format('dddd');
    const dayOfWeekInIndonesian =
      this.translateDayToIndonesian(dayOfWeekInEnglish);

    return dayOfWeekInIndonesian; // Return day of the week in Indonesian
  }

  // Function to translate English day of the week to Indonesian
  private translateDayToIndonesian(day: string): string {
    const daysInIndonesian = {
      Sunday: 'Minggu',
      Monday: 'Senin',
      Tuesday: 'Selasa',
      Wednesday: 'Rabu',
      Thursday: 'Kamis',
      Friday: 'Jumat',
      Saturday: 'Sabtu',
    };

    return daysInIndonesian[day] || day; // Return the translated day
  }

  // Function to convert time into float (hours in decimal format)
  private convertTimeToFloat(date: string): number {
    // Parse the input date (DD/MM/YYYY HH:mm:ss)
    const parsedDate = moment(date, 'DD/MM/YYYY HH:mm:ss');

    // Extract hours and minutes
    const hours = parsedDate.hour();
    const minutes = parsedDate.minute();

    // Convert minutes to decimal
    const minutesInDecimal = minutes / 60;

    // Combine hours and decimal minutes
    const timeInFloat = hours + minutesInDecimal;

    return timeInFloat; // Return time as float
  }

  // Function to convert date to YYYY-MM-DD (Date Only)
  private convertToDateOnly(date: string): string {
    // Parse the input date (DD/MM/YYYY HH:mm:ss)
    const parsedDate = moment(date, 'DD/MM/YYYY HH:mm:ss');

    // Return the date part in format YYYY-MM-DD
    return parsedDate.format('YYYY-MM-DD'); // Return date only (no time)
  }
}
