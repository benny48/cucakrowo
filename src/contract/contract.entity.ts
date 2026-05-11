import { Field, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class ContractEntity {
  @Field(() => Int)
  id: number;

  @Field()
  name: string;

  @Field(() => Int, { nullable: true })
  employee_id?: number;

  @Field({ nullable: true })
  state?: string;

  @Field({ nullable: true })
  letter_url?: string;

  @Field({ nullable: true })
  signed_letter_url?: string;
  
  @Field({ nullable: true })
  date_start?: string;

  @Field({ nullable: true })
  date_end?: string;
}