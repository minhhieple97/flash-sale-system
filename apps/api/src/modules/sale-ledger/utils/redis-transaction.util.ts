export type TransactionResult = [error: Error | null, reply: unknown][] | null;

/** Replies of a MULTI/EXEC in command order. Throws the first command error, or on a null EXEC. */
export function unwrapTransaction(result: TransactionResult): unknown[] {
  if (result === null) throw new Error('Redis MULTI returned no result');
  return result.map(([error, reply]) => {
    if (error) throw error;
    return reply;
  });
}
