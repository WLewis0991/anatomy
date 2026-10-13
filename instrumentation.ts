export async function register() {
  // Imported inside register so environment configuration is validated once, on
  // boot, before the server accepts a request.
  await import("./lib/env");
}
