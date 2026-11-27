const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),G=require('./engine');
const token=process.env.BOT_TOKEN||'',data=process.env.DATA_FILE||path.join(__dirname,'data.json'),demo=false;let users={};try{users=JSON.parse(fs.readFileSync(data,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}function save(){fs.mkdirSync(path.dirname(data),{recursive:true});fs.writeFileSync(data+'.tmp',JSON.stringify(users),{mode:0o600});fs.renameSync(data+'.tmp',data)}
function verify(raw){if(!token||typeof raw!=='string'||raw.length>16000)return null;const p=new URLSearchParams(raw),hash=p.get('hash');if(!/^[a-f0-9]{64}$/i.test(hash||''))return null;p.delete('hash');let str=[...p.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>k+'='+v).join('\n');let key=crypto.createHmac('sha256','WebAppData').update(token).digest(),calc=crypto.createHmac('sha256',key).update(str).digest();if(!crypto.timingSafeEqual(calc,Buffer.from(hash,'hex')))return null;const age=Date.now()/1000-Number(p.get('auth_date'));if(!Number.isFinite(age)||age>86400||age< -60)return null;try{let u=JSON.parse(p.get('user'));return Number.isSafeInteger(u.id)&&u.id>0?String(u.id):null}catch{return null}}
let botUsername=(process.env.BOT_USERNAME||'').replace(/^@/,'');if(!/^[A-Za-z0-9_]{5,32}$/.test(botUsername))botUsername='';
const secret=process.env.WEBHOOK_SECRET||'',publicUrl=(process.env.PUBLIC_URL||'').replace(/\/$/,'');let payments=false;const requested=process.env.PAYMENTS_ENABLED==='1';
async function bot(method,args){const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(7000)});const b=await r.json();if(!r.ok||!b.ok)throw Error('Telegram API: '+(b.description||method));return b.result}
const P=require('./payments')({users,save,G,bot});
function validSecret(value){const a=Buffer.from(String(value||'')),b=Buffer.from(secret);return b.length>=32&&a.length===b.length&&crypto.timingSafeEqual(a,b)}
const REF_REWARD=5000;
// One-time owner test grant; never converts to a future-token allocation.
const ownerId=process.env.OWNER_TELEGRAM_ID||'';
const ownerBonus=Number(process.env.OWNER_START_BONUS||0);
function applyOwnerGrant(uid,s,t){
 if(uid!==ownerId||!/^\d+$/.test(ownerId)||!Number.isSafeInteger(ownerBonus)||ownerBonus<1||ownerBonus>1e12||s.ownerTest)return;
 G.tick(s,t);s.bonus+=ownerBonus;s.total+=ownerBonus;s.ownerTest=true;
}

// One-time additional developer pack; separate from the original owner grant.
const developerPackEnabled=process.env.OWNER_DEVELOPER_PACK==='1';
function applyDeveloperPack(uid,s,t){
 if(!developerPackEnabled||uid!==ownerId||!/^\d+$/.test(ownerId)||s.ownerDeveloperPackV1)return false;
 G.tick(s,t);
 s.bonus+=300000000;
 s.total+=300000000;
 for(let i=0;i<G.boosts.length;i++)s.inventory[i]=(s.inventory[i]||0)+1;
 s.ownerTest=true;
 s.ownerDeveloperPackV1=true;
 return true;
}

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

