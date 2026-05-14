// Token bucket rate limiter — 8 req/sec per connection (Trendyol limit: ~10/sec)
const limiters = new Map();

class TokenBucket {
  constructor(rate = 8, capacity = 8) {
    this.rate = rate;       // tokens added per second
    this.capacity = capacity;
    this.tokens = capacity;
    this.lastRefill = Date.now();
    this.queue = [];
    this.processing = false;
  }

  acquire() {
    return new Promise(resolve => {
      this.queue.push(resolve);
      if (!this.processing) this._tick();
    });
  }

  _tick() {
    this.processing = true;

    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }

    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.rate);
    this.lastRefill = now;

    if (this.tokens >= 1) {
      this.tokens -= 1;
      this.queue.shift()();
      setImmediate(() => this._tick());
    } else {
      const waitMs = Math.ceil((1 - this.tokens) / this.rate * 1000);
      setTimeout(() => this._tick(), waitMs);
    }
  }
}

function getLimiter(connectionId) {
  const key = connectionId || 'default';
  if (!limiters.has(key)) {
    limiters.set(key, new TokenBucket(8, 8));
  }
  return limiters.get(key);
}

module.exports = { getLimiter };
