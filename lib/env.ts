import "server-only";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Add it to .env.local — a blank value here turns into a confusing failure later.`,
    );
  }
  return value;
}

/**
 * Checked on import, and imported from `instrumentation.ts`, so a missing value
 * stops the server on boot rather than surfacing three screens in.
 */
export const env = {
  clerkPublishableKey: required("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"),
  clerkSecretKey: required("CLERK_SECRET_KEY"),
  supabaseUrl: required("NEXT_PUBLIC_SUPABASE_URL"),
  supabasePublishableKey: required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
} as const;
