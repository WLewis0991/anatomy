import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { themeScript } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "anatomy",
  description: "A map of a codebase, drawn from the code itself.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The theme script mutates the class list before hydration, so the server's
    // markup and the browser's no longer match here.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* `--bg` was renamed to `--ground`, so `bg-bg` generated nothing and the
          page rendered correctly only because globals.css paints the body too.
          `text-fg` still resolves; `--fg` was not renamed. */}
      <body className="min-h-full bg-ground text-fg">
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <ClerkProvider
          // Clerk's default theme follows `color-scheme`, which globals.css sets
          // from the same root state the rest of the app uses. The accent is the
          // literal `--accent` from globals.css; Clerk parses this value rather
          // than inheriting it, so it can't be a var() reference.
          appearance={{
            variables: { colorPrimary: "#2563eb", borderRadius: "0.25rem" },
          }}
        >
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
