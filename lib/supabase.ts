import "server-only";

import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";

/**
 * The only place a Supabase client is constructed. It carries Clerk's session
 * token on every request, which is what makes the organization claim readable
 * inside a row-level security policy. A client built without this looks fine
 * until the first policy exists, and then returns nothing.
 */
export function createSupabaseClient() {
  return createClient(env.supabaseUrl, env.supabasePublishableKey, {
    accessToken: async () => (await auth()).getToken(),
  });
}
