import { ObjectType, Field, ID, Float } from '@nestjs/graphql';

@ObjectType()
export class Leave {
  @Field(() => ID)
  id: number;

  @Field({ nullable: true })
  name: string;

  @Field()
  employee_id: number;

  @Field()
  holiday_status_id: number;

  @Field()
  date_from: string;

  @Field()
  date_to: string;

  @Field(() => Float)
  number_of_days: number;

  @Field()
  state: string;

  @Field({ nullable: true })
  notes: string;
}

@ObjectType()
export class LeaveType {
  @Field(() => ID)
  id: number;

  @Field()
  name: string;
}
