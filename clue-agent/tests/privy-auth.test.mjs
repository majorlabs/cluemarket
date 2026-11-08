import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, createSign } from 'node:crypto';
process.env.CLUE_DATA_DIR = mkdtempSync(join(tmpdir(), 'clue-privy-test-'));
const { verifyPrivyToken, normalizePem } = await import('../privy-auth.mjs');

const APP = 'cmtestapp000000000000000';
const DID = 'did:privy:cmuser123';
const b64u = (b) => Buffer.from(b).toString('base64url');
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
const other = generateKeyPairSync('ec', { namedCurve: 'P-256' });

function sign(claims, { key = privateKey, alg = 'ES256' } = {}) {
  const head = b64u(JSON.stringify({ alg, typ: 'JWT' }));
  const body = b64u(JSON.stringify(claims));
  const sig = createSign('SHA256').update(head + '.' + body).sign({ key, dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${b64u(sig)}`;
}
const good = (over = {}) => ({ iss: 'privy.io', aud: APP, sub: DID, exp: Math.floor(Date.now() / 1000) + 600, ...over });
const check = (t) => verifyPrivyToken(t, { appId: APP, publicKeyPem });

test('accepts a valid Privy token and returns the user DID', () => {
  assert.equal(check(sign(good())).did, DID);
});

test('rejects tampered, wrongly signed, wrong-app, expired and wrong-algorithm tokens', () => {
  const t = sign(good());
  const [h, , s] = t.split('.');
  assert.throws(() => check(`${h}.${b64u(JSON.stringify(good({ sub: 'did:privy:cmattacker' })))}.${s}`), /could not be verified/, 'tampered payload');
  assert.throws(() => check(sign(good(), { key: other.privateKey })), /could not be verified/, 'signed by a different key');
  assert.throws(() => check(sign(good({ aud: 'someone-elses-app' }))), /different app/, 'wrong audience');
  assert.throws(() => check(sign(good({ iss: 'evil.example' }))), /different app/, 'wrong issuer');
  assert.throws(() => check(sign(good({ exp: Math.floor(Date.now() / 1000) - 5 }))), /expired/, 'expired');
  assert.throws(() => check(sign(good({ sub: 'not-a-did' }))), /Invalid/, 'bad subject');
  assert.throws(() => check(sign(good(), { alg: 'none' })), /Unsupported/, 'wrong algorithm');
  const [h2, b2] = t.split('.');
  assert.throws(() => check(`${h2}.${b2}.AAAA`), /could not be verified/, 'short fake signature must not leak crypto errors');
  assert.throws(() => check('a.b'), /Invalid/, 'malformed');
  assert.throws(() => check(undefined), /Invalid/, 'missing');
});

test('accepts the public key exactly as Privy delivers it: one line, no line breaks', () => {
  // This is the form https://auth.privy.io/api/v1/apps/<id> returns. Node cannot read it as is.
  const oneLine = publicKeyPem.replace(/\s+/g, '').replace('-----BEGINPUBLICKEY-----', '-----BEGIN PUBLIC KEY-----').replace('-----ENDPUBLICKEY-----', '-----END PUBLIC KEY-----');
  assert.ok(!oneLine.includes('\n'));
  const token = sign(good());
  assert.equal(verifyPrivyToken(token, { appId: APP, publicKeyPem: oneLine }).did, DID);
  // and a wrong key in that same form is still refused
  const wrong = other.publicKey.export({ type: 'spki', format: 'pem' }).replace(/\n/g, '');
  assert.throws(() => verifyPrivyToken(token, { appId: APP, publicKeyPem: wrong }), /could not be verified/);
  // text that is not a key is left alone and refused, never accepted
  assert.equal(normalizePem('not a key'), 'not a key');
  assert.throws(() => verifyPrivyToken(token, { appId: APP, publicKeyPem: 'not a key' }), /could not be verified/);
});
