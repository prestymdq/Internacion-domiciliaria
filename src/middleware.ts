export { default } from "next-auth/middleware";

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/patients/:path*",
    "/episodes/:path*",
    "/inventory/:path*",
    "/logistics/:path*",
    "/onboarding/:path*",
    "/superadmin/:path*",
    "/billing/:path*",
    "/api/deliveries/:path*",
  ],
};
