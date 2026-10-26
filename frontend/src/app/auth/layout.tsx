import type { Metadata } from "next";

// The sign-in hand-offs to and from the platform: nothing here for a search engine.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
