class CooldownMap {
  constructor(windowMs, { cleanupMultiplier = 2, maxSize = 0 } = {}) {
    this._map = new Map();
    this._windowMs = windowMs;
    this._maxSize = maxSize;
    this._interval = setInterval(() => this._purge(), windowMs * cleanupMultiplier).unref();
  }

  /** Simple cooldown: returns true if key is still in cooldown */
  isLimited(key) {
    const ts = this._map.get(key);
    return ts != null && Date.now() - ts < this._windowMs;
  }

  /** Record a timestamp for a key */
  touch(key) {
    if (this._maxSize && this._map.size >= this._maxSize) {
      // Prefer evicting an already-expired entry over an active one
      const now = Date.now();
      let evictKey = null;
      for (const [k, val] of this._map) {
        const ts = typeof val === 'object' ? val.firstAttempt : val;
        if (now - ts > this._windowMs) { evictKey = k; break; }
      }
      this._map.delete(evictKey ?? this._map.keys().next().value);
    }
    this._map.set(key, Date.now());
  }

  /** Remove a key immediately (e.g. clear rate-limit counter after success) */
  delete(key) {
    this._map.delete(key);
  }

  /** Count-based rate-limit: returns true if key has exceeded max within window */
  increment(key, max) {
    const now = Date.now();
    const entry = this._map.get(key);
    if (!entry || typeof entry !== 'object' || now - entry.firstAttempt > this._windowMs) {
      this._map.set(key, { count: 1, firstAttempt: now });
      return false;
    }
    entry.count += 1;
    return entry.count > max;
  }

  get size() { return this._map.size; }

  _purge() {
    const now = Date.now();
    for (const [key, val] of this._map) {
      const ts = typeof val === 'object' ? val.firstAttempt : val;
      if (now - ts > this._windowMs) this._map.delete(key);
    }
  }

  destroy() { clearInterval(this._interval); }
}

module.exports = CooldownMap;
