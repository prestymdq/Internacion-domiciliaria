"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function SignOutButton({ compact }: { compact?: boolean }) {
  return (
    <Button
      type="button"
      variant={compact ? "ghost" : "secondary"}
      onClick={() => signOut({ callbackUrl: "/login" })}
    >
      Salir
    </Button>
  );
}
