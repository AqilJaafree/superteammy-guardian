/**
 * Attaches a catch handler to a promise that logs the error without crashing.
 * Use for fire-and-forget async operations where errors should not propagate.
 */
function logError(promise, label) {
  promise.catch((err) => console.error(`${label}:`, err.message));
}

module.exports = { logError };
