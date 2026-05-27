async function withRetry(fn, { maxRetries = 3, baseDelay = 100 } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRetryable =
        err.code === '40P01' || // deadlock_detected
        err.code === '55P03' || // lock_not_available (lock_timeout)
        (err.statusCode === 409 && err.data?.conflict); // optimistic lock

      if (!isRetryable || attempt === maxRetries) throw err;

      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 50;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

module.exports = { withRetry };
