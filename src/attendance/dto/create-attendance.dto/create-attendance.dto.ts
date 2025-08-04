import { InputType, Field, Int } from '@nestjs/graphql';

@InputType()
export class CreateAttendanceDto {
  @Field(() => Int)
  employeeId: number;

  @Field(() => String)
  nik: string;

  @Field(() => String)
  punching_type: string;

  @Field(() => String)
  tanggal_absen: string;

  @Field(() => String)
  attendace_image: string;

  @Field(() => Boolean, { nullable: true })
  late?: boolean;

  @Field(() => String, { nullable: true })
  late_reason?: string;
}
