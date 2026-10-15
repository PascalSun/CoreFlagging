import { redirect } from "next/navigation";

// Two holes are compared in a panel over the map now (?hole=A&cmp=B); an old /compare?a=&b= link lands there.
export default async function ComparePage({ searchParams }: { searchParams: Promise<{ a?: string; b?: string }> }) {
  const { a, b } = await searchParams;
  const p = new URLSearchParams();
  if (a) p.set("hole", a);
  if (a && b) p.set("cmp", b);
  redirect(`/map${p.size ? `?${p}` : ""}`);
}
