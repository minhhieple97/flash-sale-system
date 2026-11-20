import { invalidExceptionRule } from './exceptions.mjs';
import { controllerRules } from './rules-controller.mjs';
import { serviceRules } from './rules-service.mjs';
import { sizeRules } from './rules-size.mjs';
import { webRules } from './rules-web.mjs';

export const RULES = [
  ...sizeRules,
  ...controllerRules,
  ...serviceRules,
  ...webRules,
  invalidExceptionRule,
];
