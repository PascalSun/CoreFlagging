"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { LocaleProvider } from "@/lib/i18n";
import { configurePlatformClient } from "@ntlp/platform-client";
import { track } from "@/lib/analytics";
import { site } from "@/lib/landing-site";

// the shared platform client reports sign-in events to this app's analytics and points support at this site
configurePlatformClient({ onEvent: (e, p) => track(e, p as Parameters<typeof track>[1]), supportEmail: site.email });

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  }));
  return (
    <QueryClientProvider client={client}>
      <LocaleProvider>{children}</LocaleProvider>
    </QueryClientProvider>
  );
}
