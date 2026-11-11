import type { Metadata } from "next";
import type { ReactNode } from "react";
// Served from the application's own domain, Cyrillic included (architecture 2.1).
import "@fontsource-variable/manrope";
import "./globals.css";

export const metadata: Metadata = {
  title: "StudySoft",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