// Owner-only administration and short-lived foreground presence.
const presence=new Map(), ONLINE_TTL=15000;
const isOwner=uid=>/^\d+$/.test(ownerId)&&uid===ownerId;
const isPlayer=id=>/^[1-9]\d{0,15}$/.test(id)&&Object.hasOwn(users,id)&&users[id]&&typeof users[id]==='object';
function stats(t){for(const [id,last] of presence)if(t-last>=ONLINE_TTL)presence.delete(id);return {online:presence.size,registered:Object.keys(users).filter(isPlayer).length};}
const sweep=setInterval(()=>{stats(Date.now());for(const [id,x] of limiter)if(Date.now()-x.t>60000)limiter.delete(id)},15000);sweep.unref();
function admin(req,res,uid,b,t){
 if(!isOwner(uid))return json(res,403,{error:'Нет доступа'});
 const audit=Array.isArray(users._adminAudit)?users._adminAudit:[];
 const result=extra=>json(res,200,{...stats(t),...extra});
 if(b.op==='stats')return result({boosts:G.boosts.map((x,i)=>({i,name:x[0],mult:x[1],seconds:x[2]}))});
 if(b.op==='history')return result({history:audit.slice(0,30)});
 const id=String(b.target||'');if(!isPlayer(id))return json(res,404,{error:'Игрок не найден. Он должен хотя бы раз открыть игру.'});
 const s=users[id];
 const profile=()=>({id,balance:Math.floor(G.balance(s)),bonus:Math.floor(s.bonus),inventory:s.inventory,online:t-(presence.get(id)||0)<ONLINE_TTL});
 if(b.op==='lookup'){G.tick(s,t);return result({player:profile()});}
 if(!['coins','boost'].includes(b.op))return json(res,400,{error:'Неизвестная операция'});
 const key=String(b.key||'');if(!/^[a-f0-9-]{36}$/i.test(key))return json(res,400,{error:'Некорректный ID операции'});
 const old=audit.find(x=>x.key===key);if(old)return old.target===id&&old.op===b.op&&old.amount===b.amount&&old.i===(b.op==='boost'?b.i:null)?result({player:profile(),message:'Уже выдано'}):json(res,409,{error:'ID операции уже использован'});
 const amount=b.amount,i=b.i;
 if(!Number.isSafeInteger(amount)||amount<1||amount>(b.op==='coins'?1e12:1000))return json(res,400,{error:'Некорректное количество'});
 if(b.op==='boost'&&(!Number.isInteger(i)||i<0||i>=G.boosts.length))return json(res,400,{error:'Неизвестный буст'});
 G.tick(s,t);
 const before=JSON.stringify(s),previous=users._adminAudit;
 if(b.op==='coins'){
   if(!Number.isFinite(s.bonus)||!Number.isFinite(s.total)||s.bonus+amount>Number.MAX_SAFE_INTEGER||s.total+amount>Number.MAX_SAFE_INTEGER)return json(res,400,{error:'Превышен лимит баланса'});
   s.bonus+=amount;s.total+=amount;
 }else{
   const n=s.inventory[i]||0;if(!Number.isSafeInteger(n)||n+amount>Number.MAX_SAFE_INTEGER)return json(res,400,{error:'Превышен лимит бустов'});
   s.inventory[i]=n+amount;
 }
 users._adminAudit=[{key,target:id,op:b.op,amount,i:b.op==='boost'?i:null,date:t},...audit].slice(0,1000);
 try{save()}catch(e){users[id]=JSON.parse(before);if(previous===undefined)delete users._adminAudit;else users._adminAudit=previous;throw e;}
 return result({player:profile(),message:'Награда выдана'});
}

