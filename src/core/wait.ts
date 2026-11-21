// Resolves once the signal aborts.
export function aborted(signal: AbortSignal): Promise<"aborted"> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve("aborted");
      return;
    }
    signal.addEventListener(
      "abort",
      () => {
        resolve("aborted");
      },
      { once: true },
    );
  });
}

// Does the work, and calls `stop` if the signal aborts while it is going on.
// Throws without starting when the signal has already aborted.
export async function stoppable<Value>(
  signal: AbortSignal,
  stop: () => void,
  work: () => Promise<Value>,
): Promise<Value> {
  signal.throwIfAborted();
  signal.addEventListener("abort", stop, { once: true });
  try {
    return await work();
  } finally {
    signal.removeEventListener("abort", stop);
  }
}

// The value of the promise, or `undefined` when it takes longer than `ms`.
export async function within<Value>(
  promise: Promise<Value>,
  ms: number,
): Promise<Value | undefined> {
  const timer = Promise.withResolvers<undefined>();
  const timeout = setTimeout(() => {
    timer.resolve(undefined);
  }, ms);
  try {
    return await Promise.race([promise, timer.promise]);
  } finally {
    clearTimeout(timeout);
  }
}
