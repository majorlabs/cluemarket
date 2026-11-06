import { NearConnector } from '@hot-labs/near-connect';
const connector=new NearConnector({network:'mainnet',features:{signMessage:true},autoConnect:false});
window.clueConnect=async function(){
 const response=await fetch('/api/wallet/challenge',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const challenge=await response.json();if(!response.ok)throw Error(challenge.error);
 const wallet=await connector.connect();
 const signed=await wallet.signMessage({message:challenge.message,recipient:challenge.recipient,nonce:Uint8Array.from(atob(challenge.nonce),c=>c.charCodeAt(0))});
 const verified=await fetch('/api/wallet/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:challenge.id,...signed})});const result=await verified.json();if(!verified.ok)throw Error(result.error);return result;
};
window.clueDisconnect=async()=>{try{await connector.disconnect()}catch{} };
