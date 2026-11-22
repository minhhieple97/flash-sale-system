export function chunkArray<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) throw new RangeError(`Chunk size must be positive, got ${size}`);
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
