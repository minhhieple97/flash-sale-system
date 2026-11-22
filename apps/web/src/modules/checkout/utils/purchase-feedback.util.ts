import { FALLBACK_PURCHASE_FEEDBACK, PURCHASE_FEEDBACK } from '../constants/checkout.constants';
import type { FeedbackCode, FeedbackPresentation } from '../types/checkout.types';

function isFeedbackCode(code: string): code is FeedbackCode {
  return Object.hasOwn(PURCHASE_FEEDBACK, code);
}

export function feedbackFor(code: string): FeedbackPresentation {
  return isFeedbackCode(code) ? PURCHASE_FEEDBACK[code] : FALLBACK_PURCHASE_FEEDBACK;
}
