import {
  BadRequestException,
  Controller,
  Get,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../../src/app.setup';

@Controller('probe')
class ProbeController {
  @Get('coded')
  coded(): never {
    throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'x' });
  }

  @Get('bad')
  bad(): never {
    throw new BadRequestException('bad');
  }

  @Get('unavailable')
  unavailable(): never {
    throw new ServiceUnavailableException();
  }

  @Get('redis-down')
  redisDown(): never {
    throw new Error("Stream isn't writeable and enableOfflineQueue options is false");
  }

  @Get('redis-aborted')
  redisAborted(): never {
    const error = new Error('Command aborted due to connection close');
    error.name = 'AbortError';
    throw error;
  }

  @Get('pg-down')
  pgDown(): never {
    throw Object.assign(new Error('query failed'), { driverError: { code: '57P01' } });
  }

  @Get('pg-timeout')
  pgTimeout(): never {
    throw new Error('canceling statement due to statement timeout');
  }

  @Get('boom')
  boom(): never {
    throw new Error('boom');
  }
}

afterEach(() => jest.restoreAllMocks());

describe('GlobalExceptionFilter', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [ProbeController] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
      logger: false,
    });
    configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('passes through a domain code and message', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/probe/coded');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ code: 'PRODUCT_NOT_FOUND', message: 'x' });
  });

  it('maps a plain HttpException to its status name and message', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/probe/bad');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: 'BAD_REQUEST', message: 'bad' });
  });

  it('maps ServiceUnavailableException to SERVICE_UNAVAILABLE', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/probe/unavailable');

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('SERVICE_UNAVAILABLE');
    expect(Object.keys(response.body).sort()).toEqual(['code', 'message']);
  });

  it.each(['redis-down', 'redis-aborted', 'pg-down', 'pg-timeout'])(
    'answers a storage outage on %s with 503 TEMPORARY_FAILURE and one warn line',
    async (route) => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();

      const response = await request(app.getHttpServer()).get(`/api/v1/probe/${route}`);

      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        code: 'TEMPORARY_FAILURE',
        message: 'Temporarily unable to process the request; please retry',
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).not.toMatch(/\n\s+at /);
      expect(error).not.toHaveBeenCalled();
    },
  );

  it('hides unexpected error details behind INTERNAL_ERROR', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/probe/boom');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
    expect(JSON.stringify(response.body)).not.toContain('boom');
  });

  it('answers an unknown route under the prefix with a NOT_FOUND body', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/nope');

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
    expect(Object.keys(response.body).sort()).toEqual(['code', 'message']);
  });
});
