import { Geist_Mono, Inter, Lora } from "next/font/google";

const sans = Inter({
  variable: "--font-inter",
  subsets: ["latin-ext"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const mono = Geist_Mono({
  variable: "--font-mono-source",
  subsets: ["latin"],
});

const serif = Lora({
  variable: "--font-serif-source",
  subsets: ["latin-ext"],
  weight: ["400", "500"],
  display: "swap",
});

export const fontVariables = `${sans.variable} ${mono.variable} ${serif.variable}`;
