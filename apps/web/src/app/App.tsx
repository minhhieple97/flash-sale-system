import { memo, type ReactElement, useCallback, useState } from 'react';
import { CheckoutFormCard } from '@/modules/checkout';
import { type FlashSaleStatus, SaleStatusBanner, useFlashSaleStatus } from '@/modules/flash-sale';
import { OrderLookupCard } from '@/modules/orders';
import { ProductShowcaseCard } from '@/modules/product';
import { DemoScenarioDrawer } from '@/modules/simulation';
import { AppLayout } from './AppLayout';

const Product = memo(ProductShowcaseCard);
const Checkout = memo(CheckoutFormCard);
const OrderLookup = memo(OrderLookupCard);
const Scenarios = memo(DemoScenarioDrawer);

export function App(): ReactElement {
  const flashSale = useFlashSaleStatus();
  const { applySnapshot } = flashSale;
  const [scenarioEpoch, setScenarioEpoch] = useState(0);

  const handleScenarioApplied = useCallback(
    (sale: FlashSaleStatus): void => {
      applySnapshot(sale);
      setScenarioEpoch((epoch) => epoch + 1);
    },
    [applySnapshot],
  );

  return (
    <AppLayout footer={<Scenarios onScenarioApplied={handleScenarioApplied} />}>
      <Product />
      <div className="grid gap-6 md:grid-cols-2">
        <SaleStatusBanner feed={flashSale} />
        <Checkout
          key={`checkout-${scenarioEpoch}`}
          sale={flashSale.sale}
          onPurchaseReserved={flashSale.refresh}
        />
      </div>
      <OrderLookup key={`lookup-${scenarioEpoch}`} />
    </AppLayout>
  );
}
