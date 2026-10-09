import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import "./contrast.css";
import { AuthProvider } from "@/contexts/AuthContext";
import { APP_NAME, APP_NAME_SUFFIX } from "@/lib/brand";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: `${APP_NAME} ${APP_NAME_SUFFIX}`,
  description: "团队协作 WhatsApp 营销与客服平台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh">
      <body className={`${inter.className} bg-slate-50 text-slate-900`}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
