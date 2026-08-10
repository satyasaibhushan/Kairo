import type { Metadata } from "next";
import "./globals.css";

const title = "Kairo";
const description =
  "Kairo connects consented health, attention, schedule, and location signals to create private, evidence-backed daily insights for its user.";

export const metadata: Metadata = {
  metadataBase: new URL("https://kairo.bhushan.fun"),
  applicationName: "Kairo",
  title,
  description,
  openGraph: {
    title,
    siteName: "Kairo",
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
    <html data-scroll-behavior="smooth" lang="en">
      <body>{children}</body>
    </html>
  );
}
