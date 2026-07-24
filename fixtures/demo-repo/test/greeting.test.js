import assert from 'node:assert/strict';
import test from 'node:test';
import { greeting } from '../src/greeting.js';

test('greets a named user', () => {
  assert.equal(greeting('Ada'), 'Hello, Ada!');
});
