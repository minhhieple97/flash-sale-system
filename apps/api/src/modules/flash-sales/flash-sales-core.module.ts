import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '../../common/common.module';
import { SaleLedgerModule } from '../sale-ledger';
import { FlashSaleEntity } from './entities/flash-sale.entity';
import { FlashSalesRepository } from './repositories/flash-sales.repository';
import { FlashSaleCampaignService } from './services/flash-sale-campaign.service';
import { FlashSalesService } from './services/flash-sales.service';

@Module({
  imports: [CommonModule, SaleLedgerModule, TypeOrmModule.forFeature([FlashSaleEntity])],
  providers: [FlashSalesRepository, FlashSalesService, FlashSaleCampaignService],
  exports: [FlashSalesService, FlashSaleCampaignService],
})
export class FlashSalesCoreModule {}
