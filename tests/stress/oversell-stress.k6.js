import { purchaseScenario } from './k6-purchase.mjs';
import { SCENARIOS } from './scenarios.mjs';

const scenario = purchaseScenario(SCENARIOS.oversell);

export const options = scenario.options;
export const setup = scenario.setup;
export default scenario.run;
