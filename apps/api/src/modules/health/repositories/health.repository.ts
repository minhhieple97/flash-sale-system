import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { DATABASE_PROBE_SQL } from '../constants/health.constants';

@Injectable()
export class HealthRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async isDatabaseReachable(): Promise<boolean> {
    await this.dataSource.query(DATABASE_PROBE_SQL);
    return true;
  }
}
