import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { SessionProvider } from "@/lib/session";
import "./globals.css";

export const metadata: Metadata = {
  title: "StepPay - оплата по шагам",
  description: "Деньги резервируются в цифровых рублях и уходят исполнителю только за принятый этап",
  icons: { icon: "/logo.png" },
};
export const viewport: Viewport = { themeColor: "#0a5cff", width: "device-width", initialScale: 1 };

const themeInit = `try{var t=localStorage.getItem('steppay.theme');if(!t)t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