const adminUI="<style>\n#kc-admin-open{margin:12px 0;width:100%;padding:12px;border:1px solid #bd985b;border-radius:12px;background:#191710;color:#f8d38b;font:inherit;font-weight:700;cursor:pointer}\n#kc-admin[hidden],#kc-admin-open[hidden]{display:none!important}\n#kc-admin{position:fixed;inset:0;z-index:2147483000;overflow:auto;background:#080b12;color:#e8edf5;padding:20px 16px 45px;font:15px system-ui,sans-serif;box-sizing:border-box}\n#kc-admin *{box-sizing:border-box}#kc-admin .ac{background:#111722;border:1px solid #283140;border-radius:14px;padding:14px;margin:12px 0}\n#kc-admin .ar{display:flex;align-items:center;justify-content:space-between;gap:12px}#kc-admin .av{font-size:32px;font-weight:800;margin-top:4px}#kc-admin .al{color:#9aa9bc;font-size:12px}#kc-admin .online{color:#63e6ae}\n#kc-admin input,#kc-admin select,#kc-admin button{width:100%;padding:12px;margin:5px 0;border:1px solid #364153;border-radius:10px;background:#192231;color:#f3f5fa;font:inherit;min-height:44px}#kc-admin button{background:#d2ab69;color:#12100c;font-weight:700;cursor:pointer}#kc-admin button:disabled{opacity:.45;cursor:default}#kc-admin .close{width:auto;background:#192231;color:#fff}#kc-admin pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#b9c7d9;font:13px system-ui;margin:8px 0}#kc-admin h2,#kc-admin h3{margin:5px 0 10px;color:#f1f3f7}#kc-admin .note{font-size:12px;color:#9aa9bc}\n</style>\n<button hidden id=\"kc-admin-open\" type=\"button\">⚙ Админ-панель</button>\n<section hidden id=\"kc-admin\" aria-label=\"Админ-панель\">\n <div class=\"ar\"><div><div class=\"al\">KAVRY COIN / OWNER</div><h2>Админ-панель</h2></div><button class=\"close\" id=\"kc-close\" type=\"button\">Закрыть</button></div>\n <div class=\"ac ar\"><div><div class=\"al\">● Сейчас онлайн</div><div class=\"av online\" id=\"kc-online\">—</div></div><div><div class=\"al\">Всего игроков</div><div class=\"av\" id=\"kc-registered\">—</div></div></div>\n <div class=\"note\" id=\"kc-fresh\">Активность за последние 15 секунд · обновление каждые 5 секунд.</div>\n <div class=\"ac\"><h3>Найти игрока</h3><input id=\"kc-id\" inputmode=\"numeric\" placeholder=\"Telegram ID\" autocomplete=\"off\"><button id=\"kc-me\" type=\"button\">Мой аккаунт</button><button id=\"kc-find\" type=\"button\">Найти игрока</button><pre id=\"kc-player\">Игрок не выбран</pre></div>\n <div class=\"ac\"><h3>Выдать POINTS</h3><input id=\"kc-amount\" type=\"number\" min=\"1\" max=\"1000000000000\" step=\"1\" placeholder=\"Количество\"><button id=\"kc-coins\" type=\"button\" disabled>Выдать коины</button><div class=\"note\">Бонусные POINTS: доступны для улучшений, не обмениваются напрямую на резерв KVC.</div></div>\n <div class=\"ac\"><h3>Выдать бусты</h3><select id=\"kc-boost\"></select><input id=\"kc-qty\" type=\"number\" min=\"1\" max=\"1000\" step=\"1\" value=\"1\"><button id=\"kc-grant\" type=\"button\" disabled>Выдать буст</button><div class=\"note\">Буст поступит в инвентарь игрока.</div></div>\n <p id=\"kc-msg\" role=\"status\"></p><div class=\"ac\"><h3>История выдачи</h3><button id=\"kc-history\" type=\"button\">Обновить историю</button><pre id=\"kc-log\">—</pre></div>\n</section>\n<script>(()=>{const tg=window.Telegram?.WebApp;if(!tg?.initData)return;const q=id=>document.getElementById('kc-'+id),p=q('admin'),open=q('admin-open');let owner=false,selected='',busy=false,boosts=[],pendingGrant=null,foreground=tg.isActive!==false;\n const heading=[...document.querySelectorAll('h2')].find(x=>x.textContent==='Кошелёк и профиль');if(heading)heading.insertAdjacentElement('afterend',open);\n const visible=()=>!document.hidden&&foreground;\n async function post(path,b){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({initData:tg.initData,...b}),cache:'no-store'});let o=await r.json();if(!r.ok)throw Error(o.error||'Ошибка сервера');return o;}\n const msg=t=>q('msg').textContent=t;\n function showStats(o){q('online').textContent=o.online;q('registered').textContent=o.registered;q('fresh').textContent='Активность за последние 15 секунд · обновлено '+new Date().toLocaleTimeString('ru-RU');}\n function stale(){q('online').textContent='—';q('registered').textContent='—';q('fresh').textContent='Нет свежих данных';}\n function showPlayer(o){if(!o?.player||o.player.id!==q('id').value.trim())return;const x=o.player;selected=x.id;q('player').textContent='ID: '+x.id+'\\nБаланс: '+x.balance.toLocaleString('ru-RU')+' POINTS\\n'+(x.online?'Онлайн':'Офлайн')+'\\n'+boosts.map((v,i)=>v.name+': '+(x.inventory[i]||0)).join('\\n');controls();}\n function controls(){q('coins').disabled=q('grant').disabled=busy||!selected||selected!==q('id').value.trim();q('find').disabled=busy;}\n let beatBusy=false;\n async function beat(){if(!visible()||beatBusy)return;beatBusy=true;try{const o=await post('/api/presence',{});if(o.admin){owner=true;open.hidden=false;if(!p.hidden)showStats(o);}}catch{if(!p.hidden)stale();}finally{beatBusy=false;}}\n async function admin(b){const o=await post('/api/admin',b);showStats(o);return o;}\n async function lookup(){if(busy)return;selected='';q('player').textContent='Поиск…';controls();try{showPlayer(await admin({op:'lookup',target:q('id').value.trim()}));msg('');}catch(e){q('player').textContent='Игрок не найден';msg(e.message);}}\n async function history(){try{const o=await admin({op:'history'});q('log').textContent=o.history.map(x=>new Date(x.date).toLocaleString('ru-RU')+' · '+x.target+' · '+(x.op==='coins'?x.amount.toLocaleString('ru-RU')+' POINTS':(boosts[x.i]?.name||'Буст')+' ×'+x.amount)).join('\\n')||'История пуста';}catch(e){msg(e.message);}}\n open.onclick=async()=>{if(!owner)return;p.hidden=false;try{let o=await admin({op:'stats'});boosts=o.boosts;q('boost').replaceChildren(...boosts.map(b=>{let x=document.createElement('option');x.value=b.i;x.textContent=b.name+' ×'+b.mult+' / '+Math.round(b.seconds/3600)+' ч';return x;}));await history();}catch(e){stale();msg(e.message);}};\n q('close').onclick=()=>p.hidden=true;q('me').onclick=()=>{q('id').value=String(tg.initDataUnsafe?.user?.id||'');lookup();};q('find').onclick=lookup;q('id').oninput=()=>{selected='';q('player').textContent='Игрок не выбран';controls();};q('history').onclick=history;\n async function grant(op){if(busy||!selected||selected!==q('id').value.trim())return;const amount=Number(q(op==='coins'?'amount':'qty').value),i=op==='boost'?Number(q('boost').value):null;if(!Number.isSafeInteger(amount)||amount<1||amount>(op==='coins'?1e12:1000)){msg('Укажи корректное количество');return;}const target=selected,signature=JSON.stringify({op,target,amount,i});if(!confirm('Выдать '+amount+' '+(op==='coins'?'POINTS':boosts[i]?.name)+' игроку '+target+'?'))return;if(!pendingGrant||pendingGrant.signature!==signature)pendingGrant={signature,key:crypto.randomUUID()};busy=true;controls();try{const o=await admin({op,target,amount,i,key:pendingGrant.key});pendingGrant=null;showPlayer(o);msg(o.message);await history();}catch(e){msg(e.message+' — при повторе те же параметры используют тот же ID операции.');}finally{busy=false;controls();}}\n q('coins').onclick=()=>grant('coins');q('grant').onclick=()=>grant('boost');\n document.addEventListener('visibilitychange',beat);try{tg.onEvent('activated',()=>{foreground=true;beat();});tg.onEvent('deactivated',()=>{foreground=false;});}catch{}beat();setInterval(beat,5000);\n})();</script>";
const page=fs.readFileSync(path.join(__dirname,'index.html'),'utf8')
 .replace('<h2>Кошелёк и профиль</h2>','<h2>Кошелёк и профиль</h2><p class="caption">Telegram ID: <span id="ownTelegramId">—</span></p>')
 .replace('</body>','<script>document.getElementById("ownTelegramId").textContent=String(window.Telegram?.WebApp?.initDataUnsafe?.user?.id||"—");</script>'+adminUI+'</body>');const limiter=new Map();function json(res,status,obj){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj))}
