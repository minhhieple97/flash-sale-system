import { Injectable } from '@nestjs/common';

@Injectable()
export class ClockService {
  nowMs(): number {
    return Date.now();
  }
}
