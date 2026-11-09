// The share card says only true things, and says them the same way every time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sandbox = { document: {} };
new Function('window', 'document', readFileSync(new URL('../public/card.js', import.meta.url), 'utf8'))(sandbox, sandbox.document);
const { describe } = sandbox.ClueCard;

test('a call just placed shows what it pays if it lands, and labels it as a possibility', () => {
  const d = describe({ kind: 'placed', side: 'Yes', entry: 0.376, shares: 5.19, paid: 1.95 });
  assert.equal(d.tag, 'MY CALL');
  assert.equal(d.big, '+166%');                           // $1 / 37.6c - 1
  assert.equal(d.sub, 'if Yes lands');
  assert.deepEqual(d.stats.map((s) => s[0]), ['SHARES', 'PAID', 'PAYS IF IT LANDS']);
  assert.equal(d.stats[2][1], '$5.19');
});

test('a live call shows what it is worth now, and turns dark when it is losing', () => {
  const up = describe({ kind: 'open', side: 'Yes', entry: 0.4, now: 0.5, shares: 10, paid: 4 });
  assert.equal(up.big, '+25%'); assert.equal(up.sub, '$1.00 right now'); assert.equal(up.dark, false);
  const down = describe({ kind: 'open', side: 'Yes', entry: 0.4, now: 0.3, shares: 10, paid: 4 });
  assert.equal(down.big, '−25%'); assert.equal(down.sub, '−$1.00 right now'); assert.equal(down.dark, true);
});

test('a win shows what was actually paid out; a loss says so plainly', () => {
  const won = describe({ kind: 'won', side: 'No', entry: 0.62, shares: 12.5, paid: 7.75, payout: 12.5 });
  assert.equal(won.tag, 'CALLED IT'); assert.equal(won.big, '+61%'); assert.equal(won.sub, '$4.75 made on this call');
  const lost = describe({ kind: 'lost', side: 'Yes', entry: 0.31, shares: 8, paid: 2.48 });
  assert.equal(lost.tag, 'MISSED THIS ONE'); assert.equal(lost.big, '−100%'); assert.equal(lost.stats[2][1], '$0.00'); assert.equal(lost.dark, true);
});

test('nothing private goes on the card', () => {
  const src = readFileSync(new URL('../card-client.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /address|email|signer|wallet/i);
});
