import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function AccessDenied({ reason }: { reason: string }) {
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-6 text-sm">
      <p className="font-medium">Acceso restringido</p>
      <p className="text-muted-foreground">{reason}</p>
      <Button asChild variant="outline" size="sm">
        <Link href="/billing">Ir a Billing</Link>
      </Button>
    </div>
  );
}
