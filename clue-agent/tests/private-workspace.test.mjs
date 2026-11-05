import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir=await mkdtemp(join(tmpdir(),'clue-test-'));
const port=31000+Math.floor(Math.random()*10000), base=`http://127.0.0.1:${port}`;
const env={...process.env,PORT:String(port),CLUE_DATA_DIR:dir}; delete env.DATABASE_URL;delete env.NEAR_AI_API_KEY;delete env.BETTER_AUTH_URL;delete env.BETTER_AUTH_SECRET;
const server=spawn(process.execPath,['server.mjs'],{env,stdio:'ignore'});
after(async()=>{server.kill();await new Promise(resolve=>server.once('exit',resolve));await rm(dir,{recursive:true,force:true})});
async function ready(){for(let i=0;i<100;i++){try{if((await fetch(base)).ok)return}catch{}await new Promise(r=>setTimeout(r,100))}throw new Error('server failed to start')}
async function request(path,{cookie,body,method}={}){const res=await fetch(base+path,{method:method||(body?'POST':'GET'),headers:{Origin:base,...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:res.status,body:await res.json(),cookie:res.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')}}
test('accounts isolate private research, revisions, forecasts and deletion',async()=>{
 await ready();
 const signup=async name=>request('/api/auth/sign-up/email',{body:{name,email:`${name}@example.test`,password:'testing-password-123'}});
 const a=await signup('alice'),b=await signup('bob');assert.equal(a.status,200);assert.equal(b.status,200);
 const sample={question:'What evidence is available?',content:'A report.',sources:['https://example.org/evidence'],model:'test',retrievedAt:'2026-11-05T00:00:00Z'};
 const first=await request('/api/threads',{cookie:a.cookie,body:sample});assert.equal(first.status,201);const id=first.body.id;
 assert.equal((await request(`/api/threads/${id}`,{cookie:b.cookie})).status,404);assert.equal((await request(`/api/threads/${id}`)).status,401);
 assert.equal((await request('/api/threads',{cookie:a.cookie,body:{...sample,threadId:id}})).status,201);
 const forecast={probability:42,reasoning:'A view',changeCondition:'New evidence'};
 assert.equal((await request(`/api/threads/${id}/forecasts`,{cookie:a.cookie,body:forecast})).status,201);
 assert.equal((await request(`/api/threads/${id}/forecasts`,{cookie:b.cookie,body:forecast})).status,404);
 assert.equal((await request(`/api/threads/${id}/forecasts`,{cookie:a.cookie,body:{...forecast,probability:101}})).status,400);
 const saved=await request(`/api/threads/${id}`,{cookie:a.cookie});assert.equal(saved.body.revisions.length,2);assert.equal(saved.body.forecasts.length,1);
 assert.equal((await request(`/api/threads/${id}/publish`,{cookie:b.cookie,body:{}})).status,404);
 const published=await request(`/api/threads/${id}/publish`,{cookie:a.cookie,body:{}});assert.equal(published.status,201);
 const publicReport=await request(`/api/public/${published.body.id}`);assert.equal(publicReport.status,200);assert.equal(publicReport.body.snapshot.question,sample.question);assert.equal(publicReport.body.snapshot.forecasts,undefined);assert.equal(JSON.stringify(publicReport.body).includes('New evidence'),false);
 assert.equal((await request(`/api/threads/${id}/publications/${published.body.id}`,{cookie:b.cookie,method:'DELETE'})).status,404);
 assert.equal((await request(`/api/threads/${id}/publications/${published.body.id}`,{cookie:a.cookie,method:'DELETE'})).status,200);assert.equal((await request(`/api/public/${published.body.id}`)).status,404);
 assert.equal((await request(`/api/threads/${id}`,{cookie:a.cookie,method:'DELETE'})).status,200);assert.equal((await request(`/api/threads/${id}`,{cookie:a.cookie})).status,404);
});
