'use strict';
/**
 * سرور جامع میز من (MizMan):
 * - متصل به دیتابیس PostgreSQL (با پشتیبانی از fallback محلی)
 * - ربات تلگرام و بله با کد اتصال دائمی برای هر کافه
 * - وب‌سرور فایل‌های استاتیک و REST API برای رزرو، سفارش QR، باشگاه مشتریان
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('./db');

// بارگذاری تنظیمات محیطی از .env در پوشه جاری یا پوشه والد
[path.join(__dirname, '.env'), path.join(__dirname, '..', '.env')].forEach(envFile => {
  if (fs.existsSync(envFile)) {
    for (const l of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  }
});

const S = {
  P: 'در انتظار تایید کافه',
  C: 'تایید شده',
  R: 'رد شده',
  D: 'تمام شد',
  N: 'نیامد',
  X: 'لغو شده',
  E: 'منقضی شده'
};
const NEXT = {
  [S.P]: [S.C, S.R, S.X],
  [S.C]: [S.D, S.N, S.X]
};
const ACTION = { ok: S.C, no: S.R, done: S.D, ns: S.N };
const ICON = {
  [S.P]: '⏳',
  [S.C]: '✅',
  [S.R]: '❌',
  [S.D]: '🏁',
  [S.N]: '🚫',
  [S.X]: '↩️',
  [S.E]: '⌛'
};

const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const same = (a, b) => {
  a = Buffer.from(String(a));
  b = Buffer.from(String(b));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const clean = (s, n = 150) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').trim().slice(0, n);
const toEn = s => String(s).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const mins = (t, end) => {
  const m = toEn(t).match(/(\d{1,2}):(\d{2})/g);
  if (!m) return null;
  const x = (end ? m[m.length - 1] : m[0]).split(':');
  return +x[0] * 60 + +x[1];
};
const overlap = (a, b) => mins(a) < mins(b, 1) && mins(b) < mins(a, 1);
const fmt = n => Number(n || 0).toLocaleString('fa-IR');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

async function start(opt = {}) {
  const TOKEN = process.env.BOT_TOKEN || '';
  const BASE = (process.env.BOT_API_BASE || 'https://api.telegram.org').replace(/\/$/, '');
  const PORT = opt.port ?? (+process.env.PORT || 3000);
  const ORIGIN = process.env.ALLOWED_ORIGIN || '*';
  const STATIC = path.resolve(__dirname, process.env.STATIC_DIR || '..');
  const DB_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');

  // اتصال و راه‌اندازی دیتابیس (PostgreSQL یا Fallback به data.json)
  const dbAdapter = new Database({
    databaseUrl: process.env.DATABASE_URL,
    dataFile: DB_FILE
  });
  await dbAdapter.init();
  const db = dbAdapter.memory;

  let botName = '';
  let stop = false;

  // اطمینان از وجود کد دائمی برای هر کافه
  Object.values(db.cafes).forEach(c => {
    if (!c.permanentCode) {
      c.permanentCode = 'MZ' + String(c.id).slice(-6).toUpperCase();
      dbAdapter.upsertCafe(c);
    }
  });

  /* ---------- Bot API ---------- */
  async function tg(method, params = {}, ms = 15000) {
    if (!TOKEN) return null;
    const r = await fetch(`${BASE}/bot${TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(ms)
    });
    const j = await r.json().catch(() => ({}));
    if (!j.ok && j.ok !== undefined) throw new Error(j.description || 'bot api error');
    return j.result;
  }

  const say = (chat, text, extra = {}) => tg('sendMessage', { chat_id: chat, text, ...extra }).catch(e => console.error('send', e.message));

  const body = (r, cafe) => `${r.status === S.P ? '🔔 رزرو جدید' : '📋 رزرو'} — ${cafe ? cafe.name : ''}\n👤 ${r.customerName} · 📞 ${r.phone}\n📅 ${r.day} · ⏰ ${r.time}\n🪑 ${r.table} · 👥 ${r.guestCount} نفر\n🍽 پیش‌سفارش: ${r.menu || 'ندارد'}\n💳 ${fmt(r.orderTotal)} تومان${r.coupon ? ' (کد ' + r.coupon + ')' : ''}\n🆔 ${r.code || r.id}\n\nوضعیت: ${ICON[r.status] || ''} ${r.status}`;

  const kb = r =>
    r.status === S.P
      ? [[{ text: '✅ تایید', callback_data: `a:${r.id}:ok` }, { text: '❌ رد', callback_data: `a:${r.id}:no` }]]
      : r.status === S.C
      ? [[{ text: '🏁 تمام شد (آزاد کردن میز)', callback_data: `a:${r.id}:done` }], [{ text: '🚫 نیامد', callback_data: `a:${r.id}:ns` }]]
      : [];

  async function notifyNew(r) {
    const cafe = db.cafes[r.cafeId];
    if (!cafe || !Array.isArray(cafe.chats)) return 0;
    r.msgs = r.msgs || [];
    let n = 0;
    for (const chat of cafe.chats) {
      const m = await tg('sendMessage', {
        chat_id: chat,
        text: body(r, cafe),
        reply_markup: { inline_keyboard: kb(r) }
      }).catch(e => console.error('notify', e.message));
      if (m) {
        r.msgs.push({ chat, mid: m.message_id });
        n++;
      }
    }
    await dbAdapter.upsertReservation(r);
    return n;
  }

  async function refreshMsgs(r) {
    const cafe = db.cafes[r.cafeId];
    for (const m of r.msgs || []) {
      await tg('editMessageText', {
        chat_id: m.chat,
        message_id: m.mid,
        text: body(r, cafe),
        reply_markup: { inline_keyboard: kb(r) }
      }).catch(() => {});
    }
  }

  async function setStatus(r, st) {
    r.status = st;
    r.updatedAt = Date.now();
    await dbAdapter.upsertReservation(r);
    return refreshMsgs(r);
  }

  // نوتیفیکیشن سفارش حضوری QR به ربات
  async function notifyQrOrder(o) {
    const cafe = db.cafes[o.cafeId];
    if (!cafe || !Array.isArray(cafe.chats)) return;
    const itemsText = (o.items || []).map(x => `• ${x.name} × ${x.qty} (${fmt(x.price * x.qty)} تومان)`).join('\n');
    const msg = `🧾 سفارش جدید سر میز (QR)\n☕ کافه: ${cafe.name}\n🪑 میز: ${o.table}\n👤 مشتری: ${o.customerName}${o.phone ? ' · 📞 ' + o.phone : ''}\n\nاقلام سفارش:\n${itemsText}\n\n💳 جمع کل: ${fmt(o.total)} تومان${o.note ? '\n📝 یادداشت: ' + o.note : ''}\n🆔 کد: ${o.code}`;
    for (const chat of cafe.chats) {
      await say(chat, msg);
    }
  }

  /* ---------- دریافت پیام‌ها و دستورات ربات ---------- */
  async function onUpdate(u) {
    if (u.message && u.message.text) {
      const chat = u.message.chat.id;
      const tx = u.message.text.trim();

      if (/^\/start/.test(tx)) {
        const rawParam = (tx.split(/\s+/)[1] || '').toUpperCase();
        if (!rawParam) {
          return say(
            chat,
            `سلام 👋\nبه ربات هوشمند سامانه «میز من» خوش آمدید!\nبرای اتصال ربات به کافه خود، کد دائمی کافه را از پنل کافه‌دار وارد کنید:\n/start کد_دائمی\n\nمثال: /start MZ12345`
          );
        }

        // جستجو بر اساس کد دائمی، شناسه کافه، یا کدهای موقت
        let cafe = Object.values(db.cafes).find(
          c =>
            (c.permanentCode && c.permanentCode.toUpperCase() === rawParam) ||
            String(c.id) === rawParam ||
            ('MZ' + String(c.id)).toUpperCase() === rawParam ||
            (c.codes && c.codes[rawParam] && c.codes[rawParam] > Date.now())
        );

        if (!cafe) {
          return say(chat, '❌ کد اتصال نامعتبر است. لطفاً کد اتصال دائمی کافه خود را در پنل کافه‌دار بررسی کنید.');
        }

        cafe.chats = cafe.chats || [];
        if (!cafe.chats.includes(chat)) {
          cafe.chats.push(chat);
          await dbAdapter.upsertCafe(cafe);
        }

        return say(
          chat,
          `✅ اتصال دائمی برقرار شد: «${cafe.name}»\nکد اتصال دائمی شما: ${cafe.permanentCode}\nاز این به بعد رزروهای جدید و سفارش‌های حضوری این‌جا می‌آید و می‌توانید مستقیماً تایید یا رد کنید.\n\nدستورها:\n/pending — مشاهده رزروهای در انتظار\n/unlink — قطع اتصال این چت`
        );
      }

      const mine = Object.values(db.cafes).filter(c => Array.isArray(c.chats) && c.chats.includes(chat));
      if (tx === '/unlink') {
        for (const c of mine) {
          c.chats = c.chats.filter(x => x !== chat);
          await dbAdapter.upsertCafe(c);
        }
        return say(chat, 'اتصال این چت با کافه‌ها قطع شد.');
      }

      if (tx === '/pending') {
        const ids = new Set(mine.map(c => Number(c.id)));
        const list = Object.values(db.reservations).filter(r => ids.has(Number(r.cafeId)) && r.status === S.P);
        if (!list.length) return say(chat, 'هیچ رزرو در انتظاری ندارید ✨');
        for (const r of list) {
          const m = await tg('sendMessage', {
            chat_id: chat,
            text: body(r, db.cafes[r.cafeId]),
            reply_markup: { inline_keyboard: kb(r) }
          }).catch(() => null);
          if (m) {
            (r.msgs = r.msgs || []).push({ chat, mid: m.message_id });
          }
        }
        return;
      }

      return say(chat, 'دستورها: /pending برای رزروهای در انتظار · /unlink برای قطع اتصال');
    }

    if (u.callback_query) {
      const q = u.callback_query;
      const chat = q.message && q.message.chat.id;
      const [, id, act] = String(q.data || '').split(':');
      const ans = (text, alert) => tg('answerCallbackQuery', { callback_query_id: q.id, text, show_alert: !!alert }).catch(() => {});
      const r = db.reservations[id];
      const cafe = r && db.cafes[r.cafeId];
      if (!r || !cafe || !cafe.chats.includes(chat)) return ans('دسترسی ندارید یا رزرو پیدا نشد.', true);
      const to = ACTION[act];
      if (!to || !(NEXT[r.status] || []).includes(to)) {
        ans('این رزرو دیگر قابل تغییر نیست (' + r.status + ').', true);
        return refreshMsgs(r);
      }
      await setStatus(r, to);
      return ans('ثبت شد ' + (ICON[to] || ''));
    }
  }

  async function poll() {
    if (!TOKEN) return;
    try {
      const me = await tg('getMe');
      botName = (me && me.username) || '';
      console.log('🤖 ربات تلگرام متصل شد: @' + (botName || 'بدون_نام'));
    } catch (e) {
      console.error('getMe error:', e.message);
    }
    while (!stop) {
      try {
        const ups = (await tg('getUpdates', { offset: db.offset, timeout: 20 }, 30000)) || [];
        for (const u of ups) {
          db.offset = u.update_id + 1;
          await onUpdate(u).catch(e => console.error('update error:', e.message));
        }
      } catch (e) {
        if (!stop) {
          console.error('poll error:', e.message);
          await sleep(4000);
        }
      }
    }
  }

  /* ---------- انقضای خودکار نوبت‌ها ---------- */
  async function sweep(now = Date.now()) {
    let n = 0;
    for (const r of Object.values(db.reservations)) {
      if (!r.dateISO || ![S.P, S.C].includes(r.status)) continue;
      const e = mins(r.time, 1);
      if (e == null) continue;
      const end = new Date(r.dateISO + 'T00:00:00');
      end.setMinutes(e);
      if (end.getTime() <= now) {
        await setStatus(r, r.status === S.P ? S.E : S.D);
        n++;
      }
    }
    return n;
  }

  /* ---------- هندلر درخواست‌های HTTP / REST API ---------- */
  const hits = new Map();
  const limited = (ip, max) => {
    const k = ip + Math.floor(Date.now() / 60000);
    const n = (hits.get(k) || 0) + 1;
    hits.set(k, n);
    if (hits.size > 5000) hits.clear();
    return n > max;
  };
  const pub = r => {
    const { tokenHash, msgs, ...p } = r;
    return p;
  };
  const json = (res, code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };
  const readBody = req =>
    new Promise((ok, no) => {
      let d = '';
      req.on('data', c => {
        d += c;
        if (d.length > 5e5) {
          no(new Error('Payload too large'));
          req.destroy();
        }
      });
      req.on('end', () => {
        try {
          ok(d ? JSON.parse(d) : {});
        } catch (e) {
          no(e);
        }
      });
    });

  const authCafe = (id, key) => {
    const c = db.cafes[id];
    return c && key && same(c.keyHash, sha(key)) ? c : null;
  };

  async function api(req, res, url) {
    const ip = req.socket.remoteAddress;
    const p = url.pathname;
    const m = req.method;

    // ۱. بررسی سلامت و وضعیت دیتابیس
    if (m === 'GET' && p === '/api/health') {
      return json(res, 200, {
        ok: true,
        bot: !!TOKEN,
        botName,
        database: dbAdapter.getDbStatus()
      });
    }

    if (m === 'GET' && p === '/api/db/status') {
      return json(res, 200, dbAdapter.getDbStatus());
    }

    if (limited(ip, m === 'POST' ? 120 : 300)) {
      return json(res, 429, { error: 'تعداد درخواست‌ها بیش از حد مجاز است' });
    }

    let b = {};
    if (m === 'POST' || m === 'PUT') {
      try {
        b = await readBody(req);
      } catch (e) {
        return json(res, 400, { error: 'داده ارسالی نامعتبر است' });
      }
    }

    const key = req.headers['x-key'] || '';
    let g;

    // ۲. دریافت لیست کافه‌ها
    if (m === 'GET' && p === '/api/cafes') {
      const list = Object.values(db.cafes).map(c => ({
        id: c.id,
        name: c.name,
        category: c.category || 'cafe',
        rating: c.rating || '۵.۰',
        reviewsCount: c.reviewsCount || 0,
        image: c.image || '',
        address: c.address || '',
        phone: c.phone || '',
        instagram: c.instagram || '',
        desc: c.desc || '',
        tables: c.tables || [],
        menu: c.menu || [],
        expenses: c.expenses || [],
        permanentCode: c.permanentCode
      }));
      return json(res, 200, list);
    }

    // ۳. ثبت کافه جدید
    if (m === 'POST' && p === '/api/cafes') {
      const id = Number(b.id) || Date.now();
      if (!Number.isInteger(id) || id <= 0) return json(res, 400, { error: 'شناسه کافه نامعتبر است' });
      if (db.cafes[id]) return json(res, 409, { error: 'این کافه قبلاً ثبت شده است' });

      const k = crypto.randomBytes(18).toString('hex');
      const permCode = 'MZ' + String(id).slice(-6).toUpperCase();
      const cafeObj = {
        id,
        name: clean(b.name, 100) || 'کافه ' + id,
        category: clean(b.category, 50) || 'cafe',
        rating: clean(b.rating, 10) || '۵.۰',
        reviewsCount: 1,
        image: b.image || 'https://images.unsplash.com/photo-1554118811-1e0d58224f24?auto=format&fit=crop&w=600&q=80',
        address: clean(b.address, 250) || 'تهران',
        phone: clean(b.phone, 30) || '',
        instagram: clean(b.instagram, 60).replace(/^@/, '') || '',
        desc: clean(b.desc, 300) || 'کافه‌ای دنج در سامانه میز من',
        tables: Array.isArray(b.tables) ? b.tables : [{ id: 1, title: 'میز ۱ اصلی', feature: 'کنار پنجره' }],
        menu: Array.isArray(b.menu) ? b.menu : [{ name: 'قهوه اسپرسو', price: '۶۰,۰۰۰ تومان' }],
        expenses: Array.isArray(b.expenses) ? b.expenses : [],
        keyHash: sha(k),
        chats: [],
        codes: {},
        permanentCode: permCode
      };

      await dbAdapter.upsertCafe(cafeObj);
      return json(res, 200, {
        ok: true,
        key: k,
        permanentCode: permCode,
        botLink: botName ? `https://t.me/${botName}?start=${permCode}` : ''
      });
    }

    // ۴. ویرایش اطلاعات کافه
    if ((m === 'POST' || m === 'PUT') && (g = p.match(/^\/api\/cafes\/(\d+)\/update$/))) {
      const c = authCafe(g[1], key);
      if (!c) return json(res, 403, { error: 'کلید احراز هویت کافه نامعتبر است' });
      if (b.name) c.name = clean(b.name, 100);
      if (b.category) c.category = clean(b.category, 50);
      if (b.address) c.address = clean(b.address, 250);
      if (b.phone !== undefined) c.phone = clean(b.phone, 30);
      if (b.instagram !== undefined) c.instagram = clean(b.instagram, 60).replace(/^@/, '');
      if (b.desc) c.desc = clean(b.desc, 400);
      if (Array.isArray(b.tables)) c.tables = b.tables;
      if (Array.isArray(b.menu)) c.menu = b.menu;
      if (Array.isArray(b.expenses)) c.expenses = b.expenses;

      await dbAdapter.upsertCafe(c);
      return json(res, 200, { ok: true, cafe: c });
    }

    // ۵. کد دائمی اتصال ربات تلگرام
    if ((g = p.match(/^\/api\/cafes\/(\d+)\/link$/))) {
      const c = authCafe(g[1], key);
      if (!c || m !== 'POST') return json(res, 403, { error: 'دسترسی غیرمجاز' });
      if (!c.permanentCode) {
        c.permanentCode = 'MZ' + String(c.id).slice(-6).toUpperCase();
        await dbAdapter.upsertCafe(c);
      }
      return json(res, 200, {
        code: c.permanentCode,
        isPermanent: true,
        botName,
        botLink: botName ? `https://t.me/${botName}?start=${c.permanentCode}` : '',
        botEnabled: !!TOKEN
      });
    }

    // ۶. وضعیت اتصال ربات برای کافه
    if (m === 'GET' && (g = p.match(/^\/api\/cafes\/(\d+)\/bot$/))) {
      const c = authCafe(g[1], key);
      if (!c) return json(res, 403, { error: 'دسترسی غیرمجاز' });
      return json(res, 200, {
        connected: Array.isArray(c.chats) ? c.chats.length : 0,
        permanentCode: c.permanentCode,
        botName,
        botLink: botName && c.permanentCode ? `https://t.me/${botName}?start=${c.permanentCode}` : '',
        botEnabled: !!TOKEN
      });
    }

    // ۷. دریافت رزروها به تفکیک تاریخ و کافه
    if (m === 'GET' && p === '/api/reservations') {
      const cafeId = Number(url.searchParams.get('cafeId'));
      const date = url.searchParams.get('date');
      let list = Object.values(db.reservations);
      if (cafeId) list = list.filter(r => Number(r.cafeId) === cafeId);
      if (date) list = list.filter(r => r.dateISO === date || r.day.includes(date));
      return json(res, 200, list.map(pub).sort((a, b) => b.id - a.id));
    }

    // ۸. ثبت رزرو جدید
    if (m === 'POST' && p === '/api/reservations') {
      const id = Number(b.id) || Date.now();
      const cafeId = Number(b.cafeId);
      const phone = toEn(clean(b.phone, 20));
      const time = clean(b.time, 40);
      const day = clean(b.day, 60);
      const table = clean(b.table, 80);
      const guests = Number(b.guestCount) || 2;

      if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(cafeId) || cafeId <= 0 || !/^09\d{9}$/.test(phone) || !day || !table) {
        return json(res, 400, { error: 'اطلاعات رزرو ناقص یا نامعتبر است' });
      }

      if (db.reservations[id]) return json(res, 409, { error: 'dup' });

      // بررسی تداخل رزرو
      const clash = Object.values(db.reservations).some(
        r => r.cafeId === cafeId && r.table === table && r.day === day && [S.P, S.C].includes(r.status) && overlap(r.time, time)
      );
      if (clash) return json(res, 409, { error: 'این میز در این بازه زمانی قبلاً رزرو شده است' });

      const tok = crypto.randomBytes(16).toString('hex');
      const r = {
        id,
        cafeId,
        cafe: clean(b.cafe, 100),
        code: clean(b.code, 20) || 'MZ-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
        customerName: clean(b.customerName, 60),
        phone,
        day,
        time,
        table,
        guestCount: guests,
        menu: clean(b.menu, 300) || 'بدون پیش‌سفارش',
        orderTotal: Math.max(0, Math.min(1e9, Number(b.orderTotal) || 0)),
        coupon: clean(b.coupon, 20),
        discount: Math.max(0, Number(b.discount) || 0),
        dateISO: /^\d{4}-\d{2}-\d{2}$/.test(b.dateISO || '') ? b.dateISO : '',
        status: S.P,
        createdAt: new Date().toISOString(),
        tokenHash: sha(tok),
        msgs: []
      };

      await dbAdapter.upsertReservation(r);
      const n = await notifyNew(r);
      return json(res, 200, { ok: true, token: tok, status: r.status, botNotified: n, code: r.code });
    }

    // ۹. تغییر وضعیت رزرو
    if (m === 'POST' && (g = p.match(/^\/api\/reservations\/(\d+)\/status$/))) {
      const r = db.reservations[g[1]];
      if (!r || !authCafe(r.cafeId, key)) return json(res, 403, { error: 'دسترسی غیرمجاز' });
      const to = String(b.status || '');
      if (!(NEXT[r.status] || []).includes(to)) {
        return json(res, 400, { error: 'تغییر وضعیت از «' + r.status + '» به «' + to + '» مجاز نیست' });
      }
      await setStatus(r, to);
      return json(res, 200, { ok: true, status: r.status });
    }

    // ۱۰. لغو رزرو توسط مشتری
    if (m === 'POST' && (g = p.match(/^\/api\/reservations\/(\d+)\/cancel$/))) {
      const r = db.reservations[g[1]];
      if (!r || !same(r.tokenHash, sha(b.token || ''))) return json(res, 403, { error: 'دسترسی غیرمجاز' });
      if (!(NEXT[r.status] || []).includes(S.X)) return json(res, 400, { error: 'این رزرو دیگر قابل لغو نیست' });
      await setStatus(r, S.X);
      return json(res, 200, { ok: true, status: r.status });
    }

    // ۱۱. سفارش‌های حضوری با QR
    if (m === 'POST' && p === '/api/orders') {
      const cafeId = Number(b.cafeId);
      const cafe = db.cafes[cafeId];
      if (!cafe) return json(res, 404, { error: 'کافه مورد نظر یافت نشد' });

      const table = clean(b.table, 80);
      // بررسی انتخاب میز صرفاً از میان میزهای ثبت‌شده کافه
      const validTables = (cafe.tables || []).map(t => t.title.trim());
      if (validTables.length && !validTables.includes(table)) {
        return json(res, 400, { error: 'لطفاً میز را از لیست میزهای معتبر این کافه انتخاب کنید' });
      }

      const o = {
        id: 'O' + Date.now(),
        code: 'QR-' + Math.random().toString(36).slice(2, 7).toUpperCase(),
        cafeId,
        cafeName: cafe.name,
        table,
        customerName: clean(b.customerName, 60) || 'مهمان',
        phone: toEn(clean(b.phone, 20)),
        items: Array.isArray(b.items) ? b.items : [],
        total: Number(b.total) || 0,
        note: clean(b.note, 200),
        status: 'جدید',
        createdAt: new Date().toISOString()
      };

      await dbAdapter.upsertQrOrder(o);
      await notifyQrOrder(o);
      return json(res, 200, { ok: true, order: o });
    }

    if (m === 'GET' && p === '/api/orders') {
      const cafeId = Number(url.searchParams.get('cafeId'));
      let list = Object.values(db.qrOrders);
      if (cafeId) list = list.filter(o => Number(o.cafeId) === cafeId);
      return json(res, 200, list.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1)));
    }

    if (m === 'POST' && (g = p.match(/^\/api\/orders\/([A-Za-z0-9_-]+)\/status$/))) {
      const o = db.qrOrders[g[1]];
      if (!o || !authCafe(o.cafeId, key)) return json(res, 403, { error: 'دسترسی غیرمجاز' });
      o.status = clean(b.status, 50) || o.status;
      await dbAdapter.upsertQrOrder(o);
      return json(res, 200, { ok: true, status: o.status });
    }

    // ۱۲. پیام‌های باشگاه مشتریان و CRM
    if (m === 'POST' && p === '/api/crm/messages') {
      const cafeId = Number(b.cafeId);
      const cafe = db.cafes[cafeId];
      if (!cafe || !authCafe(cafeId, key)) return json(res, 403, { error: 'دسترسی غیرمجاز' });

      const msg = {
        id: 'CRM' + Date.now(),
        cafeId,
        cafeName: cafe.name,
        phone: clean(b.phone, 20),
        customerName: clean(b.customerName, 60) || 'مشتری وفادار',
        title: clean(b.title, 100) || 'پیشنهاد ویژه کافه',
        message: clean(b.message, 500),
        discountPercent: Number(b.discountPercent) || 0,
        createdAt: new Date().toISOString()
      };

      await dbAdapter.insertCrmMessage(msg);
      return json(res, 200, { ok: true, message: msg });
    }

    if (m === 'GET' && p === '/api/crm/messages') {
      const phone = clean(url.searchParams.get('phone'), 20);
      const cafeId = Number(url.searchParams.get('cafeId'));
      let list = db.crmMessages || [];
      if (cafeId) list = list.filter(m => Number(m.cafeId) === cafeId);
      if (phone) list = list.filter(m => m.phone === phone);
      return json(res, 200, list);
    }

    // ۱۳. همگام‌سازی کلاینت با سرور
    if (m === 'POST' && p === '/api/sync') {
      const out = new Map();
      for (const c of (b.cafes || []).slice(0, 10)) {
        if (authCafe(c.id, c.key)) {
          Object.values(db.reservations)
            .filter(r => r.cafeId === Number(c.id))
            .forEach(r => out.set(r.id, pub(r)));
        }
      }
      for (const t of (b.tokens || []).slice(0, 300)) {
        const r = db.reservations[t.id];
        if (r && same(r.tokenHash, sha(t.t || ''))) {
          out.set(r.id, pub(r));
        }
      }
      return json(res, 200, {
        reservations: [...out.values()].sort((a, b) => b.id - a.id).slice(0, 500)
      });
    }

    return json(res, 404, { error: 'یافت نشد' });
  }

  /* ---------- سرو فایل‌های استاتیک وب ---------- */
  function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(STATIC, '.' + rel);
    const seg = path.relative(STATIC, file).split(path.sep);

    if (
      !file.startsWith(STATIC + path.sep) ||
      seg.some(s => s.startsWith('.') || s === 'node_modules' || s === path.basename(__dirname)) ||
      !MIME[path.extname(file)]
    ) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('صفحه یا فایل مورد نظر پیدا نشد.');
    }

    fs.readFile(file, (e, d) => {
      if (e) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('صفحه یا فایل مورد نظر پیدا نشد.');
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'text/plain; charset=utf-8',
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(d);
    });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
      if (ORIGIN) {
        res.setHeader('Access-Control-Allow-Origin', ORIGIN);
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-key');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          return res.end();
        }
      }
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      serveStatic(req, res, url);
    } catch (e) {
      console.error('server handler error:', e);
      if (!res.headersSent) json(res, 500, { error: 'خطای داخلی سرور' });
    }
  });

  const sweeper = setInterval(() => sweep(), 30000);

  return new Promise(ok =>
    server.listen(PORT, () => {
      const port = server.address().port;
      console.log(`🚀 سامانه میز من با موفقیت روی http://localhost:${port} آماده به کار است.`);
      console.log(`📊 وضعیت دیتابیس: ${dbAdapter.isPg ? 'PostgreSQL فعال است' : 'فایل محلی data.json فعال است'}`);
      if (!TOKEN) console.log('⚠️ ربات تلگرام غیرفعال است (BOT_TOKEN تنظیم نشده است).');
      poll();
      ok({
        server,
        port,
        dbAdapter,
        db,
        sweep,
        close() {
          stop = true;
          clearInterval(sweeper);
          server.close();
        }
      });
    })
  );
}

module.exports = { start };
if (require.main === module) start();
