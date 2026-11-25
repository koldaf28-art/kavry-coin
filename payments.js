const crypto=require('node:crypto');
const TERMS='Покупка за Telegram Stars даёт игровой буст, не криптовалюту и не право на гарантированный выпуск или доход. Буст поступает в инвентарь после подтверждения платежа, срок начинается после активации. VIP 30 дней, без автопродления. При проблемах или запросе возврата отправь /paysupport этому боту. Возвраты рассматриваются с учётом применимых прав покупателя.';
// Orders are persisted with the game inventory, so retries cannot grant twice.
function paymentService({users,save,G,bot}){
 const orders=users._orders||(users._orders={});
 const charges=users._charges||(users._charges={});
 function match(p,uid){const o=orders[p.invoice_payload];return o&&o.uid===String(uid)&&p.currency==='XTR'&&p.total_amount===o.amount?o:null}
 async function invoice(uid,i){if(!Number.isInteger(i)||i<0||i>=G.boosts.length)throw Error('Неизвестный буст');const b=G.boosts[i],id=crypto.randomUUID();orders[id]={uid,i,amount:b[4],created:Date.now(),status:'new'};save();return bot('createInvoiceLink',{title:b[0],description:`Игровой майнинг ×${b[1]} на ${i===4?'30 дней':b[2]/3600+' ч.'}. Буст в инвентарь. Не гарантирует криптовалютный доход.`,payload:id,provider_token:'',currency:'XTR',prices:[{label:b[0],amount:b[4]}]})}
 async function update(u){if(u.pre_checkout_query){const p=u.pre_checkout_query,o=match(p,p.from.id);const ok=!!o&&(o.status==='new'||(o.status==='approved'&&o.checkoutId===p.id))&&Date.now()-o.created<86400000;if(ok){o.status='approved';o.checkoutId=p.id;save()}try{await bot('answerPreCheckoutQuery',{pre_checkout_query_id:p.id,ok,...(!ok?{error_message:'Счёт недействителен. Создай новый в игре.'}:{})})}catch(e){throw e}return}
 const m=u.message;if(!m)return;const p=m.successful_payment;if(p){const o=match(p,m.from?.id),id=p.telegram_payment_charge_id;if(typeof id!=='string'||!id||!o)throw Error('Payment mismatch: manual reconciliation required');if(Object.hasOwn(charges,id))return;if(o.status==='paid'){throw Error('Additional payment requires manual reconciliation')}const s=users[o.uid]||(users[o.uid]=G.fresh());const prev=o.status;s.inventory[o.i]++;o.status='paid';o.charge=id;charges[id]={uid:o.uid,i:o.i,amount:o.amount,order:p.invoice_payload,date:Date.now()};try{save()}catch(e){s.inventory[o.i]--;o.status=prev;delete o.charge;delete charges[id];throw e}return}
 if(m.refunded_payment){const p=m.refunded_payment,id=p.telegram_payment_charge_id,c=charges[id];if(c&&!c.refunded){c.refunded=true;const s=users[c.uid];if(s?.inventory[c.i]>0){s.inventory[c.i]--;c.removed=true}else c.manualReview=true;save()}return}
 const text=m.text||'',owner=process.env.OWNER_TELEGRAM_ID||'',privateChat=m.chat?.type==='private';
 if(!privateChat)return;
 const help=process.env.PAYMENT_SUPPORT_TEXT||'Для связи с владельцем отправь /support и описание проблемы, приложи ID платежа текстом. Не присылай пароль или данные карты.';
 if(/^\/(?:paysupport|paymentsupport)(?:@\w+)?(?:\s|$)/.test(text)){await bot('sendMessage',{chat_id:m.chat.id,text:help});return}
 if(/^\/terms(?:@\w+)?(?:\s|$)/.test(text)){await bot('sendMessage',{chat_id:m.chat.id,text:TERMS});return}
 const request=/^\/support(?:@\w+)?(?:\s+([\s\S]+))?$/.exec(text);
 if(request){if(!request[1]||!/^\d+$/.test(owner)){await bot('sendMessage',{chat_id:m.chat.id,text:help});return}await bot('sendMessage',{chat_id:owner,text:'KAVRY COIN · Поддержка\nИгрок: '+m.from.id+'\n'+request[1].slice(0,3000)+'\nОтвет: /reply '+m.from.id+' текст'});await bot('sendMessage',{chat_id:m.chat.id,text:'Запрос передан владельцу.'});return}
 const reply=/^\/reply(?:@\w+)?\s+(\d+)\s+([\s\S]+)$/.exec(text);
 if(reply&&String(m.from.id)===owner){await bot('sendMessage',{chat_id:reply[1],text:'Поддержка KAVRY COIN: '+reply[2].slice(0,3000)});await bot('sendMessage',{chat_id:m.chat.id,text:'Ответ отправлен.'});return}
 if(/^\/start(?:@\w+)?(?:\s|$)/.test(text)){await bot('sendMessage',{chat_id:m.chat.id,text:'KAVRY COIN — открой игру кнопкой «Играть» в меню бота.'})}}

 return {invoice,update};
}
module.exports=paymentService;
