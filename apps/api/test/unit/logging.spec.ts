import { Writable } from 'node:stream';
import { Controller, Get } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Logger, LoggerModule } from 'nestjs-pino';
import { __resetOutOfContextForTests as resetPinoRootLogger } from 'nestjs-pino/PinoLogger';
import request from 'supertest';
import { configureApp } from '../../src/app.setup';
import { buildLoggerParams } from '../../src/logging/logger-params';

const PINO_ERROR_LEVEL = 50;
const PINO_WARN_LEVEL = 40;

@Controller('probe')
class ProbeController {
  @Get('ok')
  ok(): { isAlive: boolean } {
    return { isAlive: true };
  }

  @Get('boom')
  boom(): never {
    throw new Error('boom detail');
  }
}

interface LogLine {
  level: number;
  msg?: string;
}

function collectingStream(lines: LogLine[]): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, done): void {
      lines.push(JSON.parse(chunk.toString()) as LogLine);
      done();
    },
  });
}

let startupLines: LogLine[] = [];

async function buildApp(level: string, lines: LogLine[]): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [LoggerModule.forRoot(buildLoggerParams(level, collectingStream(lines)))],
    controllers: [ProbeController],
  }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  startupLines = lines.splice(0);
  return app;
}

describe('structured logging', () => {
  let lines: LogLine[];
  let app: NestFastifyApplication | undefined;

  beforeEach(() => {
    lines = [];
    resetPinoRootLogger();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('starts without warnings, so the route pattern is valid for this Nest version', async () => {
    app = await buildApp('info', lines);

    const warnings = startupLines.filter((line) => line.level >= PINO_WARN_LEVEL);

    expect(warnings).toEqual([]);
  });

  it('does not log successful requests, keeping the hot path quiet', async () => {
    app = await buildApp('info', lines);

    await request(app.getHttpServer()).get('/api/v1/probe/ok');

    expect(lines).toEqual([]);
  });

  it('logs an unexpected fault once at error level with its stack', async () => {
    app = await buildApp('info', lines);

    await request(app.getHttpServer()).get('/api/v1/probe/boom');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: PINO_ERROR_LEVEL });
    expect(lines[0]?.msg).toContain('boom detail');
  });

  it('drops lines below the configured level', async () => {
    app = await buildApp('error', lines);

    app.get(Logger).warn('below the threshold');

    expect(lines).toEqual([]);
  });
});
