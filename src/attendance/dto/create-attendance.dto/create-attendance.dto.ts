import { InputType, Field, Int, Float } from '@nestjs/graphql';

@InputType()
export class CreateAttendanceDto {
  @Field(() => Int)
  employeeId: number;

  @Field(() => String)
  nik: string;

  @Field(() => String, { nullable: true })
  punching_type?: string;

  @Field(() => String, { nullable: true })
  tanggal_absen?: string;

  @Field(() => String)
  attendace_image: string;

  @Field(() => Boolean, { nullable: true })
  late?: boolean;

  @Field(() => String, { nullable: true })
  late_reason?: string;

  @Field(() => Float, { nullable: true })
  latitude?: number;

  @Field(() => Float, { nullable: true })
  longitude?: number;

  @Field(() => Float, { nullable: true })
  accuracy?: number;

  @Field(() => Boolean, { nullable: true })
  is_mock_location?: boolean;

  @Field(() => String, { nullable: true })
  location_provider?: string;

  @Field(() => String, { nullable: true })
  device_location_time?: string;

  @Field(() => String, { nullable: true })
  mobile_id?: string;
}
