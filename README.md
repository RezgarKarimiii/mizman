# Cafe Booking

MVP for smart cafe/restaurant table booking.

## Run

1. Copy `.env.example` to `.env` and set PostgreSQL `DATABASE_URL`.
2. Install dependencies:

```bash
npm install
```

3. Generate Prisma client and migrate:

```bash
npx prisma generate
npx prisma migrate dev --name init
```

4. Start:

```bash
npm run dev
```

Open http://localhost:3000

## Current MVP
- Persian RTL customer home
- Cafe listing/detail
- Interactive table selection prototype
- Prisma/PostgreSQL schema for users, cafes, branches, floors, tables and reservations
- First cafes API endpoint

Next implementation: atomic reservation API, authentication, menu/pre-order, payment adapter, merchant floor-plan editor and realtime waitlist.
