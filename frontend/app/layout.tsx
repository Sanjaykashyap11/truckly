import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Truckly — AI Fleet Co-Pilot",
  description:
    "Hands-free AI voice co-pilot for truck drivers. HOS compliance, truck-safe routing, fuel optimization, and breakdown response — all in one platform.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
