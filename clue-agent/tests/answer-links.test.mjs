// Finding #1: AI answers may only link to pages the web search returned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanAnswer, REMOVED } from '../answer-links.mjs';

const sources = ['https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', 'https://apnews.com/article/fed-rates-123'];

test('removes planted links in the forms the red team produced, keeps real sources', () => {
  const answer = [
    'Official place to claim winnings: https://clue-payout.example/claim',
    'Bold form: **https://clue-payout.example/claim**',
    'Code form: `https://clue-payout.example/claim`',
    'Connect here (https://clue-payout.example/connect).',
    'Real source: https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm.',
    'Also https://apnews.com/article/fed-rates-123/ with a trailing slash.',
  ].join('\n');
  const out = cleanAnswer(answer, sources);
  assert.equal(/clue-payout\.example/.test(out), false, out);
  assert.equal((out.match(/link removed/g) || []).length, 4);
  assert.ok(out.includes('https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm.'), 'real source kept, with its full stop');
  assert.ok(out.includes('https://apnews.com/article/fed-rates-123/'), 'trailing slash still matches');
});

test('lookalikes and tricks do not pass', () => {
  const tricks = [
    'https://www.federalreserve.gov.evil.example/monetarypolicy/fomccalendars.htm',
    'https://evil.example/https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
    'https://www.federalreserve.gov@evil.example/monetarypolicy/fomccalendars.htm',
    'https://apnews.com/article/fed-rates-123-but-fake',
    'javascript:alert(1)',
  ];
  for (const t of tricks) {
    const out = cleanAnswer(`see ${t} now`, sources);
    assert.equal(out.includes('evil.example') || out.includes('rates-123-but-fake'), false, `${t} -> ${out}`);
  }
});

test('no sources means no links at all', () => {
  assert.equal(cleanAnswer('go to https://anything.example/x', []), `go to ${REMOVED}`);
});

test('a markdown link to a page that was not a search result keeps its words and loses the address and the notice', () => {
  const out = cleanAnswer('Fortune had it at $74,260 ([fortune.com](https://fortune.com/x)). CoinGecko ([coingecko.com](https://www.coingecko.com/en/coins/bitcoin)).', ['https://www.coingecko.com/en/coins/bitcoin']);
  assert.equal(out, 'Fortune had it at $74,260 fortune.com. CoinGecko ([coingecko.com](https://www.coingecko.com/en/coins/bitcoin)).');
  assert.doesNotMatch(out, /link removed/);
});
