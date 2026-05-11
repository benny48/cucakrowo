import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { OdooAuthService } from '../odoo-auth/odoo-auth.service';
import { RedisService } from '../redis/redis.service';
import { CreateAttendanceDto } from './dto/create-attendance.dto/create-attendance.dto';
import * as moment from 'moment-timezone';
import { EmployeeService } from '../employee/employee.service';

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    private readonly odooAuthService: OdooAuthService,
    private readonly redisService: RedisService,
    private readonly employeeService: EmployeeService,
  ) {}

  private readonly odooUrl = process.env.ODOO_URL;
  private readonly ATTENDANCE_CACHE_TTL = 900; // 15 menit
  private readonly DEFAULT_MAX_ACCURACY_METERS = Number(
    process.env.MAX_LOCATION_ACCURACY_METERS || 50,
  );
  private readonly DEFAULT_LATE_LIMIT = process.env.LATE_LIMIT || '08:05';

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

    const nowJakarta = moment().tz('Asia/Jakarta');
    const formattedDate = nowJakarta
      .clone()
      .utc()
      .format('YYYY-MM-DD HH:mm:ss');
    const dayOfWeek = this.translateDayToIndonesian(nowJakarta.format('dddd'));
    const timeInFloat = nowJakarta.hours() + nowJakarta.minutes() / 60;
    const tanggal = nowJakarta.format('YYYY-MM-DD');
    const base64Image = this.cleanBase64(input.attendace_image);

    // Ambil employee resmi dari Odoo
    const employee = await this.employeeService.getEmployeeById(
      input.employeeId,
    );

    // Validasi mobile_id jika tersedia
    if (
      employee?.mobile_id &&
      input.mobile_id &&
      String(employee.mobile_id).trim() !== String(input.mobile_id).trim()
    ) {
      this.logger.warn(
        `❌ Mobile ID tidak cocok untuk employee ${input.employeeId}. expected=${employee.mobile_id}, actual=${input.mobile_id}`,
      );
      throw new Error('Perangkat tidak terdaftar untuk absensi');
    }

    // Cegah lebih dari 2 absensi per hari
    const existingAttendance = await this.getAttendanceByEmployeeIdToday(
      input.employeeId,
    );
    if (existingAttendance.length >= 2) {
      this.logger.warn(
        `❌ Employee ${input.employeeId} sudah memiliki ${existingAttendance.length} absensi hari ini`,
      );
      throw new Error('Anda sudah melakukan absensi maksimal hari ini');
    }

    // Tentukan punching_type bila perlu
    const punchingType =
      input.punching_type ?? (existingAttendance.length === 0 ? '0' : '1');

    // Validasi urutan sederhana
    if (existingAttendance.length === 1) {
      const existingType = String(existingAttendance[0]?.punching_type ?? '');
      if (existingType === punchingType) {
        throw new Error('Urutan absensi tidak valid');
      }
    }

    // Validasi lokasi ketat jika employee lock lokasi
    await this.validateAttendanceLocationStrict(input, employee);

    // Hitung telat di backend
    const lateInfo = this.computeLateInfo(nowJakarta, punchingType, input);

    const attendancePayload: any = {
      employee_id: input.employeeId,
      nik: input.nik,
      hari: dayOfWeek,
      tanggal_absen: formattedDate,
      time: timeInFloat,
      tangal: tanggal,
      punching_type: punchingType,
      attendace_image: base64Image,
      late: lateInfo.late,
      late_reason: lateInfo.lateReason,
    };

    // Simpan metadata tambahan kalau field Odoo tersedia
    if (typeof input.latitude === 'number')
      attendancePayload.latitude = input.latitude;
    if (typeof input.longitude === 'number')
      attendancePayload.longitude = input.longitude;
    if (typeof input.accuracy === 'number')
      attendancePayload.location_accuracy = input.accuracy;
    if (typeof input.is_mock_location === 'boolean') {
      attendancePayload.is_mock_location = input.is_mock_location;
    }
    if (input.location_provider) {
      attendancePayload.location_provider = input.location_provider;
    }
    if (input.device_location_time) {
      attendancePayload.device_location_time = input.device_location_time;
    }

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
          [attendancePayload],
        ],
      },
    });

    const result = response.data.result;
    if (!result) {
      this.logger.error('❌ Gagal membuat attendance di Odoo');
      throw new Error('Gagal membuat attendance');
    }

    const cacheKey = this.getAttendanceCacheKey(input.employeeId);
    await this.redisService.del(cacheKey);
    this.logger.log(
      `🗑️ Cache attendance untuk karyawan ID ${input.employeeId} di-invalidasi`,
    );

    return result;
  }

  async getAttendanceByEmployeeIdToday(employeeId: number): Promise<any> {
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
              ['employee_id.id', '=', employeeId],
              ['tangal', '=', todayDate],
            ],
          ],
          {
            fields: [
              'employee_id',
              'nik',
              'hari',
              'tanggal_absen',
              'time',
              'tangal',
              'punching_type',
              'attendace_image',
              'late',
              'late_reason',
            ],
            order: 'tanggal_absen asc',
          },
        ],
      },
    });

    const result = response.data.result || [];

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

  async getAttendanceByDateRange(
    startDate: string,
    endDate: string,
    employeeId?: number,
  ): Promise<any> {
    const cacheKey = employeeId
      ? `attendance:range:${startDate}:${endDate}:emp:${employeeId}`
      : `attendance:range:${startDate}:${endDate}`;
    const cachedData = await this.redisService.get(cacheKey);

    if (cachedData) {
      this.logger.log(
        `✅ Data attendance untuk rentang ${startDate} - ${endDate} diambil dari REDIS cache`,
      );
      const parsed = JSON.parse(cachedData);
      return this.ensureNameIsArray(parsed);
    }

    this.logger.log(
      `⚠️ Cache miss! Mengambil data attendance dari ODOO untuk ${cacheKey}...`,
    );

    const uid = await this.odooAuthService.authenticate();
    if (!uid) throw new Error('Gagal autentikasi ke Odoo');

    const domainFilter: any[] = [
      ['tangal', '>=', startDate],
      ['tangal', '<=', endDate],
    ];

    if (employeeId) {
      domainFilter.push(['employee_id', '=', employeeId]);
    }

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
          [domainFilter],
          {
            fields: [
              'employee_id',
              'nik',
              'hari',
              'tanggal_absen',
              'time',
              'tangal',
              'punching_type',
              'late',
              'late_reason',
            ],
          },
        ],
      },
    });

    const result = response.data.result || [];

    await this.redisService.set(cacheKey, JSON.stringify(result), 1800);

    this.logger.log(
      `✅ Data ${result.length} attendance untuk ${cacheKey} disimpan ke cache`,
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

  private async validateAttendanceLocationStrict(
    input: CreateAttendanceDto,
    employee: any,
  ): Promise<void> {
    const lockLocation = this.toBoolean(employee?.lock_location);

    if (!lockLocation) {
      this.logger.log(
        `ℹ️ Employee ${input.employeeId} tidak menggunakan lock location`,
      );
      return;
    }

    const officeLat = this.toNumber(employee?.latitude);
    const officeLon = this.toNumber(employee?.longitude);
    const allowedDistance = this.toNumber(employee?.distance_work) ?? 50;

    if (officeLat === null || officeLon === null) {
      this.logger.warn(
        `❌ Lokasi referensi employee ${input.employeeId} belum diset`,
      );
      throw new Error('Lokasi referensi karyawan belum dikonfigurasi');
    }

    if (input.is_mock_location === true) {
      this.logger.warn(
        `❌ Mock location flag diterima dari client untuk employee ${input.employeeId}`,
      );
      throw new Error('Mock location terdeteksi');
    }

    const actualLat = this.toNumber(input.latitude);
    const actualLon = this.toNumber(input.longitude);
    const accuracy = this.toNumber(input.accuracy);

    if (actualLat === null || actualLon === null) {
      this.logger.warn(
        `❌ Koordinat absensi kosong untuk employee ${input.employeeId}`,
      );
      throw new Error('Lokasi absensi tidak valid');
    }

    if (accuracy !== null && accuracy > this.DEFAULT_MAX_ACCURACY_METERS) {
      this.logger.warn(
        `❌ Accuracy terlalu buruk untuk employee ${input.employeeId}: ${accuracy}m`,
      );
      throw new Error(
        `Akurasi lokasi terlalu rendah. Maksimal ${this.DEFAULT_MAX_ACCURACY_METERS} meter`,
      );
    }

    const distanceMeters = this.calculateDistanceMeters(
      actualLat,
      actualLon,
      officeLat,
      officeLon,
    );

    this.logger.log(
      `📍 Validasi lokasi employee ${input.employeeId}: actual=(${actualLat},${actualLon}) office=(${officeLat},${officeLon}) distance=${distanceMeters.toFixed(2)}m allowed=${allowedDistance}m accuracy=${accuracy ?? 'n/a'}m`,
    );

    if (distanceMeters > allowedDistance) {
      throw new Error(
        `Anda berada di luar radius absensi. Jarak ${distanceMeters.toFixed(1)} meter, maksimal ${allowedDistance} meter`,
      );
    }
  }

  private computeLateInfo(
    nowJakarta: moment.Moment,
    punchingType: string,
    input: CreateAttendanceDto,
  ): { late: boolean; lateReason: string | null } {
    // hanya check-in
    if (String(punchingType) !== '0') {
      return { late: false, lateReason: null };
    }

    const [hourStr, minuteStr] = this.DEFAULT_LATE_LIMIT.split(':');
    const lateLimit = nowJakarta
      .clone()
      .hour(Number(hourStr))
      .minute(Number(minuteStr))
      .second(0)
      .millisecond(0);

    const isLate = nowJakarta.isAfter(lateLimit);
    const reason = input.late_reason?.trim() || null;

    if (isLate && !reason) {
      throw new Error(
        `Check-in terlambat. Alasan wajib diisi jika lewat ${this.DEFAULT_LATE_LIMIT}`,
      );
    }

    return {
      late: isLate,
      lateReason: isLate ? reason : null,
    };
  }

  private cleanBase64(base64String: string): string {
    if (!base64String) return base64String;
    if (base64String.includes('base64,')) {
      return base64String.split('base64,')[1];
    }
    return base64String;
  }

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

    return daysInIndonesian[day] || day;
  }

  private toBoolean(value: any): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      return ['true', '1', 'yes'].includes(value.toLowerCase());
    }
    if (typeof value === 'number') return value === 1;
    return false;
  }

  private toNumber(value: any): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  private calculateDistanceMeters(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371000; // meter
    const dLat = this.degToRad(lat2 - lat1);
    const dLon = this.degToRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.degToRad(lat1)) *
        Math.cos(this.degToRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private degToRad(value: number): number {
    return value * (Math.PI / 180);
  }
}
