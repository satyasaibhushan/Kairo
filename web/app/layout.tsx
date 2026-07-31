import type { Metadata } from "next";
import "./globals.css";

const title = "Kairo / Life OS — The System That Notices";
const description =
  "A researched product vision for connecting Progress, Time, Kairo, health, attention, work and lived experience into a private personal intelligence system.";

export const metadata: Metadata = {
  metadataBase: new URL("https://kairo.bhushan.fun"),
  title,
  description,
  openGraph: {
    title,
    description,
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: title }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
