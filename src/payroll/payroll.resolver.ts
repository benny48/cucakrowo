import { Resolver, Query, Args, Int } from '@nestjs/graphql';
import { PayrollService } from './payroll.service';
import { PayrollType } from './payroll.type';

@Resolver(() => PayrollType)
export class PayrollResolver {
  constructor(private readonly payrollService: PayrollService) {}

  /**
   * Contoh:
   * 1) Satu bulan:
   *    query { payrollByMonthYear(monthName: "Maret", year: 2025, employeeId: 3870) { id nama thp } }
   * 2) Semua bulan di tahun itu (untuk employee tertentu):
   *    query { payrollByMonthYear(year: 2025, employeeId: 3870) { id nama periodDate thp } }
   * 3) Semua bulan & semua karyawan di tahun itu:
   *    query { payrollByMonthYear(year: 2025) { id employeeId employeeName thp } }
   */
  @Query(() => [PayrollType], { name: 'payrollByMonthYear' })
  async payrollByMonthYear(
    @Args('year', { type: () => Int }) year: number,
    @Args('monthName', { type: () => String, nullable: true })
    monthName?: string,
    @Args('employeeId', { type: () => Int, nullable: true })
    employeeId?: number,
    @Args('limit', { type: () => Int, nullable: true }) limit = 200,
    @Args('offset', { type: () => Int, nullable: true }) offset = 0,
  ): Promise<PayrollType[]> {
    const rows = await this.payrollService.getPayrollByMonthYear({
      monthName,
      year,
      employeeId,
      limit,
      offset,
    });

    return rows.map((r: any) => ({
      id: r.id,
      employeeId: r.employee_id?.[0] ?? null,
      employeeName: r.employee_id?.[1] ?? null,
      periodId: r.period_id?.[0] ?? null,
      periodName: r.period_id?.[1] ?? null,

      tahun: r.tahun ?? null,
      periodDate: r.period_date ?? null,
      payDate: r.pay_date ?? null,

      idDse: r.id_dse ?? null,
      nama: r.nama ?? null,
      jabatan: r.jabatan ?? null,
      hariKerja: r.hari_kerja ?? null,

      statusKaryawan: r.status_karyawan ?? null,
      npwp: r.npwp ?? null,
      noRekening: r.no_rekening ?? null,
      microCluster: r.micro_cluster ?? null,
      partnerName: r.partner_name ?? null,

      currencyId: r.currency_id?.[0] ?? null,
      currencyName: r.currency_id?.[1] ?? null,

      gapok70: r.gapok_70 ?? null,
      gapok30: r.gapok_30 ?? null,
      transportasi: r.transportasi ?? null,
      pulsa: r.pulsa ?? null,
      gross: r.gross ?? null,

      pph21: r.pph21 ?? null,
      bpjsKetenagakerjaan: r.bpjs_ketenagakerjaan ?? null,
      bpjsKesehatan: r.bpjs_kesehatan ?? null,
      biayaAdmPayrollNonMandiri: r.biaya_adm_payroll_non_mandiri ?? null,
      totalPotongan: r.total_potongan ?? null,

      thp: r.thp ?? null,
      paylink: r.paylink ?? null,
    }));
  }
}
