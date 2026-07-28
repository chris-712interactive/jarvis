import type { Metadata } from "next";
import { Outfit, Oxanium, Share_Tech_Mono } from "next/font/google";
import { Atmosphere } from "@/components/atmosphere";
import "./globals.css";

const oxanium = Oxanium({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

const outfit = Outfit({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const mono = Share_Tech_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "Jarvis",
  description:
    "Dark holographic command center — talk to it, dispatch agents, keep every lane moving.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${oxanium.variable} ${outfit.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col text-ink">
        <Atmosphere />
        <div className="shell flex min-h-full flex-1 flex-col">{children}</div>
      </body>
    </html>
  );
}
