import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {KeyPair} from '@near-js/crypto';
process.env.CLUE_DATA_DIR=mkdtempSync(join(tmpdir(),'clue-wallet-test-'));
const {initWalletAuth,walletRoute,walletSession,messageDigest}=await import('../wallet-auth.mjs');
await initWalletAuth();
test('NEP-413 verification rejects tampering and replay; sessions revoke',async()=>{
 const origin='http://127.0.0.1:3000';let cookies=[];const res={setHeader:(k,v)=>cookies.push(v)};
 const req={method:'POST',headers:{}};
 const c=await walletRoute(req,res,'/api/wallet/challenge',{},origin);
 req.headers.cookie=cookies.at(-1).split(';')[0];
 const key=KeyPair.fromRandom('ed25519');const signature=Buffer.from(key.sign(messageDigest(c.message,c.nonce,c.recipient)).signature).toString('base64');
 const body={id:c.id,accountId:'test.near',publicKey:key.getPublicKey().toString(),signature};
 await assert.rejects(()=>walletRoute(req,res,'/api/wallet/verify',{...body,signature:Buffer.alloc(64).toString('base64')},origin));
 const original=globalThis.fetch;globalThis.fetch=async(url,options)=>{assert.equal(url,'https://rpc.mainnet.near.org');assert.equal(JSON.parse(options.body).params.public_key,body.publicKey);return {ok:true,json:async()=>({result:{permission:'FullAccess'}})}};
 try{const result=await walletRoute(req,res,'/api/wallet/verify',body,origin);assert.equal(result.user.name,'test.near');await assert.rejects(()=>walletRoute(req,res,'/api/wallet/verify',body,origin));}finally{globalThis.fetch=original}
 req.headers.cookie=cookies.at(-1).split(';')[0];assert.equal((await walletSession(req)).user.name,'test.near');
 await walletRoute(req,res,'/api/wallet/disconnect',{},origin);assert.equal(await walletSession(req),null);
});
