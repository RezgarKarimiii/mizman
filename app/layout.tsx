import "./globals.css";

export const metadata = {
  title: "میزمن | رزرو هوشمند میز",
  description: "رزرو میز و مدیریت نوبتدهی هوشمند کافه و رستوران",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fa" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
