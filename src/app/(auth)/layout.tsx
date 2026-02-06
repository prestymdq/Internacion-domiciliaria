export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted px-4">
      <div className="w-full max-w-sm rounded-xl border bg-card p-8 shadow-sm">
        {children}
      </div>
    </div>
  );
}
