// s3.controller.ts
import { Controller, Get, Query } from '@nestjs/common';
import { S3Service } from './s3.service';

@Controller('s3')
export class S3Controller {
  constructor(private readonly s3Service: S3Service) {}

  @Get('presigned-upload')
  async getPresignedUpload(
    @Query('filename') filename: string,
    @Query('mimetype') mimetype: string,
  ) {
    const url = await this.s3Service.getPresignedUploadUrl(filename, mimetype);
    return { url };
  }
}
