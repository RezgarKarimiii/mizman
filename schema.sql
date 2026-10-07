-- =======================================================
-- میز من (MizMan) - اسکریپت ساخت دیتابیس PostgreSQL
-- سازگار با PostgreSQL 13+ و سرویس‌های Neon, Supabase, Railway
-- =======================================================

-- فعال‌سازی افزونه UUID در صورت نیاز
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ۱. جدول کافه‌ها
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
    permanent_code VARCHAR(50) UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ایندکس برای جستجوی سریع کافه‌ها
CREATE INDEX IF NOT EXISTS idx_cafes_category ON cafes(category);
CREATE INDEX IF NOT EXISTS idx_cafes_permanent_code ON cafes(permanent_code);

-- ۲. جدول رزروها
CREATE TABLE IF NOT EXISTS reservations (
    id BIGINT PRIMARY KEY,
    cafe_id BIGINT REFERENCES cafes(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_reservations_cafe_id ON reservations(cafe_id);
CREATE INDEX IF NOT EXISTS idx_reservations_phone ON reservations(phone);
CREATE INDEX IF NOT EXISTS idx_reservations_date_iso ON reservations(date_iso);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);

-- ۳. جدول سفارش‌های حضوری با QR
CREATE TABLE IF NOT EXISTS qr_orders (
    id VARCHAR(100) PRIMARY KEY,
    code VARCHAR(50) NOT NULL,
    cafe_id BIGINT REFERENCES cafes(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_qr_orders_cafe_id ON qr_orders(cafe_id);
CREATE INDEX IF NOT EXISTS idx_qr_orders_status ON qr_orders(status);

-- ۴. جدول پیام‌ها و پیشنهادهای باشگاه مشتریان (CRM)
CREATE TABLE IF NOT EXISTS crm_messages (
    id VARCHAR(100) PRIMARY KEY,
    cafe_id BIGINT REFERENCES cafes(id) ON DELETE CASCADE,
    cafe_name VARCHAR(255),
    phone VARCHAR(50),
    customer_name VARCHAR(255),
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    discount_percent INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_messages_cafe_id ON crm_messages(cafe_id);
CREATE INDEX IF NOT EXISTS idx_crm_messages_phone ON crm_messages(phone);

-- ۵. جدول کارکنان
CREATE TABLE IF NOT EXISTS staff (
    id VARCHAR(100) PRIMARY KEY,
    cafe_id BIGINT REFERENCES cafes(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    dept VARCHAR(100) DEFAULT 'سالن',
    title VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_cafe_id ON staff(cafe_id);

-- ۶. جدول حضور و غیاب کارکنان
CREATE TABLE IF NOT EXISTS attendance (
    id SERIAL PRIMARY KEY,
    staff_id VARCHAR(100) REFERENCES staff(id) ON DELETE CASCADE,
    date VARCHAR(50) NOT NULL,
    time_in VARCHAR(20),
    time_out VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(staff_id, date)
);

-- ۷. جدول کاربران سامانه (مشتری، کافه‌دار، ادمین)
CREATE TABLE IF NOT EXISTS app_users (
    id VARCHAR(100) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255),
    password_hash TEXT NOT NULL,
    role VARCHAR(50) DEFAULT 'CUSTOMER',
    cafe_id BIGINT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_users_phone ON app_users(phone);
CREATE INDEX IF NOT EXISTS idx_app_users_role ON app_users(role);

-- داده‌های اولیه کافه‌ها در صورت خالی بودن جدول
INSERT INTO cafes (id, name, category, rating, reviews_count, image, address, phone, instagram, description, tables_json, menu_json, permanent_code)
VALUES 
(
    1, 
    'کافه هنر (شعبه ونک)', 
    'cafe', 
    '۴.۹', 
    128, 
    'https://images.unsplash.com/photo-1554118811-1e0d58224f24?auto=format&fit=crop&w=600&q=80',
    'تهران، میدان ونک، خیابان ملاصدرا', 
    '02188776655', 
    'honar_cafe', 
    'محیطی دنج و آرام مناسب قرار کاری و دوستانه با برترین دانه‌های قهوه.',
    '[{"id":1,"title":"میز ۱ (کنار پنجره)","feature":"کنار پنجره"},{"id":2,"title":"میز ۲ (پریز برق لپ‌تاپ)","feature":"دارای پریز برق"},{"id":3,"title":"میز ۳ (گوشه دنج)","feature":"گوشه دنج"}]'::jsonb,
    '[{"name":"کافه لاته تخصصی","price":"۸۵,۰۰۰ تومان"},{"name":"کیک شکلاتی بلژیکی","price":"۱۱۰,۰۰۰ تومان"},{"name":"پیتزا اسلایسی مخصوص","price":"۲۲۰,۰۰۰ تومان"}]'::jsonb,
    'MZ-HONAR1'
),
(
    2, 
    'رستوران و کافه لوتوس', 
    'restaurant', 
    '۴.۸', 
    94, 
    'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&w=600&q=80',
    'تهران، جردن، بالاتر از اسفندیار', 
    '02122001122', 
    'lotus_restaurant', 
    'منوی کامل فرنگی و ایرانی با موزیک زنده و فضای مجلل.',
    '[{"id":1,"title":"میز VIP آکواریوم","feature":"ویژه"},{"id":2,"title":"میز ۲ نفره بالکن","feature":"بالکن"}]'::jsonb,
    '[{"name":"استیک گوشت گوساله","price":"۴۸۰,۰۰۰ تومان"},{"name":"سالاد سزار با مرغ گریل","price":"۱۹۰,۰۰۰ تومان"}]'::jsonb,
    'MZ-LOTUS2'
),
(
    3, 
    'کافه وای‌‌فای (مخصوص دورکاران)', 
    'remote', 
    '۴.۹', 
    210, 
    'https://images.unsplash.com/photo-1521017432531-fbd92d768814?auto=format&fit=crop&w=600&q=80',
    'تهران، بلوار کشاورز، تقاطع فلسطین', 
    '02188990011', 
    'wifi_cowork_cafe', 
    'اینترنت فیبر نوری پرسرعت، پریز برق روی هر میز و سکوت مناسب تمرکز.',
    '[{"id":1,"title":"میز کار اشتراکی ۱","feature":"پریز برق"},{"id":2,"title":"میز جلسات تیمی","feature":"اتاق جلسات"}]'::jsonb,
    '[{"name":"اسپرسو دابل","price":"۶۵,۰۰۰ تومان"},{"name":"چای ماسالا","price":"۷۵,۰۰۰ تومان"}]'::jsonb,
    'MZ-WIFI3'
)
ON CONFLICT (id) DO NOTHING;
