import { Controller, Get } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';

@Controller('probe')
class ProbeController {
  @Get()
  probe(): { isAlive: boolean } {
    return { isAlive: true };
  }
}

describe('app smoke', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves controller routes under the api/v1 global prefix', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/probe');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ isAlive: true });
  });

  it('answers routes outside the global prefix with a JSON 404', async () => {
    const response = await request(app.getHttpServer()).get('/probe');

    expect(response.status).toBe(404);
    expect(response.body.statusCode).toBe(404);
  });
});
