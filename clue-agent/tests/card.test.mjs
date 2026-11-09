// The share card says only true things, and says them the same way every time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sandbox = { document: {} };
new Function('window', 'document', readFileSync(new URL('../public/card.js', import.meta.url), 'utf8'))(sandbox, sandbox.document);
const { describe, postText } = sandbox.ClueCard;

test('a call just placed shows what it pays if it lands, and labels it as a possibility', () => {
  const d = describe({ kind: 'placed', side: 'Yes', entry: 0.376, shares: 5.19, paid: 1.95 });
  assert.equal(d.tag, "I'M IN");
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

// ---- the post that goes with each card ----
const URL_ = 'https://www.oncluemarket.xyz/#/event/worlds-2026-winner';
const sample = { question: 'Will Bilibili Gaming win Worlds 2026?', side: 'Yes', entry: 0.376, shares: 5.19, paid: 1.95 };
const posts = {
  placed: postText({ ...sample, kind: 'placed' }, URL_),
  open: postText({ ...sample, kind: 'open', now: 0.41 }, URL_),
  down: postText({ ...sample, kind: 'open', now: 0.3 }, URL_),
  won: postText({ ...sample, kind: 'won', payout: 5.19 }, URL_),
  lost: postText({ ...sample, kind: 'lost' }, URL_),
};

test('each card has its own post, in plain paragraphs with real numbers', () => {
  assert.match(posts.placed.body, /^I'm in on Yes at 37\.6¢: "Will Bilibili Gaming win Worlds 2026\?"\n\nIf it lands, \$1\.95 turns into \$5\.19\./);
  assert.match(posts.open.body, /^Checking in on my Yes call/); assert.match(posts.open.body, /\$0\.18 up on \$1\.95 so far/);
  assert.match(posts.down.body, /\$0\.39 down on \$1\.95 so far/);
  assert.match(posts.won.body, /^Called it\./); assert.match(posts.won.body, /\$3\.24 made/);
  assert.match(posts.lost.body, /^Missed this one\./); assert.match(posts.lost.body, /\$1\.95 gone/);
  assert.equal(new Set(Object.values(posts).map((p) => p.body)).size, 5);
});

test('posts have no formatting marks, no hashtags and end with the link', () => {
  for (const p of Object.values(posts)) {
    assert.doesNotMatch(p.body, /[*_#`~]/);          // the link itself has a # in it; the words must not
    assert.ok(p.full.endsWith(`\n${URL_}`));
    assert.ok(p.body.split('\n\n').length >= 3);
  }
});

test('a post always fits on X, even for a very long question', () => {
  const long = 'Will the price of Bitcoin close above one hundred and twenty thousand dollars on the last day of November according to the main price index published by the exchange?';
  for (const kind of ['placed', 'open', 'won', 'lost']) {
    const p = postText({ ...sample, question: long, kind, now: 0.5, payout: 5.19 }, URL_);
    assert.ok(p.body.length + 1 + 23 <= 280, `${kind} post is ${p.body.length + 24} characters`);
    assert.match(p.body, /…"/);
  }
});