http.createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');if(req.method==='GET'&&(url.pathname==='/'||url.pathname==='/index.html')){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'});return res.end(page)}if(req.method==='GET'&&url.pathname==='/health')return json(res,200,{ok:true,telegramConfigured:!!token,payments});if(req.method!=='POST'||!['/api/action','/api/invoice','/telegram/webhook','/api/presence','/api/admin'].includes(url.pathname))return json(res,404,{error:'Not found'});try{let body='';for await(const chunk of req){body+=chunk;if(body.length>32000){return json(res,413,{error:'Too large'})}}let b=JSON.parse(body);if(url.pathname==='/telegram/webhook'){if(!validSecret(req.headers['x-telegram-bot-api-secret-token']))return json(res,403,{error:'Forbidden'});try{await P.update(b);return json(res,200,{ok:true})}catch(e){console.error('Webhook processing failed:',e.message);return json(res,503,{error:'Retry'})}}let uid=verify(b.initData);if(!uid)return json(res,401,{error:'Открой Mini App через настроенного Telegram-бота'});let t=Date.now(),lim=limiter.get(uid)||{t,n:0};if(t-lim.t>1000)lim={t,n:0};lim.n++;limiter.set(uid,lim);if(lim.n>20)return json(res,429,{error:'Слишком много запросов'});if(url.pathname==='/api/presence'){presence.set(uid,t);return json(res,200,isOwner(uid)?{admin:true,...stats(t)}:{admin:false})}if(url.pathname==='/api/admin')return admin(req,res,uid,b,t);if(url.pathname==='/api/invoice'){if(!payments)return json(res,503,{error:'Оплата ещё не подключена'});try{return json(res,200,{url:await P.invoice(uid,b.i)})}catch(e){console.error(e.message);return json(res,502,{error:'Не удалось создать счёт. Попробуй снова.'})}}let s=account(uid,b.initData,t);applyOwnerGrant(uid,s,t);const developerGranted=applyDeveloperPack(uid,s,t);let out;if(s.ownerTest&&b.action?.type==='exchange'){G.apply(s,{type:'sync'},t,demo);out={ok:false,msg:'Тестовый аккаунт владельца: обмен на резерв KVC отключён',state:s}}else out=G.apply(s,b.action||{},t,demo);if(developerGranted&&out.ok&&b.action?.type==='sync')out.msg='DEVELOPER PACK: +300 000 000 POINTS и все бусты';const referral=referralInfo(uid,s);save();return json(res,200,{...out,demo,payments,referral})}catch(e){console.error(e.message);return json(res,400,{error:'Ошибка запроса'})}}).listen(Number(process.env.PORT)||8080,'0.0.0.0',async()=>{console.log('KAVRY COIN ready');if(token&&!botUsername){try{let me=await bot('getMe',{});if(/^[A-Za-z0-9_]{5,32}$/.test(me.username||''))botUsername=me.username}catch(e){console.error('Referral links: configure BOT_USERNAME or check Telegram connection')}}if(requested){if(!token||!/^https:\/\//.test(publicUrl)||!/^[-_A-Za-z0-9]{32,256}$/.test(secret)||!process.env.PAYMENT_SUPPORT_TEXT){console.error('Payments disabled: BOT_TOKEN, PUBLIC_URL, WEBHOOK_SECRET and PAYMENT_SUPPORT_TEXT required');return}try{await bot('setWebhook',{url:publicUrl+'/telegram/webhook',secret_token:secret,allowed_updates:['message','pre_checkout_query']});payments=true;console.log('Telegram Stars enabled')}catch(e){console.error('Payments disabled:',e.message)}}});
