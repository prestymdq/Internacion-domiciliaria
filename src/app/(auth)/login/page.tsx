import LoginForm from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
            ID
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Plataforma
            </p>
            <p className="text-lg font-semibold">Internacion Domiciliaria</p>
          </div>
        </div>
        <h1 className="text-2xl font-semibold">Ingresar</h1>
        <p className="text-sm text-muted-foreground">
          Acceso seguro para equipos clinicos, logistica y facturacion.
        </p>
      </div>
      <LoginForm />
    </div>
  );
}
