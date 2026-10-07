import Link from "next/link";
import { cafes } from "@/lib/demo-data";

export default function Home() {
  return (
    <main>
      <section className="min-h-[72vh] flex items-center">
        <div className="container py-16">
          <div className="max-w-3xl">
            <span className="inline-flex rounded-full bg-orange-100 px-4 py-2 text-sm text-orange-800">
              رزرو هوشمند میز
            </span>

            <h1 className="mt-6 text-4xl font-black leading-tight sm:text-6xl">
              میز مورد علاقهات را
              <br />
              همین حالا رزرو کن.
            </h1>

            <p className="mt-5 max-w-2xl text-lg leading-8 text-stone-600">
              کافه را انتخاب کن میز دلخواهت را روی نقشه ببین و در چند مرحله
              رزروت را قطعی کن.
            </p>
          </div>

          <div className="mt-10 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-stone-200">
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
              <input
                className="rounded-2xl bg-stone-100 px-4 py-4 outline-none"
                placeholder="نام کافه یا منطقه"
              />

              <input
                type="date"
                className="rounded-2xl bg-stone-100 px-4 py-4 outline-none"
              />

              <select className="rounded-2xl bg-stone-100 px-4 py-4 outline-none">
                <option>۲ نفر</option>
                <option>۳ نفر</option>
                <option>۴ نفر</option>
                <option>۶ نفر</option>
              </select>

              <Link
                href="/cafes/level-cafe"
                className="rounded-2xl bg-[var(--primary)] px-7 py-4 text-center font-bold text-white"
              >
                مشاهده کافهها
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="pb-20">
        <div className="container">
          <h2 className="text-2xl font-black">
            کافههای پیشنهادی
          </h2>

          <div className="mt-6 grid gap-5 md:grid-cols-2">
            {cafes.map((c) => (
              <Link
                href={"/cafes/" + c.slug}
                key={c.id}
                className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-200 transition hover:-translate-y-1"
              >
                <div className="h-44 rounded-2xl bg-stone-200" />

                <div className="mt-5 flex items-center justify-between">
                  <h3 className="text-xl font-bold">{c.name}</h3>
                  <span>★ {c.rating}</span>
                </div>

                <p className="mt-2 text-stone-600">
                  {c.description}
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  {c.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-full bg-stone-100 px-3 py-1 text-xs"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
