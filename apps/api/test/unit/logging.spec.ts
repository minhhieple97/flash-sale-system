import { Writable } from 'node:stream';
import { Controller, Get, Logger as NestLogger, Post } from '@nestjs/common';
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

@Controller()
class HotRouteProbeController {
  private readonly logger = new NestLogger(HotRouteProbeController.name);

  @Post('checkout/purchase')
  purchase(): { isAlive: boolean } {
    return this.warn();
  }

  @Get('flash-sales/current')
  currentSale(): { isAlive: boolean } {
    return this.warn();
  }

  @Get('orders/user/:userId')
  userOrder(): { isAlive: boolean } {
    return this.warn();
  }

  private warn(): { isAlive: boolean } {
    this.logger.warn('hot route warning');
    return { isAlive: true };
  }
}

@Controller('health')
class HealthProbeController {
  private readonly logger = new NestLogger(HealthProbeController.name);

  @Get()
  health(): { isAlive: boolean } {
    this.logger.warn('health warning');
    return { isAlive: true };
  }
}

interface LogLine {
  level: number;
  msg?: string;
  req?: { id?: unknown };
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
    controllers: [ProbeController, HotRouteProbeController, HealthProbeController],
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

  it.each([
    ['post', '/api/v1/checkout/purchase'],
    ['get', '/api/v1/flash-sales/current'],
    ['get', '/api/v1/orders/user/buyer-1'],
  ] as const)(
    'still writes a warn from hot route %s %s, without binding the request',
    async (method, path) => {
      app = await buildApp('info', lines);

      await request(app.getHttpServer())[method](path);

      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ level: PINO_WARN_LEVEL, msg: 'hot route warning' });
      expect(lines[0]).not.toHaveProperty('req');
    },
  );

  it('binds the request id to a warn from /health', async () => {
    app = await buildApp('info', lines);

    await request(app.getHttpServer()).get('/health');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: PINO_WARN_LEVEL, msg: 'health warning' });
    expect(lines[0]?.req?.id).toBeDefined();
  });
});
