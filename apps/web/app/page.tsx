"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "@/lib/session";

export default function Home() {
  const { user, ready } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (ready) router.replace(user ? "/deals" : "/login");
  }, [ready, user, router]);
  return null;
}
