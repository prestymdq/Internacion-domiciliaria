"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/lib/error-messages";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const code = error?.message ?? "UNKNOWN_ERROR";
  const message = getErrorMessage(code);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-lg space-y-4 rounded-2xl border bg-background p-6 shadow-sm">
        <div>
          <h1 className="text-2xl font-semibold">Ocurrio un error</h1>
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
        <div className="text-xs text-muted-foreground">
          Codigo: {code}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => reset()}>Reintentar</Button>
          <Button asChild variant="outline">
            <Link href="/dashboard">Volver al dashboard</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
