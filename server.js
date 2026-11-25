const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),G=require('./engine');
const token=process.env.BOT_TOKEN||'',data=process.env.DATA_FILE||path.join(__dirname,'data.json'),demo=false;let users={};try{users=JSON.parse(fs.readFileSync(data,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}function save(){fs.mkdirSync(path.dirname(data),{recursive:true});fs.writeFileSync(data+'.tmp',JSON.stringify(users),{mode:0o600});fs.renameSync(data+'.tmp',data)}
function verify(raw){if(!token||typeof raw!=='string'||raw.length>16000)return null;const p=new URLSearchParams(raw),hash=p.get('hash');if(!/^[a-f0-9]{64}$/i.test(hash||''))return null;p.delete('hash');let str=[...p.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>k+'='+v).join('\n');let key=crypto.createHmac('sha256','WebAppData').update(token).digest(),calc=crypto.createHmac('sha256',key).update(str).digest();if(!crypto.timingSafeEqual(calc,Buffer.from(hash,'hex')))return null;const age=Date.now()/1000-Number(p.get('auth_date'));if(!Number.isFinite(age)||age>86400||age< -60)return null;try{let u=JSON.parse(p.get('user'));return Number.isSafeInteger(u.id)&&u.id>0?String(u.id):null}catch{return null}}
let botUsername=(process.env.BOT_USERNAME||'').replace(/^@/,'');if(!/^[A-Za-z0-9_]{5,32}$/.test(botUsername))botUsername='';
const secret=process.env.WEBHOOK_SECRET||'',publicUrl=(process.env.PUBLIC_URL||'').replace(/\/$/,'');let payments=false;const requested=process.env.PAYMENTS_ENABLED==='1';
async function bot(method,args){const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(7000)});const b=await r.json();if(!r.ok||!b.ok)throw Error('Telegram API: '+(b.description||method));return b.result}
const P=require('./payments')({users,save,G,bot});
function validSecret(value){const a=Buffer.from(String(value||'')),b=Buffer.from(secret);return b.length>=32&&a.length===b.length&&crypto.timingSafeEqual(a,b)}
const REF_REWARD=5000;
// Only a verified, first-time Telegram account can trigger an invitation reward.
function account(uid,initData,t){
 if(Object.hasOwn(users,uid))return users[uid];
 const s=G.fresh(t);users[uid]=s;
 const code=new URLSearchParams(initData).get('start_param')||'';
 const m=/^ref_([a-f0-9]{32})$/.exec(code);
 const inviter=m&&users._refCodes?.[m[1]];
 if(inviter&&inviter!==uid&&Object.hasOwn(users,inviter)){
   const owner=users[inviter];G.tick(owner,t);owner.bonus+=REF_REWARD;owner.total+=REF_REWARD;
   owner.refCount=(owner.refCount||0)+1;owner.refEarned=(owner.refEarned||0)+REF_REWARD;
   s.referredBy=inviter;
 }
 return s;
}
function referralInfo(uid,s){
 const codes=users._refCodes||(users._refCodes={});
 if(!s.refCode||codes[s.refCode]!==uid){do{s.refCode=crypto.randomBytes(16).toString('hex')}while(Object.hasOwn(codes,s.refCode));codes[s.refCode]=uid}
 return {count:s.refCount||0,earned:s.refEarned||0,url:botUsername?'https://t.me/'+botUsername+'?startapp=ref_'+s.refCode:''};
}
const page=fs.readFileSync(path.join(__dirname,'index.html'));const limiter=new Map();function json(res,status,obj){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj))}
http.createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');if(req.method==='GET'&&(url.pathname==='/'||url.pathname==='/index.html')){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'});return res.end(page)}if(req.method==='GET'&&url.pathname==='/health')return json(res,200,{ok:true,telegramConfigured:!!token,payments});if(req.method!=='POST'||!['/api/action','/api/invoice','/telegram/webhook'].includes(url.pathname))return json(res,404,{error:'Not found'});try{let body='';for await(const chunk of req){body+=chunk;if(body.length>32000){return json(res,413,{error:'Too large'})}}let b=JSON.parse(body);if(url.pathname==='/telegram/webhook'){if(!validSecret(req.headers['x-telegram-bot-api-secret-token']))return json(res,403,{error:'Forbidden'});try{await P.update(b);return json(res,200,{ok:true})}catch(e){console.error('Webhook processing failed:',e.message);return json(res,503,{error:'Retry'})}}let uid=verify(b.initData);if(!uid)return json(res,401,{error:'Открой Mini App через настроенного Telegram-бота'});let t=Date.now(),lim=limiter.get(uid)||{t,n:0};if(t-lim.t>1000)lim={t,n:0};lim.n++;limiter.set(uid,lim);if(lim.n>20)return json(res,429,{error:'Слишком много запросов'});if(url.pathname==='/api/invoice'){if(!payments)return json(res,503,{error:'Оплата ещё не подключена'});try{return json(res,200,{url:await P.invoice(uid,b.i)})}catch(e){console.error(e.message);return json(res,502,{error:'Не удалось создать счёт. Попробуй снова.'})}}let s=account(uid,b.initData,t);let out=G.apply(s,b.action||{},t,demo);const referral=referralInfo(uid,s);save();return json(res,200,{...out,demo,payments,referral})}catch(e){console.error(e.message);return json(res,400,{error:'Ошибка запроса'})}}).listen(Number(process.env.PORT)||8080,'0.0.0.0',async()=>{console.log('KAVRY COIN ready');if(token&&!botUsername){try{let me=await bot('getMe',{});if(/^[A-Za-z0-9_]{5,32}$/.test(me.username||''))botUsername=me.username}catch(e){console.error('Referral links: configure BOT_USERNAME or check Telegram connection')}}if(requested){if(!token||!/^https:\/\//.test(publicUrl)||!/^[-_A-Za-z0-9]{32,256}$/.test(secret)||!process.env.PAYMENT_SUPPORT_TEXT){console.error('Payments disabled: BOT_TOKEN, PUBLIC_URL, WEBHOOK_SECRET and PAYMENT_SUPPORT_TEXT required');return}try{await bot('setWebhook',{url:publicUrl+'/telegram/webhook',secret_token:secret,allowed_updates:['message','pre_checkout_query']});payments=true;console.log('Telegram Stars enabled')}catch(e){console.error('Payments disabled:',e.message)}}});
