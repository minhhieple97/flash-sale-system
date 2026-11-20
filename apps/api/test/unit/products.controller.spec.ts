import { NotFoundException } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../../src/app.setup';
import { ProductsController } from '../../src/modules/products/controllers/products.controller';
import type { Product } from '../../src/modules/products/interfaces/product.interface';
import { ProductsService } from '../../src/modules/products/services/products.service';

const PRODUCT: Product = {
  id: 'p-1',
  sku: 'sku-1',
  name: 'Phone',
  description: 'A phone',
  originalPriceCents: 1000,
  salePriceCents: 500,
  imageUrl: null,
};
const DTO_KEYS = [
  'description',
  'id',
  'imageUrl',
  'name',
  'originalPriceCents',
  'salePriceCents',
  'sku',
];

describe('ProductsController', () => {
  let app: NestFastifyApplication;
  const getFeaturedProduct = jest.fn<Promise<Product>, []>();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [{ provide: ProductsService, useValue: { getFeaturedProduct } }],
    }).compile();
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

  it('answers 200 with exactly the product DTO keys', async () => {
    getFeaturedProduct.mockResolvedValue(PRODUCT);

    const response = await request(app.getHttpServer()).get('/api/v1/products/featured');

    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(DTO_KEYS);
    expect(response.body).toEqual(PRODUCT);
  });

  it('answers 404 PRODUCT_NOT_FOUND when the service throws', async () => {
    getFeaturedProduct.mockRejectedValue(
      new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'missing' }),
    );

    const response = await request(app.getHttpServer()).get('/api/v1/products/featured');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ code: 'PRODUCT_NOT_FOUND', message: 'missing' });
  });
});
