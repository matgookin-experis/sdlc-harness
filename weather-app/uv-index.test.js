'use strict';

const assert = require('node:assert/strict');
const { getUvIndex, getUvRisk } = require('./uv-index.js');

const expectedBoundaries = [
  [0, 'Low'],
  [2, 'Low'],
  [3, 'Moderate'],
  [5, 'Moderate'],
  [6, 'High'],
  [7, 'High'],
  [8, 'Very High'],
  [10, 'Very High'],
  [11, 'Extreme'],
  [12, 'Extreme'],
];

for (const [value, expectedLevel] of expectedBoundaries) {
  assert.equal(getUvRisk(value).level, expectedLevel, `UV ${value} category`);
}

for (let seed = 0; seed < 100_000; seed += 997) {
  const first = getUvIndex(seed);
  const second = getUvIndex(seed);
  assert.equal(first, second, `seed ${seed} is deterministic`);
  assert.ok(first >= 0 && first <= 12, `seed ${seed} remains in range`);
}

assert.throws(() => getUvRisk(-1), /non-negative integer/);
assert.throws(() => getUvRisk(2.5), /non-negative integer/);

console.log('UV Index tests passed.');
