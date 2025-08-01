import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { OdooAuthService } from '../odoo-auth/odoo-auth.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class LeaveService {
  private readonly logger = new Logger(LeaveService.name);

  constructor(
    private readonly odooAuthService: OdooAuthService,
    private readonly redisService: RedisService,
  ) {}

  private readonly odooUrl = process.env.ODOO_URL;
  private readonly CACHE_TTL = 1800; // 30 menit dalam detik
  private readonly LEAVE_CACHE_KEY = 'leaves:all';
  private readonly LEAVE_TYPES_CACHE_KEY = 'leave_types:all';

  async getLeaveTypes(): Promise<any[]> {
    // Cek cache terlebih dahulu
    const cachedLeaveTypes = await this.redisService.get(
      this.LEAVE_TYPES_CACHE_KEY,
    );
    if (cachedLeaveTypes) {
      this.logger.log('✅ Data tipe cuti diambil dari REDIS cache');
      return JSON.parse(cachedLeaveTypes);
    }

    this.logger.log('⚠️ Cache miss! Mengambil data tipe cuti dari ODOO...');

    // Jika tidak ada di cache, ambil dari Odoo
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
          'hr.leave.type',
          'search_read',
          [[]],
          {
            fields: [
              'id',
              'name',
              'requires_allocation',
              'leave_validation_type',
            ],
          },
        ],
      },
    });

    const leaveTypes = response.data.result;

    // Simpan ke cache
    await this.redisService.set(
      this.LEAVE_TYPES_CACHE_KEY,
      JSON.stringify(leaveTypes),
      this.CACHE_TTL,
    );

    this.logger.log(
      `✅ Data ${leaveTypes.length} tipe cuti berhasil disimpan ke cache (TTL: ${this.CACHE_TTL}s)`,
    );

    return leaveTypes;
  }

  async getLeaves(employeeId?: number): Promise<any[]> {
    const cacheKey = employeeId
      ? `leaves:employee:${employeeId}`
      : this.LEAVE_CACHE_KEY;

    // Cek cache terlebih dahulu
    const cachedLeaves = await this.redisService.get(cacheKey);
    if (cachedLeaves) {
      this.logger.log('✅ Data cuti diambil dari REDIS cache');
      return JSON.parse(cachedLeaves);
    }

    this.logger.log('⚠️ Cache miss! Mengambil data cuti dari ODOO...');

    // Jika tidak ada di cache, ambil dari Odoo
    const uid = await this.odooAuthService.authenticate();
    if (!uid) throw new Error('Gagal autentikasi ke Odoo');

    // Buat domain untuk filter berdasarkan employee_id jika ada
    const domain = employeeId ? [['employee_id', '=', employeeId]] : [];

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
          'hr.leave',
          'search_read',
          [domain],
          {
            fields: [
              'id',
              'name',
              'employee_id',
              'holiday_status_id',
              'request_date_from',
              'request_date_to',
              'date_from',
              'date_to',
              'number_of_days',
              'state',
              'notes',
            ],
          },
        ],
      },
    });

    const leaves = response.data.result;

    // Perbarui data untuk menambahkan nama employee dan leave type
    const enrichedLeaves = leaves.map((leave) => {
      return {
        ...leave,
        employee_name: leave.employee_id ? leave.employee_id[1] : null,
        leave_type_name: leave.holiday_status_id
          ? leave.holiday_status_id[1]
          : null,
        employee_id: leave.employee_id ? leave.employee_id[0] : null,
        holiday_status_id: leave.holiday_status_id
          ? leave.holiday_status_id[0]
          : null,
      };
    });

    // Simpan ke cache
    await this.redisService.set(
      cacheKey,
      JSON.stringify(enrichedLeaves),
      this.CACHE_TTL,
    );

    this.logger.log(
      `✅ Data ${enrichedLeaves.length} cuti berhasil disimpan ke cache (TTL: ${this.CACHE_TTL}s)`,
    );

    return enrichedLeaves;
  }

  async createLeaveRequest(
    employeeId: number,
    holidayStatusId: number,
    requestDateFrom: string,
    requestDateTo: string,
    notes: string,
    support_image: string,
  ): Promise<any> {
    this.logger.log(
      `🔄 Membuat permintaan cuti baru untuk karyawan ID: ${employeeId}`,
    );

    try {
      const uid = await this.odooAuthService.authenticate();
      if (!uid) throw new Error('Gagal autentikasi ke Odoo');

      // PERBAIKAN: Gunakan format yang sesuai dengan Odoo '%Y-%m-%d %H:%M:%S'
      // Untuk timezone Indonesia (UTC+7), kita perlu mengurangi 7 jam untuk mendapatkan UTC
      const dateFrom = `${requestDateFrom} 01:00:00`; // UTC time untuk tampil 08:00 WIB
      const dateTo = `${requestDateTo} 10:00:00`; // UTC time untuk tampil 17:00 WIB

      // Calculate correct number of days
      const startDate = new Date(requestDateFrom);
      const endDate = new Date(requestDateTo);
      const diffTime = endDate.getTime() - startDate.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;

      this.logger.debug(
        `Creating leave: ${requestDateFrom} to ${requestDateTo}`,
      );
      this.logger.debug(`DateTime values: ${dateFrom} to ${dateTo}`);
      this.logger.debug(`Calculated days: ${diffDays}`);

      // Create the leave request
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
            'hr.leave',
            'create',
            [
              {
                employee_id: employeeId,
                holiday_status_id: holidayStatusId,
                request_date_from: requestDateFrom,
                request_date_to: requestDateTo,
                date_from: dateFrom, // Format: YYYY-MM-DD HH:MM:SS
                date_to: dateTo, // Format: YYYY-MM-DD HH:MM:SS
                number_of_days: diffDays,
                notes: notes,
                support_image: support_image,
              },
            ],
          ],
        },
      });

      if (!response.data || response.data.error) {
        this.logger.error(
          'Error dari Odoo:',
          response.data?.error?.data?.message || 'Unknown error',
        );
        throw new Error(
          response.data?.error?.data?.message ||
            'Gagal membuat permintaan cuti',
        );
      }

      const newLeaveId = response.data.result;
      if (!newLeaveId) {
        throw new Error(
          'Tidak dapat memperoleh ID permintaan cuti yang baru dibuat',
        );
      }

      // Force update untuk memastikan nilai yang benar
      const updateResponse = await axios.post(this.odooUrl, {
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
            'hr.leave',
            'write',
            [
              [newLeaveId],
              {
                request_date_from: requestDateFrom,
                request_date_to: requestDateTo,
                date_from: dateFrom,
                date_to: dateTo,
                number_of_days: diffDays,
              },
            ],
          ],
        },
      });

      if (updateResponse.data?.error) {
        this.logger.warn(
          'Warning updating leave fields:',
          updateResponse.data.error.data?.message,
        );
      }

      // Invalidate cache
      await this.redisService.del(this.LEAVE_CACHE_KEY);
      await this.redisService.del(`leaves:employee:${employeeId}`);
      this.logger.log('🗑️ Cache cuti diinvalidasi karena ada data baru');

      // Get the final result
      const detailResponse = await axios.post(this.odooUrl, {
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
            'hr.leave',
            'read',
            [newLeaveId],
            {
              fields: [
                'id',
                'name',
                'employee_id',
                'holiday_status_id',
                'request_date_from',
                'request_date_to',
                'date_from',
                'date_to',
                'number_of_days',
                'state',
                'notes',
              ],
            },
          ],
        },
      });

      if (!detailResponse.data?.result?.[0]) {
        this.logger.error(
          'Error getting leave details:',
          detailResponse.data?.error || 'No data returned',
        );

        return {
          id: newLeaveId,
          employee_id: employeeId,
          holiday_status_id: holidayStatusId,
          request_date_from: requestDateFrom,
          request_date_to: requestDateTo,
          date_from: dateFrom,
          date_to: dateTo,
          number_of_days: diffDays,
          notes: notes,
          state: 'confirm',
        };
      }

      const newLeave = detailResponse.data.result[0];

      // Log untuk verifikasi
      this.logger.debug('Final leave data:', {
        request_date_from: newLeave.request_date_from,
        request_date_to: newLeave.request_date_to,
        date_from: newLeave.date_from,
        date_to: newLeave.date_to,
        number_of_days: newLeave.number_of_days,
      });

      return {
        ...newLeave,
        employee_name: newLeave.employee_id?.[1] || null,
        leave_type_name: newLeave.holiday_status_id?.[1] || null,
        employee_id: newLeave.employee_id?.[0] || employeeId,
        holiday_status_id: newLeave.holiday_status_id?.[0] || holidayStatusId,
      };
    } catch (error) {
      this.logger.error('Error creating leave request:', error);
      throw new Error(`Gagal membuat permintaan cuti: ${error.message}`);
    }
  }

  async approveLeaveRequest(leaveId: number): Promise<any> {
    this.logger.log(`🔄 Menyetujui permintaan cuti ID: ${leaveId}`);

    try {
      const uid = await this.odooAuthService.authenticate();
      if (!uid) throw new Error('Gagal autentikasi ke Odoo');

      // Panggil metode action_approve pada hr.leave
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
            'hr.leave',
            'action_approve',
            [[leaveId]],
          ],
        },
      });

      // Check for errors
      if (response.data?.error) {
        throw new Error(
          response.data.error.data?.message || 'Error approving leave request',
        );
      }

      // Invalidasi cache
      await this.redisService.del(this.LEAVE_CACHE_KEY);

      try {
        // Dapatkan detail cuti untuk invalidasi cache per karyawan
        const leaveDetail = await this.getLeaveById(leaveId);
        if (leaveDetail && leaveDetail.employee_id) {
          await this.redisService.del(
            `leaves:employee:${leaveDetail.employee_id}`,
          );
        }
      } catch (e) {
        this.logger.warn(`Couldn't invalidate employee cache: ${e.message}`);
        // Continue even if this fails
      }

      this.logger.log('🗑️ Cache cuti diinvalidasi karena ada perubahan status');

      // Dapatkan detail cuti yang telah diperbarui
      return this.getLeaveById(leaveId);
    } catch (error) {
      this.logger.error('Error approving leave request:', error);
      throw new Error(`Gagal menyetujui permintaan cuti: ${error.message}`);
    }
  }

  async refuseLeaveRequest(leaveId: number): Promise<any> {
    this.logger.log(`🔄 Menolak permintaan cuti ID: ${leaveId}`);

    try {
      const uid = await this.odooAuthService.authenticate();
      if (!uid) throw new Error('Gagal autentikasi ke Odoo');

      // Panggil metode action_refuse pada hr.leave
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
            'hr.leave',
            'action_refuse',
            [[leaveId]],
          ],
        },
      });

      // Check for errors
      if (response.data?.error) {
        throw new Error(
          response.data.error.data?.message || 'Error refusing leave request',
        );
      }

      // Invalidasi cache
      await this.redisService.del(this.LEAVE_CACHE_KEY);

      try {
        // Dapatkan detail cuti untuk invalidasi cache per karyawan
        const leaveDetail = await this.getLeaveById(leaveId);
        if (leaveDetail && leaveDetail.employee_id) {
          await this.redisService.del(
            `leaves:employee:${leaveDetail.employee_id}`,
          );
        }
      } catch (e) {
        this.logger.warn(`Couldn't invalidate employee cache: ${e.message}`);
        // Continue even if this fails
      }

      this.logger.log('🗑️ Cache cuti diinvalidasi karena ada perubahan status');

      // Dapatkan detail cuti yang telah diperbarui
      return this.getLeaveById(leaveId);
    } catch (error) {
      this.logger.error('Error refusing leave request:', error);
      throw new Error(`Gagal menolak permintaan cuti: ${error.message}`);
    }
  }

  async getLeaveById(leaveId: number): Promise<any> {
    const cacheKey = `leave:${leaveId}`;

    // Cek cache terlebih dahulu
    const cachedLeave = await this.redisService.get(cacheKey);
    if (cachedLeave) {
      this.logger.log(`✅ Data cuti ID ${leaveId} diambil dari REDIS cache`);
      return JSON.parse(cachedLeave);
    }

    this.logger.log(
      `⚠️ Cache miss! Mengambil data cuti ID ${leaveId} dari ODOO...`,
    );

    // Jika tidak ada di cache, ambil dari Odoo
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
          'hr.leave',
          'read',
          [leaveId],
          {
            fields: [
              'id',
              'name',
              'employee_id',
              'holiday_status_id',
              'request_date_from',
              'request_date_to',
              'date_from',
              'date_to',
              'number_of_days',
              'state',
              'notes',
            ],
          },
        ],
      },
    });

    if (!response.data.result || response.data.result.length === 0) {
      throw new Error(`Cuti dengan ID ${leaveId} tidak ditemukan`);
    }

    const leave = response.data.result[0];

    // Perbarui data untuk menambahkan nama employee dan leave type
    const enrichedLeave = {
      ...leave,
      employee_name: leave.employee_id ? leave.employee_id[1] : null,
      leave_type_name: leave.holiday_status_id
        ? leave.holiday_status_id[1]
        : null,
      employee_id: leave.employee_id ? leave.employee_id[0] : null,
      holiday_status_id: leave.holiday_status_id
        ? leave.holiday_status_id[0]
        : null,
    };

    // Simpan ke cache
    await this.redisService.set(
      cacheKey,
      JSON.stringify(enrichedLeave),
      this.CACHE_TTL,
    );

    this.logger.log(
      `✅ Data cuti ID ${leaveId} berhasil disimpan ke cache (TTL: ${this.CACHE_TTL}s)`,
    );

    return enrichedLeave;
  }
}
