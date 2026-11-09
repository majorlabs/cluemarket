// Real orders stay off unless switched on, for everyone or for listed wallet addresses only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ordersLiveFor } from '../orders-switch.mjs';

const mine = '0x162327E195dadBa9186D2A7718D8239A46F7994D';
const other = '0x1111111111111111111111111111111111111111';

test('off by default, for everyone', () => {
  assert.equal(ordersLiveFor({}), false);
  assert.equal(ordersLiveFor({ flag: '', addresses: '', wallet: mine }), false);
  assert.equal(ordersLiveFor({ flag: '0', wallet: mine }), false);
});

test('the global switch turns it on for everyone', () => {
  assert.equal(ordersLiveFor({ flag: '1' }), true);
  assert.equal(ordersLiveFor({ flag: '1', wallet: other }), true);
});

test('a listed address is on, any other address or none stays off (case does not matter)', () => {
  const addresses = ` ${mine.toLowerCase()} , ${'0x2222222222222222222222222222222222222222'}`;
  assert.equal(ordersLiveFor({ addresses, wallet: mine }), true);
  assert.equal(ordersLiveFor({ addresses, wallet: other }), false);
  assert.equal(ordersLiveFor({ addresses, wallet: null }), false);
  assert.equal(ordersLiveFor({ addresses, wallet: 'not an address' }), false);
});
