import { ObjectType, Field, Int, Float } from '@nestjs/graphql';

@ObjectType({ description: 'Leave Request Entity' })
export class LeaveEntity {
  @Field(() => Int, { description: 'Unique ID' })
  id: number;

  @Field({ description: 'Description of the leave request', nullable: true })
  name: string;

  @Field(() => Int, { description: 'Employee ID requesting the leave' })
  employee_id: number;

  @Field(() => Int, { description: 'Leave type ID' })
  holiday_status_id: number;

  @Field({ description: 'Requested start date (YYYY-MM-DD)' })
  request_date_from: string;

  @Field({ description: 'Requested end date (YYYY-MM-DD)' })
  request_date_to: string;

  @Field({ description: 'Computed start date and time of the leave' })
  date_from: string;

  @Field({ description: 'Computed end date and time of the leave' })
  date_to: string;

  @Field(() => Float, { description: 'Duration in days' })
  number_of_days: number;

  @Field({ description: 'Current state of the leave request' })
  state: string;

  @Field({ description: 'Reason for the leave request', nullable: true })
  notes: string;

  @Field({ description: 'Employee name', nullable: true })
  employee_name: string;

  @Field({ description: 'Leave type name', nullable: true })
  leave_type_name: string;

  @Field({ description: 'Images', nullable: true })
  support_image: string;
}
