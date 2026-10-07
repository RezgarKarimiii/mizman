'use strict';
/**
 * ماژول پایگاه داده PostgreSQL و همگام‌سازی داده‌ها (MizMan DB Adapter)
 * پشتیبانی کامل از PostgreSQL با قابلیت Fallback به فایل JSON محلی
 */
const fs = require('fs');
const path = require('path');

let pg = null;
try {
  pg = require('pg');
} catch (e) {
  // pg module not found
}

class Database {
  constructor(options = {}) {
    this.databaseUrl = options.databaseUrl || process.env.DATABASE_URL || '';
    this.dataFile = options.dataFile || path.join(__dirname, 'data.json');
    this.pool = null;
    this.isPg = false;
    this.memory = {
      cafes: {},
      reservations: {},
      qrOrders: {},
      crmMessages: [],
      staff: [],
      attendance: [],
      offset: 0
    };
    this.saveTimer = null;
  }

  async init() {
    // ۱. خواندن فایل محلی در حافظه به عنوان کش پایه
    this.loadJson();

    // ۲. بررسی امکان اتصال به PostgreSQL
    if (this.databaseUrl && pg) {
      try {
        console.log('🔄 در حال اتصال به PostgreSQL...');
        const isSsl = !/localhost|127\.0\.0\.1/.test(this.databaseUrl);
        this.pool = new pg.Pool({
          connectionString: this.databaseUrl,
          ssl: isSsl ? { rejectUnauthorized: false } : false,
          max: 10,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000
        });

        // تست اتصال
        const client = await this.pool.connect();
        await client.query('SELECT 1');
        client.release();

        this.isPg = true;
        console.log('✅ اتصال به دیتابیس PostgreSQL با موفقیت برقرار شد.');

        // ساخت خودکار جدول‌ها
        await this.createTables();

        // همگام‌سازی اولیه از دیتابیس به حافظه
        await this.loadFromPg();
        return;
      } catch (err) {
        console.warn('⚠️ اتصال به PostgreSQL برقرار نشد؛ از دیتابیس محلی (data.json) استفاده می‌شود:', err.message);
        this.isPg = false;
        if (this.pool) {
          try { await this.pool.end(); } catch (_) {}
          this.pool = null;
        }
      }
    } else {
      console.log('ℹ️ DATABASE_URL تنظیم نشده است؛ ذخیره‌سازی روی data.json فعال است.');
    }
  }

  loadJson() {
    try {
      if (fs.existsSync(this.dataFile)) {
        const raw = fs.readFileSync(this.dataFile, 'utf8');
        const parsed = JSON.parse(raw);
        this.memory.cafes = parsed.cafes || {};
        this.memory.reservations = parsed.reservations || {};
        this.memory.qrOrders = parsed.qrOrders || {};
        this.memory.crmMessages = parsed.crmMessages || [];
        this.memory.staff = parsed.staff || [];
        this.memory.attendance = parsed.attendance || [];
        this.memory.offset = parsed.offset || 0;
      }
    } catch (e) {
      console.error('خطا در خواندن data.json:', e.message);
    }
  }

