import {randomBytes,createHash} from 'node:crypto';
import {PublicKey} from '@near-js/crypto';
import {store,auth} from './auth.mjs';
// Where the account-key check is sent. NEAR mainnet unless the operator points it elsewhere (tests use a local chain).
const NEAR_RPC=process.env.NEAR_RPC_URL||'https://rpc.mainnet.near.org';
const hash=x=>createHash('sha256').update(x).digest('hex');
const cookie=(req,name)=>String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1);
const str=x=>{const b=Buffer.from(x);const n=Buffer.alloc(4);n.writeUInt32LE(b.length);return Buffer.concat([n,b])};
export function messageDigest(message,nonce,recipient){const tag=Buffer.alloc(4);tag.writeUInt32LE(2147484061);return createHash('sha256').update(Buffer.concat([tag,str(message),Buffer.from(nonce,'base64'),str(recipient),Buffer.from([0])])).digest()}
export async function initWalletAuth(){
 await store.run('CREATE TABLE IF NOT EXISTS wallet_challenges (id TEXT PRIMARY KEY, binding TEXT NOT NULL, nonce TEXT NOT NULL, message TEXT NOT NULL, recipient TEXT NOT NULL, expires REAL NOT NULL)');
 await store.run('CREATE TABLE IF NOT EXISTS wallet_sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, account_id TEXT NOT NULL, expires REAL NOT NULL)');
}
const setCookie=(res,name,value,secure,maxAge)=>res.setHeader('Set-Cookie',name+'='+value+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+maxAge+(secure?'; Secure':''));
export async function startSession(res,origin,userId,label){const token=randomBytes(32).toString('hex');await store.run('INSERT INTO wallet_sessions VALUES (?,?,?,?)',hash(token),userId,label,Date.now()+604800000);setCookie(res,'clue_wallet',token,origin.startsWith('https:'),604800)}
export async function walletSession(req){const token=cookie(req,'clue_wallet');if(!token)return null;const s=await store.get('SELECT user_id,account_id FROM wallet_sessions WHERE token=? AND expires>?',hash(token),Date.now());return s?{user:{id:s.user_id,name:s.account_id,email:s.account_id}}:null}
export async function walletRoute(req,res,path,body,origin){
 const secure=origin.startsWith('https:');
 if(path==='/api/wallet/session'&&req.method==='GET')return await walletSession(req)||{};
 if(path==='/api/wallet/disconnect'&&req.method==='POST'){const token=cookie(req,'clue_wallet');if(token)await store.run('DELETE FROM wallet_sessions WHERE token=?',hash(token));setCookie(res,'clue_wallet','',secure,0);return {disconnected:true}}
 if(path==='/api/wallet/challenge'&&req.method==='POST'){
  const id=randomBytes(24).toString('hex'),binding=randomBytes(32).toString('hex'),nonce=randomBytes(32).toString('base64'),message='Connect to Clue. This verifies wallet ownership without a transaction. Request: '+id,recipient=new URL(origin).host;
  await store.run('DELETE FROM wallet_challenges WHERE expires<?',Date.now());
  await store.run('INSERT INTO wallet_challenges VALUES (?,?,?,?,?,?)',id,hash(binding),nonce,message,recipient,Date.now()+300000);
  setCookie(res,'clue_challenge',binding,secure,300);return {id,nonce,message,recipient};
 }
 if(path==='/api/wallet/verify'&&req.method==='POST'){
  const {id,accountId,publicKey,signature}=body;
  if(typeof accountId!=='string'||!/^([a-z0-9]+[-_])*[a-z0-9]+(\.([a-z0-9]+[-_])*[a-z0-9]+)*$/.test(accountId)||accountId.length>64||typeof publicKey!=='string'||!publicKey.startsWith('ed25519:')||typeof signature!=='string')throw Object.assign(Error('Invalid wallet response'),{status:400});
  const c=await store.get('SELECT * FROM wallet_challenges WHERE id=? AND expires>?',id,Date.now());
  if(!c||c.binding!==hash(cookie(req,'clue_challenge')||''))throw Object.assign(Error('Wallet request expired. Connect again.'),{status:401});
  if(!PublicKey.fromString(publicKey).verify(messageDigest(c.message,c.nonce,c.recipient),Buffer.from(signature,'base64')))throw Object.assign(Error('Wallet signature could not be verified.'),{status:401});
  const r=await fetch(NEAR_RPC,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'clue',method:'query',params:{request_type:'view_access_key',finality:'final',account_id:accountId,public_key:publicKey}}),signal:AbortSignal.timeout(15000)});
  const result=await r.json();if(!r.ok||result.result?.permission!=='FullAccess')throw Object.assign(Error('This key is not a full-access key for that NEAR account.'),{status:401});
  const consumed=await store.run('DELETE FROM wallet_challenges WHERE id=? AND binding=?',id,c.binding);if(!consumed.changes)throw Object.assign(Error('Wallet request already used.'),{status:401});
  const userId='near:'+accountId;
  let user=await store.get('SELECT id FROM "user" WHERE email=?',accountId+'@near.wallet.invalid');
  if(!user){await (await auth.$context).internalAdapter.createUser({id:userId,name:accountId,email:accountId+'@near.wallet.invalid',emailVerified:false});user=await store.get('SELECT id FROM "user" WHERE email=?',accountId+'@near.wallet.invalid')}
  const token=randomBytes(32).toString('hex');await store.run('INSERT INTO wallet_sessions VALUES (?,?,?,?)',hash(token),user.id,accountId,Date.now()+604800000);
  setCookie(res,'clue_wallet',token,secure,604800);return {user:{id:user.id,name:accountId,email:accountId}};
 }
 throw Object.assign(Error('Not found'),{status:404});
}

