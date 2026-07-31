import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "Kairo / Life OS — The System That Notices";
const description =
  "A researched product vision for connecting Progress, Time, Kairo, health, attention, work and lived experience into a private personal intelligence system.";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim();
  const candidateHost = forwardedHost || requestHeaders.get("host") || "localhost:3000";
  const host = /^[a-z0-9.-]+(?::\d+)?$/i.test(candidateHost)
    ? candidateHost
    : "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    (host.startsWith("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host}`);
  const socialImage = new URL("/og.png", metadataBase).toString();

  return {
    metadataBase,
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images: [{ url: socialImage, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [socialImage],
    },
  };
}

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
