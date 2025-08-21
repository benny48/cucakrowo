import {
  ObjectType,
  Field,
  Int,
  Float,
  registerEnumType,
} from '@nestjs/graphql';

export enum EmployeeStatus {
  active = 'active',
  inactive = 'inactive',
}
registerEnumType(EmployeeStatus, { name: 'EmployeeStatus' });

@ObjectType()
export class PayrollType {
  @Field(() => Int) id: number;

  // Relasi
  @Field(() => Int, { nullable: true }) employeeId?: number;
  @Field({ nullable: true }) employeeName?: string;

  @Field(() => Int, { nullable: true }) periodId?: number;
  @Field({ nullable: true }) periodName?: string;

  // Periode
  @Field({ nullable: true }) tahun?: string;
  @Field({ nullable: true }) periodDate?: string; // YYYY-MM-DD
  @Field({ nullable: true }) payDate?: string;

  // Header kiri
  @Field({ nullable: true }) idDse?: string;
  @Field({ nullable: true }) nama?: string;
  @Field({ nullable: true }) jabatan?: string;
  @Field(() => Int, { nullable: true }) hariKerja?: number;

  // Header kanan
  @Field(() => EmployeeStatus, { nullable: true })
  statusKaryawan?: EmployeeStatus;
  @Field({ nullable: true }) npwp?: string;
  @Field({ nullable: true }) noRekening?: string;
  @Field({ nullable: true }) microCluster?: string;
  @Field({ nullable: true }) partnerName?: string;

  // Currency
  @Field(() => Int, { nullable: true }) currencyId?: number;
  @Field({ nullable: true }) currencyName?: string;

  // Pendapatan
  @Field(() => Float, { nullable: true }) gapok70?: number;
  @Field(() => Float, { nullable: true }) gapok30?: number;
  @Field(() => Float, { nullable: true }) transportasi?: number;
  @Field(() => Float, { nullable: true }) pulsa?: number;
  @Field(() => Float, { nullable: true }) gross?: number;

  // Potongan
  @Field(() => Float, { nullable: true }) pph21?: number;
  @Field(() => Float, { nullable: true }) bpjsKetenagakerjaan?: number;
  @Field(() => Float, { nullable: true }) bpjsKesehatan?: number;
  @Field(() => Float, { nullable: true }) biayaAdmPayrollNonMandiri?: number;
  @Field(() => Float, { nullable: true }) totalPotongan?: number;

  // Ringkasan
  @Field(() => Float, { nullable: true }) thp?: number;

  // Link cetak
  @Field({ nullable: true }) paylink?: string;
}
