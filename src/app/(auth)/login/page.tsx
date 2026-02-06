import LoginForm from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Ingresar</h1>
        <p className="text-sm text-muted-foreground">
          Acceso para operadores y equipos de internación domiciliaria.
        </p>
      </div>
      <LoginForm />
    </div>
  );
}
