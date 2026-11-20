import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';

describe('AppModule (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
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

  it('reports every dependency up on GET /health', async () => {
    const response = await request(app.getHttpServer()).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      checks: { database: 'up', redis: 'up' },
    });
  });

  it.each(['/api/v1/flash-sales/current', '/api/v1/products/featured'])(
    'answers %s with 200 or a coded 404',
    async (path) => {
      const response = await request(app.getHttpServer()).get(path);

      expect([200, 404]).toContain(response.status);
      if (response.status === 404) {
        expect(Object.keys(response.body).sort()).toEqual(['code', 'message']);
        expect(typeof response.body.code).toBe('string');
      }
    },
  );
});
