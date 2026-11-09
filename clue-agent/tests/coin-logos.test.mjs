// Every coin and chain Clue offers for funding has a logo that ships with the app and is served, and the logos are plain drawings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const dir = new URL('../public/assets/coins/', import.meta.url);
const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const intents = readFileSync(new URL('../intents.mjs', import.meta.url), 'utf8');

test('each coin and each chain offered has a logo, and the server serves it', () => {
  const symbols = [...new Set([...intents.matchAll(/\['?([A-Za-z]+)'?(?:,\s*'?[A-Za-z]+'?)*\]/g)].flatMap((m) => m[0].match(/[A-Za-z]+/g)))];
  const offeredCoins = Object.entries(JSON.parse(JSON.stringify({ near: ['wNEAR', 'USDC', 'USDT'], base: ['USDC', 'ETH'], eth: ['USDC', 'USDT', 'ETH'], arb: ['USDC', 'ETH'], sol: ['USDC', 'SOL'], op: ['USDC'] })));
  const logoOf = Object.fromEntries([...app.matchAll(/(\w+): "(\w+)"/g)].filter((m) => ['wNEAR', 'USDC', 'USDT', 'ETH', 'SOL'].includes(m[1])).map((m) => [m[1], m[2]]));
  assert.ok(symbols.length > 3);
  for (const [chain, coins] of offeredCoins) {
    assert.ok(new RegExp(`${chain}: \\[`).test(intents), `${chain} is offered by the server`);
    for (const coin of coins) { assert.ok(logoOf[coin], `${coin} has a logo name`); assert.ok(existsSync(new URL(`${logoOf[coin]}.svg`, dir)), `${coin} logo file`); assert.ok(server.includes(`'/assets/coins/${logoOf[coin]}.svg'`), `${coin} logo is served`); }
    assert.ok(existsSync(new URL(`chain-${chain}.svg`, dir)), `${chain} chain logo file`);
    assert.ok(server.includes(`'/assets/coins/chain-${chain}.svg'`), `${chain} chain logo is served`);
  }
});

test('the logos are plain drawings: no scripts, no outside references', () => {
  for (const name of ['near', 'usdc', 'usdt', 'eth', 'sol', 'chain-near', 'chain-base', 'chain-eth', 'chain-arb', 'chain-sol', 'chain-op']) {
    const svg = readFileSync(new URL(`${name}.svg`, dir), 'utf8');
    assert.match(svg, /^<svg[\s>]/, name);
    assert.doesNotMatch(svg, /<script|javascript:|href\s*=\s*["']https?:|\son[a-z]+\s*=|<foreignObject|<image/i, name);
    assert.ok(svg.length < 3000, `${name} is small`);
  }
});
