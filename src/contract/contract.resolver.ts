import {
  Args,
  Int,
  Mutation,
  Query,
  Resolver,
} from '@nestjs/graphql';

import { ContractService } from './contract.service';
import { ContractEntity } from './contract.entity';
import { UploadSignedLetterDto } from './dto/upload-signed-letter.dto';

@Resolver()
export class ContractResolver {
  constructor(
    private readonly contractService: ContractService,
  ) {}

  @Query(() => ContractEntity)
  async latestContract(
    @Args('employee_id', { type: () => Int })
    employeeId: number,
  ) {
    return this.contractService.getLatestContract(
      employeeId,
    );
  }

  @Query(() => String, { nullable: true })
  async getLetterUrl(
    @Args('employee_id', { type: () => Int })
    employeeId: number,
  ) {
    return this.contractService.getLetterUrl(
      employeeId,
    );
  }

  @Query(() => String, { nullable: true })
  async getSignedLetterUrl(
    @Args('employee_id', { type: () => Int })
    employeeId: number,
  ) {
    return this.contractService.getSignedLetterUrl(
      employeeId,
    );
  }

  @Mutation(() => String)
  async uploadSignedLetterUrl(
    @Args('employee_id', { type: () => Int })
    employeeId: number,

    @Args('signed_letter_url')
    signedLetterUrl: string,
  ) {
    const result =
      await this.contractService.uploadSignedLetterUrl(
        employeeId,
        signedLetterUrl,
      );

    return result.message;
  }
}