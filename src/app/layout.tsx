import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "@/styles/document-viewer.css";
import { Sidebar } from "@/components/sidebar";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "JCL GovCon - Federal Contract Tracker",
  description: "Track and manage federal contract opportunities",
};

// Static theme initialization script — no user input, safe from XSS
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("theme");if(t==="dark"||(!t&&window.matchMedia("(prefers-color-scheme:dark)").matches)){document.documentElement.classList.add("dark")}}catch(e){}})()`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[var(--surface-alt)] text-[var(--text-primary)]`}
      >
        <Sidebar />
        <main className="md:ml-16 ml-0 min-h-screen">
          {children}
        </main>
      </body>
    </html>
  );
}
