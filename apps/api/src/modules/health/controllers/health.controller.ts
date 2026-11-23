import { Controller, Get, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { HEALTH_ROUTE } from '../../../common/constants/common.constants';
import { HEALTH_HTTP_STATUS, type HealthReport, HealthService } from '../services/health.service';

@Controller(HEALTH_ROUTE)
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async check(@Res({ passthrough: true }) reply: FastifyReply): Promise<HealthReport> {
    const report = await this.healthService.check();
    reply.status(HEALTH_HTTP_STATUS[report.status]);
    return report;
  }
}
