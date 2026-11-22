import { purchaseScenario } from './k6-purchase.mjs';
import { SCENARIOS } from './scenarios.mjs';

const scenario = purchaseScenario(SCENARIOS.sameUserRace);

export const options = scenario.options;
export const setup = scenario.setup;
export const handleSummary = scenario.handleSummary;
export default scenario.run;
