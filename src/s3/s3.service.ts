// s3.service.ts
import { Injectable } from '@nestjs/common';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class S3Service {
  private s3Client = new S3Client({
    endpoint: 'https://nos.wjv-1.neo.id',
    region: 'us-east-1', // pakai default atau region NeoObject Storage
    credentials: {
      accessKeyId: process.env.NEO_ACCESS_KEY,
      secretAccessKey: process.env.NEO_SECRET_KEY,
    },
    forcePathStyle: true, // penting untuk S3 compatible!
  });

  async getPresignedUploadUrl(
    filename: string,
    mimetype: string,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: 'leave', // ganti dengan bucket anda
      Key: filename,
      ContentType: mimetype,
    });
    // URL berlaku 10 menit
    const url = await getSignedUrl(this.s3Client, command, { expiresIn: 600 });
    return url;
  }
}
