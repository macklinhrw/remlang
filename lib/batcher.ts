const batchSettlePromises = async <T>(
  promises: Promise<T>[],
  batchSize = 20,
  debug = false
) => {
  let batch: Promise<T>[] = [];

  const responses = [];
  for (let i = 0; i < promises.length; i++) {
    const curPromise = promises.at(i);
    if (curPromise) batch.push(curPromise);
    if ((i % batchSize === 0 && i != 0) || i === promises.length - 1) {
      const res = await Promise.allSettled(batch);
      responses.push(...res);
      batch = [];
      if (debug) console.log(`Finished settling batch after i=${i}...`);
    }
  }
  if (debug) console.log(`Finished settling batches.`);
  return responses;
};

export { batchSettlePromises };
