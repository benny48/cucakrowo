import {
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import axios from 'axios';
import { OdooAuthService } from '../odoo-auth/odoo-auth.service';

@Injectable()
export class ContractService {
  private readonly logger = new Logger(ContractService.name);

  constructor(
    private readonly odooAuthService: OdooAuthService,
  ) {}

  private readonly odooUrl = process.env.ODOO_URL;

  async getLatestContract(employeeId: number): Promise<any> {
    this.logger.log(
      `Mengambil contract draft terbaru employee ID ${employeeId}`,
    );

    const uid = await this.odooAuthService.authenticate();

    const response = await axios.post(this.odooUrl, {
      jsonrpc: '2.0',
      method: 'call',
      id: new Date().getTime(),
      params: {
        service: 'object',
        method: 'execute_kw',
        args: [
          process.env.ODOO_DB,
          uid,
          process.env.ODOO_PASSWORD,
          'hr.contract',
          'search_read',
          [
            [
              ['employee_id', '=', employeeId],
              ['state', '=', 'draft'],
            ],
          ],
          {
            fields: [
              'id',
              'name',
              'employee_id',
              'state',
              'letter_url',
              'signed_letter_url',
              'date_start',
              'date_end',
            ],
            order: 'date_start desc, id desc',
            limit: 1,
          },
        ],
      },
    });

    const contract = response.data.result?.[0];

    if (!contract) {
      throw new NotFoundException(
        'Contract draft tidak ditemukan',
      );
    }

    return {
      id: contract.id,
      name: contract.name,
      employee_id: contract.employee_id?.[0],
      state: contract.state,
      letter_url: contract.letter_url,
      signed_letter_url: contract.signed_letter_url,
      date_start: contract.date_start,
      date_end: contract.date_end,
    };
  }

  async getLetterUrl(employeeId: number): Promise<string> {
    const latestContract =
      await this.getLatestContract(employeeId);

    return latestContract.letter_url;
  }

  async getSignedLetterUrl(
    employeeId: number,
  ): Promise<string> {
    const latestContract =
      await this.getLatestContract(employeeId);

    return latestContract.signed_letter_url;
  }

  async uploadSignedLetterUrl(
    employeeId: number,
    signedLetterUrl: string,
  ): Promise<any> {
    this.logger.log(
      `Upload signed letter URL employee ID ${employeeId}`,
    );

    const latestContract =
      await this.getLatestContract(employeeId);

    const uid = await this.odooAuthService.authenticate();

    try {
      await axios.post(this.odooUrl, {
        jsonrpc: '2.0',
        method: 'call',
        id: new Date().getTime(),
        params: {
          service: 'object',
          method: 'execute_kw',
          args: [
            process.env.ODOO_DB,
            uid,
            process.env.ODOO_PASSWORD,
            'hr.contract',
            'write',
            [
              [latestContract.id],
              {
                signed_letter_url: signedLetterUrl,
              },
            ],
          ],
        },
      });

      return {
        success: true,
        contract_id: latestContract.id,
        signed_letter_url: signedLetterUrl,
        message: 'Signed letter URL berhasil diupload',
      };
    } catch (error) {
      this.logger.error(error);

      throw new InternalServerErrorException(
        'Gagal upload signed letter URL',
      );
    }
  }
}