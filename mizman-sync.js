/* mizman-sync.js — اتصال سایت به سرور و دیتابیس PostgreSQL + ربات تلگرام؛
   پشتیبانی از کد دائمی اتصال به ربات و همگام‌سازی سفارش‌های QR و رزروها */
(function(){
if(window.__mzSync)return;window.__mzSync=1;
const API=(window.MIZMAN_API||'').replace(/\/$/,'');
const $=id=>document.getElementById(id),KEYS='mizman_keys_v1',TOK='mizman_tokens_v1',SEEN='mizman_seen_srv_v1';
const j=(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch(e){return d}},put=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
const cu=()=>window.currentUser&&window.currentUser();
const P_='در انتظار تایید کافه';

async function api(path,o={}){
  const r=await fetch(API+path,{
    method:o.body?'POST':'GET',
    headers:{'Content-Type':'application/json',...(o.key?{'x-key':o.key}:{})},
    body:o.body?JSON.stringify(o.body):undefined
  });
  const t=await r.json().catch(()=>({}));
  if(!r.ok)throw Object.assign(new Error(t.error||('HTTP '+r.status)),{status:r.status});
  return t;
}

const refresh=()=>{try{renderCafes();renderMerchantReservations();updateReservationsBadge()}catch(_){}};
const payload=r=>({
  id:r.id,
  cafeId:r.cafeId,
  cafe:r.cafe,
  code:r.code,
  customerName:r.customerName,
  phone:r.phone,
  day:r.day,
  time:r.time,
  dateISO:r.dateISO,
  table:r.table,
  guestCount:r.guestCount,
  menu:r.menu,
  orderTotal:r.orderTotal,
  coupon:r.coupon,
  discount:r.discount
});

/* ---- ثبت رزرو روی سرور (و ارسال به ربات کافه‌دار) ---- */
async function push(r){
  try{
    const s=await api('/api/reservations',{body:payload(r)});
    r.synced=true;
    r.ownerToken=s.token;
    delete r.pendingCreate;
    const t=j(TOK,{});
    t[r.id]=s.token;
    put(TOK,t);
    saveToStorage();
  }catch(e){
    if(e.status===409&&e.message!=='dup'){
      reservations=reservations.filter(x=>x!==r);
      saveToStorage();
      try{mzCloseModal()}catch(_){}
      refresh();
      alert('این میز همین الان توسط شخص دیگری رزرو شد؛ لطفاً میز یا ساعت دیگری انتخاب کنید.');
    }else if(e.status===409){
      r.synced=true;
      saveToStorage();
    }else{
      r.pendingCreate=true;
      saveToStorage();
    }
  }
}

const pF=window.finalizeBooking;
window.finalizeBooking=function(){
  const n=reservations.length,c=selectedWizardCafe;
  pF.apply(this,arguments);
  if(reservations.length>n){
    const r=reservations[0];
    r.cafeId=c&&c.id;
    push(r);
  }
};

/* ---- تایید/رد/تمام شدن در پنل سایت → سرور (و ویرایش پیام ربات) ---- */
const pS=window.mzSetRes;
window.mzSetRes=function(id,st){
  const r=reservations.find(x=>x.id===id),old=r&&r.status;
  pS.apply(this,arguments);
  if(!r||!r.synced)return;
  const key=j(KEYS,{})[r.cafeId];
  if(!key)return;
  api('/api/reservations/'+id+'/status',{body:{status:st},key}).catch(e=>{
    r.status=old;
    saveToStorage();
    refresh();
    alert(e.status?e.message:'اتصال به سرور برقرار نیست؛ تغییر اعمال نشد.');
  });
};

const pC=window.mzCancelReservation;
window.mzCancelReservation=function(i){
  const r=reservations[i],old=r&&r.status;
  pC.apply(this,arguments);
  if(!r||!r.synced||!r.ownerToken||r.status===old)return;
  api('/api/reservations/'+r.id+'/cancel',{body:{token:r.ownerToken}}).catch(e=>{
    r.status=old;
    saveToStorage();
    refresh();
    alert(e.status?e.message:'اتصال به سرور برقرار نیست؛ لغو انجام نشد.');
  });
};

/* ---- ثبت سفارش حضوری سر میز با QR روی سرور ---- */
const pQrSub=window.mzQrSubmit;
window.mzQrSubmit=function(){
  const n=(window.MZD?window.MZD.orders():[]).length;
  pQrSub.apply(this,arguments);
  const curOrders=window.MZD?window.MZD.orders():[];
  if(curOrders.length>n){
    const latest=curOrders[0];
    api('/api/orders',{body:latest}).catch(e=>console.warn('QR order offline:',e.message));
  }
};

/* ---- همگام‌سازی دوره‌ای (وضعیت‌ها و رزروهای تازه) ---- */
const ended=r=>{
  if(!r.dateISO)return false;
  const m=String(r.time).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).match(/(\d{1,2}):(\d{2})\s*$/);
  if(!m)return false;
  return new Date(r.dateISO+'T'+m[1].padStart(2,'0')+':'+m[2]+':00')<=new Date();
};

const toLocal=s=>({
  id:s.id,
  code:s.code,
  customerName:s.customerName,
  phone:s.phone,
  day:s.day,
  time:s.time,
  cafe:s.cafe,
  cafeId:s.cafeId,
  table:s.table,
  guestCount:s.guestCount,
  menu:s.menu,
  orderTotal:s.orderTotal,
  coupon:s.coupon,
  discount:s.discount,
  dateISO:s.dateISO,
  status:s.status,
  createdAt:s.createdAt,
  synced:true
});

function merge(list){
  const u=cu(),seen=j(SEEN,{});
  let ch=false;
  list.forEach(s=>{
    let r=reservations.find(x=>x.id===s.id);
    if(!r){
      if(u&&u.role==='merchant'){
        reservations.unshift(toLocal(s));
        ch=true;
        r=reservations[0];
        if(s.status===P_&&seen[s.id]===undefined&&Date.now()-new Date(s.createdAt)<6e5){
          if(window.mzToast)mzToast(`رزرو جدید: ${s.customerName} · ${s.table} · ${s.day} ${s.time}`);
          if(window.mzAddNotification)mzAddNotification('رزرو جدید',`${s.customerName} · ${s.table} · ${s.day} ${s.time}`);
        }
      }
      seen[s.id]=s.status;
      return;
    }
    if(r.status!==s.status){
      const keep=(r.status==='منقضی شده'||r.status==='تمام شد')&&(s.status===P_||s.status==='تایید شده')&&ended(r);
      if(!keep){
        r.status=s.status;
        ch=true;
        if(seen[s.id]!==undefined&&seen[s.id]!==s.status&&u&&u.role==='customer'&&r.phone===u.phone){
          if(window.mzToast)mzToast(`رزرو شما در ${r.cafe}: ${s.status}`);
        }
      }
    }
    seen[s.id]=s.status;
  });
  put(SEEN,seen);
  if(ch){
    saveToStorage();
    refresh();
    if(window.mzProcessWaitlist)window.mzProcessWaitlist();
  }
}

async function ensureCafe(){
  const u=cu();
  if(!u||u.role!=='merchant'||!u.cafeId)return;
  const k=j(KEYS,{});
  if(k[u.cafeId]||window.__mzClaimFail===u.cafeId)return;
  const c=cafesData.find(x=>Number(x.id)===Number(u.cafeId));
  try{
    const r=await api('/api/cafes',{body:{id:u.cafeId,name:c&&c.name,address:c&&c.address,phone:c&&c.phone,instagram:c&&c.instagram,tables:c&&c.tables,menu:c&&c.menu}});
    k[u.cafeId]=r.key;
    put(KEYS,k);
  }catch(e){
    if(e.status===409)window.__mzClaimFail=u.cafeId;
    else throw e;
  }
}

let busy=false;
async function tick(){
  if(busy)return;
  busy=true;
  try{
    const health=await api('/api/health');
    window.__mzOnline=true;
    window.__mzDbStatus=health.database;
    await ensureCafe();
    for(const r of reservations.filter(x=>x.pendingCreate&&x.cafeId))await push(r);
    const u=cu(),k=j(KEYS,{}),t=j(TOK,{});
    const cafes=u&&u.role==='merchant'&&u.cafeId&&k[u.cafeId]?[{id:u.cafeId,key:k[u.cafeId]}]:[];
    const tokens=Object.entries(t).map(([id,x])=>({id:+id,t:x}));
    if(cafes.length||tokens.length){
      const r=await api('/api/sync',{body:{cafes,tokens}});
      merge(r.reservations||[]);
    }
  }catch(e){
    if(!e.status)window.__mzOnline=false;
  }finally{
    busy=false;
  }
  mountCards();
  await statusAll();
}
window.mzSyncNow=tick;

/* ---- کارت اختصاصی «ربات تلگرام» با کد اتصال دائمی ---- */
const cardHtml=sfx=>`
<div id="mz-bot-card-${sfx}" class="mz-bot-card rounded-3xl border border-amber-500/30 p-5 space-y-4 mt-6" style="background:#18181b">
  <div class="flex items-center justify-between flex-wrap gap-2 border-b border-white/10 pb-3">
    <h4 class="text-white font-extrabold text-base flex items-center gap-2">
      <i class="fa-brands fa-telegram text-amber-400 text-xl"></i>
      اتصال به ربات هوشمند تلگرام (دستیار لحظه‌ای کافه‌دار)
    </h4>
    <span class="text-xs px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-bold">
      کد دائمی و همیشگی
    </span>
  </div>
  <p class="text-xs text-zinc-300 leading-6">
    با اتصال ربات تلگرام، هر رزرو جدید یا سفارش سر میز بلافاصله با صدای اعلان در تلگرام برای شما و پرسنل ارسال می‌شود و با دکمه‌های «تایید» یا «رد»، وضعیت در سایت در لحظه تغییر می‌کند.
  </p>
  <div class="mz-bot-status text-sm text-zinc-300">در حال بررسی ارتباط با سرور...</div>
  <div class="mz-bot-code text-sm"></div>
  <div class="flex gap-2 flex-wrap pt-1 border-t border-white/5">
    <button class="mz-btn mz-bot-btn text-xs font-bold px-4 py-2.5 rounded-xl bg-amber-500 text-dark-900 shadow-md">
      <i class="fa-solid fa-key ml-1"></i> نمایش کد دائمی اتصال
    </button>
    <button class="mz-btn text-xs font-medium px-4 py-2.5 rounded-xl bg-dark-700 text-zinc-300 hover:text-white" onclick="mzOpenFullPanel&&mzOpenFullPanel('setup')">
      تنظیمات کافه
    </button>
  </div>
</div>`;

function mountCards(){
  const u=cu();
  if(!u||u.role!=='merchant')return;
  const p=$('merchant-pane-setup');
  if(p&&!$('mz-bot-card-pane'))p.insertAdjacentHTML('beforeend',cardHtml('pane'));
  const a=$('mz-account-page'),c=$('mz-account-content');
  if(a&&!a.classList.contains('hidden')&&c&&c.children.length&&!$('mz-bot-card-acc'))c.insertAdjacentHTML('beforeend',cardHtml('acc'));
}

function statusText(){
  const u=cu(),key=j(KEYS,{})[u&&u.cafeId];
  if(!window.__mzOnline){
    return {
      h: location.protocol==='file:'
        ? '<span class="text-rose-400">سایت به صورت فایل باز شده است. لطفاً آن را از <b dir="ltr">http://localhost:3000</b> باز کنید.</span>'
        : '<span class="text-rose-400">سرور میز من در دسترس نیست. فرمان <b dir="ltr">node server.js</b> را اجرا کنید.</span>'
    };
  }
  if(!key){
    return {
      h: window.__mzClaimFail
        ? '<span class="text-rose-400">این کافه قبلاً ثبت شده است یا کلید مطابقت ندارد.</span>'
        : 'در حال هماهنگی اطلاعات کافه با سرور...'
    };
  }
  return {key};
}

async function statusAll(){
  const els=[...document.querySelectorAll('.mz-bot-status')];
  if(!els.length)return;
  const u=cu(),st=statusText();
  let h=st.h;

  if(st.key){
    try{
      const r=await api('/api/cafes/'+u.cafeId+'/bot',{key:st.key});
      const permCode=r.permanentCode||('MZ'+String(u.cafeId).slice(-6).toUpperCase());
      const botUrl=r.botLink||(r.botName?`https://t.me/${r.botName}?start=${permCode}`:'');

      h=r.connected
        ? `<div class="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold flex items-center gap-2">
             <i class="fa-solid fa-circle-check text-lg"></i>
             <span>ربات فعال است: ${r.connected} مدیر/چت متصل هستند.</span>
           </div>`
        : `<div class="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-300 font-medium">
             هنوز ربات تلگرام متصل نشده است. از کد دائمی زیر استفاده کنید:
           </div>`;

      // نمایش کد دائمی در کارت به طور خودکار
      document.querySelectorAll('.mz-bot-code').forEach(box=>{
        box.innerHTML=`
          <div class="mt-2 space-y-2">
            <div class="text-xs text-zinc-400">کد اتصال دائمی کافه شما (هرگز منقضی نمی‌شود):</div>
            <div class="flex items-center gap-2 flex-wrap">
              <div dir="ltr" class="p-3 rounded-xl bg-zinc-900 border border-amber-500/30 text-amber-400 font-mono font-bold text-base select-all tracking-wider">
                /start ${permCode}
              </div>
              <button onclick="navigator.clipboard.writeText('/start ${permCode}');alert('دستور اتصال کپی شد. آن را به ربات تلگرام بفرستید.')" class="px-3 py-2 rounded-xl bg-amber-500/20 text-amber-400 hover:bg-amber-500 hover:text-dark-900 text-xs font-bold transition-all">
                <i class="fa-solid fa-copy ml-1"></i> کپی دستور
              </button>
              ${botUrl?`<a class="px-4 py-2 rounded-xl bg-sky-500 text-white hover:bg-sky-400 text-xs font-bold inline-flex items-center gap-1.5 shadow-md shadow-sky-500/20" target="_blank" rel="noopener" href="${botUrl}">
                <i class="fa-brands fa-telegram"></i> باز کردن مستقیم ربات تلگرام
              </a>`:''}
            </div>
            <div class="text-[11px] text-zinc-400">
              💡 نکته: این کد دائمی است. هر زمان بخواهید می‌توانید با ارسال همین پیام، مدیران یا شیفت‌های دیگر را نیز به ربات متصل کنید بدون نیاز به دریافت کد جدید.
            </div>
          </div>
        `;
      });

      if(!r.botEnabled){
        h+=`<div class="text-rose-400 text-xs mt-1">⚠️ توکن ربات روی سرور تنظیم نشده است (BOT_TOKEN در فایل .env).</div>`;
      }
    }catch(e){
      h='<span class="text-rose-400">خطا در دریافت وضعیت ربات: '+(e.message||'')+'</span>';
    }
  }
  els.forEach(e=>{if(e.innerHTML!==h)e.innerHTML=h});
}

document.addEventListener('click',async ev=>{
  const b=ev.target.closest&&ev.target.closest('.mz-bot-btn');
  if(!b)return;
  const u=cu(),key=j(KEYS,{})[u&&u.cafeId];
  if(!window.__mzOnline||!key){
    alert('ابتدا اتصال به سرور باید برقرار شود.');
    return;
  }
  await statusAll();
});

// در دسترس قرار دادن متدهای کمکی برای برنامه
window.MizManSync = {
  sendCrmMessage: async (payload) => {
    return api('/api/crm/messages', { body: payload });
  },
  sendQrOrder: async (order) => {
    return api('/api/orders', { body: order });
  },
  api
};

setInterval(tick,3000);
setInterval(()=>{mountCards()},1000);
window.addEventListener('load',()=>setTimeout(tick,500));
})();
