// Browser shim for Node.js assert module
export default function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}
assert.equal = function(a, b, msg) { if (a != b) throw new Error(msg || `Assertion failed: ${a} != ${b}`); };
assert.strictEqual = function(a, b, msg) { if (a !== b) throw new Error(msg || `Assertion failed: ${a} !== ${b}`); };
assert.ok = assert;
assert.fail = function(msg) { throw new Error(msg || 'Assertion failed'); };
assert.deepEqual = assert.equal;
assert.notEqual = function(a, b, msg) { if (a == b) throw new Error(msg || `Assertion failed: ${a} == ${b}`); };
assert.throws = function(fn, msg) { let err; try { fn(); } catch (e) { err = e; } if (!err) throw new Error(msg || 'Expected function to throw'); };
