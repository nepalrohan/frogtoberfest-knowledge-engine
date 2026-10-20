import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@repo/ui/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
});

import { TooltipProvider, Toaster } from "@repo/ui";
import { AppSidebar } from "./components/app-sidebar";

export const metadata: Metadata = {
  title: "Knowledge Engine | Internal Knowledge Assistant",
  description: "Enterprise knowledge engine with Notion & Confluence RAG pipelines",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <body className={`${geistSans.variable} ${geistMono.variable} min-h-screen bg-background text-foreground antialiased`}>
        <TooltipProvider>
          <div className="grid min-h-screen grid-cols-[220px_minmax(0,1fr)] text-sm">
            <AppSidebar />
            <main className="mx-auto flex w-full max-w-240 min-w-0 flex-col gap-5 px-8 pt-8 pb-16">
              {children}
            </main>
          </div>
          <Toaster position="top-right" />
        </TooltipProvider>
      </body>
    </html>
  );
}
