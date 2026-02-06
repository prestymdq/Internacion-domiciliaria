export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-12">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(8,145,178,0.15),_transparent_55%),radial-gradient(circle_at_bottom,_rgba(234,179,8,0.18),_transparent_50%)]" />
      <div className="absolute -left-24 top-16 h-48 w-48 rounded-full bg-primary/20 blur-3xl" />
      <div className="absolute -right-20 bottom-10 h-56 w-56 rounded-full bg-accent/40 blur-3xl" />
      <div className="relative w-full max-w-md rounded-3xl border border-white/70 bg-white/80 p-8 shadow-[0_30px_80px_-50px_rgba(15,23,42,0.7)] backdrop-blur">
        {children}
      </div>
    </div>
  );
}
