import type { Metadata } from "next";
import "@fontsource-variable/atkinson-hyperlegible-next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ankunft - arrival plan for international students in Berlin",
  description:
    "A step-by-step plan for your first weeks in Berlin. Every rule shows its official source and whether it is law or our inference.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
