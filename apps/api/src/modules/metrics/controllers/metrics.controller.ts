import { Controller, Get, Header } from '@nestjs/common';
import { METRICS_ROUTE } from '../../../common/constants/common.constants';
import { PROMETHEUS_CONTENT_TYPE } from '../constants/metrics.constants';
import { MetricsService } from '../services/metrics.service';

@Controller(METRICS_ROUTE)
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header('Content-Type', PROMETHEUS_CONTENT_TYPE)
  getMetrics(): Promise<string> {
    return this.metrics.render();
  }
}
