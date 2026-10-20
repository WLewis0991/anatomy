import { clerkMiddleware } from "@clerk/nextjs/server";

// Deny by default: a route is protected unless it is listed here. A signed-out
// visitor is turned away in the proxy, before the route renders, which is the
// only point early enough — by the time a page runs, its layouts' HTML has
// already been committed to the response.
const PUBLIC_PREFIXES = ["/", "/sign-in", "/sign-up", "/__clerk", "/preview"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export default clerkMiddleware(async (auth, request) => {
  if (!isPublic(request.nextUrl.pathname)) {
    // Load-bearing for signed-out visitors, not a substitute for the check each
    // protected page makes for itself.
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
