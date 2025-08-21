import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import axios from 'axios';
import { OdooAuthService } from '../odoo-auth/odoo-auth.service';
import { RedisService } from '../redis/redis.service';

type PayrollRow = {
  id: number;
  employee_id?: [number, string] | false;
  period_id?: [number, string] | false;

  tahun?: string | null;
  period_date?: string | null; // 'YYYY-MM-DD'
  pay_date?: string | null;

  id_dse?: string | null;
  nama?: string | null;
  jabatan?: string | null;
  hari_kerja?: number | null;

  status_karyawan?: 'active' | 'inactive' | null;
  npwp?: string | null;
  no_rekening?: string | null;
  micro_cluster?: string | null;
  partner_name?: string | null;

  currency_id?: [number, string] | false;

  gapok_70?: number | null;
  gapok_30?: number | null;
  transportasi?: number | null;
  pulsa?: number | null;
  gross?: number | null;

  pph21?: number | null;
  bpjs_ketenagakerjaan?: number | null;
  bpjs_kesehatan?: number | null;
  biaya_adm_payroll_non_mandiri?: number | null;
  total_potongan?: number | null;

  thp?: number | null;
  paylink?: string | null;
};

@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);
  private readonly odooUrl = process.env.ODOO_URL!; // sudah mengarah ke /jsonrpc sesuai .env kamu
  private readonly odooDb = process.env.ODOO_DB!;
  private readonly odooPassword = process.env.ODOO_PASSWORD!;
  private readonly CACHE_TTL = 3600; // 1 jam
  private readonly CACHE_KEY_PREFIX = 'payroll:list';

  constructor(
    private readonly odooAuthService: OdooAuthService,
    private readonly redisService: RedisService,
  ) {}

  /** Ambil semua slip (tanpa filter) */
  async getAll(): Promise<PayrollRow[]> {
    const uid = await this.odooAuthService.authenticate();
    const payload = {
      jsonrpc: '2.0',
      method: 'call',
      id: Date.now(),
      params: {
        service: 'object',
        method: 'execute_kw',
        args: [
          this.odooDb,
          uid,
          this.odooPassword,
          'ssm.payrollssm',
          'search_read',
          [[]],
          { fields: this.fields(), order: 'period_date desc, employee_id' },
        ],
      },
    };
    const { data } = await axios.post(this.odooUrl, payload, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (data?.error) throw new Error(data.error?.data?.message || 'Odoo error');
    return (data.result ?? []) as PayrollRow[];
  }

  /**
   * FLEKSIBEL:
   * - Jika monthName diisi -> filter 1 bulan + tahun (+ employeeId)
   * - Jika monthName kosong -> filter SELURUH bulan di tahun tsb (+ employeeId)
   */
  async getPayrollByMonthYear(params: {
    monthName?: string; // "Maret" / "Mar" / undefined
    year: number | string; // 2025
    employeeId?: number;
    limit?: number;
    offset?: number;
  }): Promise<PayrollRow[]> {
    const { monthName, year, employeeId, limit = 200, offset = 0 } = params;
    if (!year && year !== 0)
      throw new BadRequestException('Parameter "year" wajib diisi');

    const uid = await this.odooAuthService.authenticate();
    const tahun = String(year);

    // tentukan daftar period_id:
    // - jika monthName diisi -> cari period utk bulan tersebut
    // - jika tidak -> ambil semua period_id satu tahun
    let periodIds: number[] = [];
    if (monthName?.trim()) {
      const monthFull = this.canonicalMonthName(monthName);
      periodIds = await this.searchPeriodIdsByMonth(uid, monthFull, tahun);
      if (!periodIds.length) {
        this.logger.warn(`⚠️ Tidak ada periode untuk ${monthFull} ${tahun}`);
        return [];
      }
    } else {
      periodIds = await this.searchPeriodIdsByYear(uid, tahun);
      if (!periodIds.length) {
        this.logger.warn(`⚠️ Tidak ada periode untuk tahun ${tahun}`);
        return [];
      }
    }

    // Domain final: period_id in ... AND tahun = ... (+ employee_id)
    const domain: any[] = [
      ['period_id', 'in', periodIds],
      ['tahun', '=', tahun],
    ];
    if (employeeId) domain.push(['employee_id', '=', employeeId]);

    const cacheKey = [
      this.CACHE_KEY_PREFIX,
      `y${tahun}`,
      monthName?.trim() ? `m:${this.normalizeMonthName(monthName)}` : 'm:all',
      `p${periodIds.join(',')}`,
      employeeId ? `emp${employeeId}` : 'all',
      `l${limit}`,
      `o${offset}`,
    ].join(':');

    const cached = await this.redisService.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const payload = {
      jsonrpc: '2.0',
      method: 'call',
      id: Date.now(),
      params: {
        service: 'object',
        method: 'execute_kw',
        args: [
          this.odooDb,
          uid,
          this.odooPassword,
          'ssm.payrollssm',
          'search_read',
          [domain],
          {
            fields: this.fields(),
            limit,
            offset,
            order: 'period_date desc, employee_id',
          },
        ],
      },
    };

    this.logger.debug(`🧪 Domain payroll: ${JSON.stringify(domain)}`);
    const { data } = await axios.post(this.odooUrl, payload, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (data?.error) throw new Error(data.error?.data?.message || 'Odoo error');

    const rows: PayrollRow[] = data.result ?? [];
    await this.redisService.set(cacheKey, JSON.stringify(rows), this.CACHE_TTL);
    return rows;
  }

  // ========= FLEX ala contohmu =========
  async findByEmployeePeriodYearFlexible(
    employeeId?: number,
    period?: string, // "8" atau "Agustus"
    tahun?: string,
    limit = 200,
    offset = 0,
  ): Promise<PayrollRow[]> {
    const uid = await this.odooAuthService.authenticate();
    const domain: any[] = [];

    if (period) {
      if (/^\d+$/.test(period.trim())) {
        domain.push(['period_id', '=', Number(period)]);
      } else {
        const monthFull = this.canonicalMonthName(period);
        const pids = await this.searchPeriodIdsByMonth(uid, monthFull, tahun);
        if (!pids.length) return [];
        domain.push(['period_id', 'in', pids]);
      }
    } else if (tahun) {
      // jika tidak ada period tapi ada tahun -> ambil seluruh period tahun tsb
      const pids = await this.searchPeriodIdsByYear(uid, String(tahun));
      if (!pids.length) return [];
      domain.push(['period_id', 'in', pids]);
    }

    if (tahun) domain.push(['tahun', '=', String(tahun)]);
    if (employeeId) domain.push(['employee_id', '=', employeeId]);

    const payload = {
      jsonrpc: '2.0',
      method: 'call',
      id: Date.now(),
      params: {
        service: 'object',
        method: 'execute_kw',
        args: [
          this.odooDb,
          uid,
          this.odooPassword,
          'ssm.payrollssm',
          'search_read',
          [domain],
          {
            fields: this.fields(),
            limit,
            offset,
            order: 'period_date desc, employee_id',
          },
        ],
      },
    };

    const { data } = await axios.post(this.odooUrl, payload, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (data?.error) throw new Error(data.error?.data?.message || 'Odoo error');

    return (data.result ?? []) as PayrollRow[];
  }

  // ========= Helpers =========

  /** daftar field yang kita ambil dari ssm.payrollssm */
  private fields(): (keyof PayrollRow)[] {
    return [
      'employee_id',
      'period_id',
      'tahun',
      'period_date',
      'pay_date',
      'id_dse',
      'nama',
      'jabatan',
      'hari_kerja',
      'status_karyawan',
      'npwp',
      'no_rekening',
      'micro_cluster',
      'partner_name',
      'currency_id',
      'gapok_70',
      'gapok_30',
      'transportasi',
      'pulsa',
      'gross',
      'pph21',
      'bpjs_ketenagakerjaan',
      'bpjs_kesehatan',
      'biaya_adm_payroll_non_mandiri',
      'total_potongan',
      'thp',
      'paylink',
    ];
  }

  /** Cari period_id berdasar NAMA BULAN + (opsional) TAHUN */
  private async searchPeriodIdsByMonth(
    uid: number,
    monthFull: string,
    tahun?: string,
  ): Promise<number[]> {
    const domExact: any[] = [['period_name', '=', monthFull]];
    const domIlike: any[] = [['period_name', 'ilike', monthFull]];
    const domName: any[] = [['name', 'ilike', monthFull]];

    const addYear = (dom: any[]) => {
      if (tahun) dom.push(['tahun', '=', String(tahun)]);
      return dom;
    };

    let ids = await this.searchPeriodIds(uid, addYear([...domExact]));
    if (ids.length) return ids;

    ids = await this.searchPeriodIds(uid, addYear([...domIlike]));
    if (ids.length) return ids;

    ids = await this.searchPeriodIds(uid, addYear([...domName]));
    return ids;
  }

  /** Cari SELURUH period_id dalam satu tahun */
  private async searchPeriodIdsByYear(
    uid: number,
    tahun: string,
  ): Promise<number[]> {
    const dom: any[] = [['tahun', '=', tahun]];
    return this.searchPeriodIds(uid, dom);
  }

  /** low-level: cari ids di periode.payment pakai domain */
  private async searchPeriodIds(uid: number, domain: any[]): Promise<number[]> {
    const payload = {
      jsonrpc: '2.0',
      method: 'call',
      id: Date.now(),
      params: {
        service: 'object',
        method: 'execute_kw',
        args: [
          this.odooDb,
          uid,
          this.odooPassword,
          'periode.payment',
          'search',
          [domain],
          { limit: 48, order: 'tanggal asc, id asc' },
        ],
      },
    };
    const { data } = await axios.post(this.odooUrl, payload, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (data?.error)
      throw new Error(
        data.error?.data?.message || 'Odoo error (periode.payment)',
      );
    return (data.result ?? []) as number[];
  }

  /** Normalisasi nama bulan → bentuk lengkap Indonesia (huruf besar awal). */
  private canonicalMonthName(input: string): string {
    const key = input.trim().toLowerCase();
    const map: Record<string, string> = {
      jan: 'Januari',
      januari: 'Januari',
      feb: 'Februari',
      februari: 'Februari',
      mar: 'Maret',
      maret: 'Maret',
      apr: 'April',
      april: 'April',
      mei: 'Mei',
      jun: 'Juni',
      juni: 'Juni',
      jul: 'Juli',
      juli: 'Juli',
      agu: 'Agustus',
      agt: 'Agustus',
      agustus: 'Agustus',
      sep: 'September',
      september: 'September',
      okt: 'Oktober',
      oktober: 'Oktober',
      nov: 'November',
      november: 'November',
      des: 'Desember',
      desember: 'Desember',
    };
    const full = map[key];
    if (!full) {
      throw new BadRequestException(
        `Bulan "${input}" tidak valid. Contoh: "Agustus" atau "Agu".`,
      );
    }
    return full;
  }

  private normalizeMonthName(name: string) {
    return name.trim().toLowerCase();
  }

  /** Invalidasi cache berdasar bulan/tahun atau full tahun */
  async invalidateMonthCache(
    year: number | string,
    monthName?: string,
    employeeId?: number,
  ) {
    const base =
      `${this.CACHE_KEY_PREFIX}:y${year}:` +
      (monthName ? `m:${this.normalizeMonthName(monthName)}` : 'm:all');
    const patterns = [
      `${base}:p*:${employeeId ? `emp${employeeId}` : 'all'}:*`,
      `${base}:p*:*`,
    ];
    for (const pat of patterns) {
      await (this.redisService as any).delPattern?.(pat).catch(() => undefined);
    }
  }
}
