import { Field, InputType, Int } from '@nestjs/graphql';

@InputType()
export class UploadSignedLetterDto {
  @Field(() => Int)
  employee_id: number;

  @Field()
  signed_letter_url: string;
}