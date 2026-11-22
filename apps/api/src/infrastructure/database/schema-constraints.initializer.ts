import { Injectable, type OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SCHEMA_ADVISORY_LOCK_KEY } from './database.constants';
import { ACQUIRE_SCHEMA_LOCK_SQL, SCHEMA_DDL } from './schema.sql';

@Injectable()
export class SchemaConstraintsInitializer implements OnModuleInit {
  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.query(ACQUIRE_SCHEMA_LOCK_SQL, [SCHEMA_ADVISORY_LOCK_KEY]);
      for (const statement of SCHEMA_DDL) await manager.query(statement);
    });
  }
}