  async flushJson() {
    try {
      const tmp = this.dataFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.memory, null, 2), 'utf8');
      fs.renameSync(tmp, this.dataFile);
    } catch (e) {
      console.error('خطا در ذخیره data.json:', e.message);
    }
  }

  debounceSaveJson() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushJson(), 200);
  }

  async createTables() {
    if (!this.isPg || !this.pool) return;
    const sql = `
      CREATE TABLE IF NOT EXISTS cafes (
        id BIGINT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(100) DEFAULT 'cafe',
        rating VARCHAR(20) DEFAULT '۵.۰',
        reviews_count INT DEFAULT 0,
        image TEXT,
        address TEXT,
        phone VARCHAR(50),
        instagram VARCHAR(100),
        description TEXT,
        tables_json JSONB DEFAULT '[]'::jsonb,
        menu_json JSONB DEFAULT '[]'::jsonb,
        expenses_json JSONB DEFAULT '[]'::jsonb,
        key_hash VARCHAR(128),
        chats_json JSONB DEFAULT '[]'::jsonb,
        permanent_code VARCHAR(50),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS reservations (
        id BIGINT PRIMARY KEY,
        cafe_id BIGINT,
        cafe_name VARCHAR(255),
        code VARCHAR(50) NOT NULL,
        customer_name VARCHAR(255) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        day VARCHAR(100) NOT NULL,
        time VARCHAR(100) NOT NULL,
        date_iso VARCHAR(50),
        table_name VARCHAR(100) NOT NULL,
        guest_count INT DEFAULT 2,
        menu TEXT DEFAULT 'بدون پیش‌سفارش',
        order_total BIGINT DEFAULT 0,
        coupon VARCHAR(50),
        discount BIGINT DEFAULT 0,
        status VARCHAR(100) DEFAULT 'در انتظار تایید کافه',
        token_hash VARCHAR(128),
        msgs_json JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS qr_orders (
        id VARCHAR(100) PRIMARY KEY,
        code VARCHAR(50) NOT NULL,
        cafe_id BIGINT,
        cafe_name VARCHAR(255),
        table_name VARCHAR(100) NOT NULL,
        customer_name VARCHAR(255) DEFAULT 'مهمان',
        phone VARCHAR(50),
        items_json JSONB DEFAULT '[]'::jsonb,
        total BIGINT DEFAULT 0,
        note TEXT,
        status VARCHAR(100) DEFAULT 'جدید',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS crm_messages (
        id VARCHAR(100) PRIMARY KEY,
        cafe_id BIGINT,
        cafe_name VARCHAR(255),
        phone VARCHAR(50),
        customer_name VARCHAR(255),
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        discount_percent INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS staff (
        id VARCHAR(100) PRIMARY KEY,
        cafe_id BIGINT,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        dept VARCHAR(100) DEFAULT 'سالن',
        title VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS attendance (
        id SERIAL PRIMARY KEY,
        staff_id VARCHAR(100),
        date VARCHAR(50) NOT NULL,
        time_in VARCHAR(20),
        time_out VARCHAR(20),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;
    await this.pool.query(sql);
    console.log('✅ ساختار جداول PostgreSQL آماده و تأیید شد.');
  }

  async loadFromPg() {
    if (!this.isPg || !this.pool) return;
    try {
      // کافه‌ها
      const cafesRes = await this.pool.query('SELECT * FROM cafes');
      for (const row of cafesRes.rows) {
        const id = Number(row.id);
        this.memory.cafes[id] = {
          id,
          name: row.name,
          category: row.category,
          rating: row.rating,
          reviewsCount: row.reviews_count,
          image: row.image,
          address: row.address,
          phone: row.phone,
          instagram: row.instagram,
          desc: row.description,
          tables: row.tables_json || [],
          menu: row.menu_json || [],
          expenses: row.expenses_json || [],
          keyHash: row.key_hash,
          chats: row.chats_json || [],
          permanentCode: row.permanent_code,
          codes: {}
        };
      }

      // رزروها
      const resRes = await this.pool.query('SELECT * FROM reservations');
      for (const row of resRes.rows) {
        const id = Number(row.id);
        this.memory.reservations[id] = {
          id,
          cafeId: Number(row.cafe_id),
          cafe: row.cafe_name,
          code: row.code,
          customerName: row.customer_name,
          phone: row.phone,
          day: row.day,
          time: row.time,
          dateISO: row.date_iso || '',
          table: row.table_name,
          guestCount: Number(row.guest_count),
          menu: row.menu,
          orderTotal: Number(row.order_total),
          coupon: row.coupon || '',
          discount: Number(row.discount),
          status: row.status,
          tokenHash: row.token_hash,
          msgs: row.msgs_json || [],
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString()
        };
      }

      // سفارش‌های QR
      const ordersRes = await this.pool.query('SELECT * FROM qr_orders');
      for (const row of ordersRes.rows) {
        this.memory.qrOrders[row.id] = {
          id: row.id,
          code: row.code,
          cafeId: Number(row.cafe_id),
          cafeName: row.cafe_name,
          table: row.table_name,
          customerName: row.customer_name,
          phone: row.phone,
          items: row.items_json || [],
          total: Number(row.total),
          note: row.note,
          status: row.status,
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString()
        };
      }

      // پیام‌های CRM
      const crmRes = await this.pool.query('SELECT * FROM crm_messages ORDER BY created_at DESC');
      this.memory.crmMessages = crmRes.rows.map(r => ({
        id: r.id,
        cafeId: Number(r.cafe_id),
        cafeName: r.cafe_name,
        phone: r.phone,
        customerName: r.customer_name,
        title: r.title,
        message: r.message,
        discountPercent: Number(r.discount_percent || 0),
        createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString()
      }));

      console.log(`📊 بارگذاری از PostgreSQL: ${Object.keys(this.memory.cafes).length} کافه، ${Object.keys(this.memory.reservations).length} رزرو`);
    } catch (e) {
      console.error('خطا در بارگذاری اولیه از PostgreSQL:', e.message);
    }
  }

  // ذخیره یا بروزرسانی کافه
  async upsertCafe(cafe) {
    this.memory.cafes[cafe.id] = cafe;
    this.debounceSaveJson();

    if (this.isPg && this.pool) {
      try {
        const query = `
          INSERT INTO cafes (id, name, category, rating, reviews_count, image, address, phone, instagram, description, tables_json, menu_json, expenses_json, key_hash, chats_json, permanent_code, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            category = EXCLUDED.category,
            rating = EXCLUDED.rating,
            reviews_count = EXCLUDED.reviews_count,
            image = EXCLUDED.image,
            address = EXCLUDED.address,
            phone = EXCLUDED.phone,
            instagram = EXCLUDED.instagram,
            description = EXCLUDED.description,
            tables_json = EXCLUDED.tables_json,
            menu_json = EXCLUDED.menu_json,
            expenses_json = EXCLUDED.expenses_json,
            key_hash = COALESCE(EXCLUDED.key_hash, cafes.key_hash),
            chats_json = EXCLUDED.chats_json,
            permanent_code = COALESCE(EXCLUDED.permanent_code, cafes.permanent_code),
            updated_at = NOW();
        `;
        await this.pool.query(query, [
          cafe.id,
          cafe.name || '',
          cafe.category || 'cafe',
          cafe.rating || '۵.۰',
          cafe.reviewsCount || 0,
          cafe.image || '',
          cafe.address || '',
          cafe.phone || '',
          cafe.instagram || '',
          cafe.desc || '',
          JSON.stringify(cafe.tables || []),
          JSON.stringify(cafe.menu || []),
          JSON.stringify(cafe.expenses || []),
          cafe.keyHash || null,
          JSON.stringify(cafe.chats || []),
          cafe.permanentCode || null
        ]);
      } catch (e) {
        console.error('خطای ثبت کافه در PostgreSQL:', e.message);
      }
    }
  }

  // ذخیره یا بروزرسانی رزرو
  async upsertReservation(r) {
    this.memory.reservations[r.id] = r;
    this.debounceSaveJson();

    if (this.isPg && this.pool) {
      try {
        const query = `
          INSERT INTO reservations (id, cafe_id, cafe_name, code, customer_name, phone, day, time, date_iso, table_name, guest_count, menu, order_total, coupon, discount, status, token_hash, msgs_json, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW())
          ON CONFLICT (id) DO UPDATE SET
            status = EXCLUDED.status,
            msgs_json = EXCLUDED.msgs_json,
            updated_at = NOW();
        `;
        await this.pool.query(query, [
          r.id,
          r.cafeId,
          r.cafe || '',
          r.code || '',
          r.customerName || '',
          r.phone || '',
          r.day || '',
          r.time || '',
          r.dateISO || '',
          r.table || '',
          r.guestCount || 2,
          r.menu || 'بدون پیش‌سفارش',
          r.orderTotal || 0,
          r.coupon || '',
          r.discount || 0,
          r.status || 'در انتظار تایید کافه',
          r.tokenHash || '',
          JSON.stringify(r.msgs || [])
        ]);
      } catch (e) {
        console.error('خطای ثبت رزرو در PostgreSQL:', e.message);
      }
    }
  }

  // ذخیره سفارش QR
  async upsertQrOrder(o) {
    this.memory.qrOrders[o.id] = o;
    this.debounceSaveJson();

    if (this.isPg && this.pool) {
      try {
        const query = `
          INSERT INTO qr_orders (id, code, cafe_id, cafe_name, table_name, customer_name, phone, items_json, total, note, status, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
          ON CONFLICT (id) DO UPDATE SET
            status = EXCLUDED.status,
            updated_at = NOW();
        `;
        await this.pool.query(query, [
          o.id,
          o.code || '',
          o.cafeId,
          o.cafeName || '',
          o.table || '',
          o.customerName || 'مهمان',
          o.phone || '',
          JSON.stringify(o.items || []),
          o.total || 0,
          o.note || '',
          o.status || 'جدید'
        ]);
      } catch (e) {
        console.error('خطای ثبت سفارش QR در PostgreSQL:', e.message);
      }
    }
  }

  // ذخیره پیام CRM
  async insertCrmMessage(m) {
    this.memory.crmMessages.unshift(m);
    this.debounceSaveJson();

    if (this.isPg && this.pool) {
      try {
        const query = `
          INSERT INTO crm_messages (id, cafe_id, cafe_name, phone, customer_name, title, message, discount_percent, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW());
        `;
        await this.pool.query(query, [
          m.id,
          m.cafeId,
          m.cafeName || '',
          m.phone || '',
          m.customerName || '',
          m.title,
          m.message,
          m.discountPercent || 0
        ]);
      } catch (e) {
        console.error('خطای ثبت پیام CRM در PostgreSQL:', e.message);
      }
    }
  }

  getDbStatus() {
    return {
      connected: this.isPg,
      driver: this.isPg ? 'PostgreSQL' : 'JSON File (data.json)',
      databaseUrlProvided: !!this.databaseUrl,
      cafesCount: Object.keys(this.memory.cafes).length,
      reservationsCount: Object.keys(this.memory.reservations).length,
      qrOrdersCount: Object.keys(this.memory.qrOrders).length,
      crmMessagesCount: this.memory.crmMessages.length
    };
  }
}

module.exports = Database;
