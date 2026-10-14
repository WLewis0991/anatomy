import "server-only";

import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { env } from "@/lib/env";

/**
 * The only place a Supabase client is constructed. It carries Clerk's session
 * token on every request, which is what makes the organization claim readable
 * inside a row-level security policy. A client built without this looks fine
 * until the first policy exists, and then returns nothing.
 *
 * Call it inside the request that needs it, never at module scope: the token is
 * read per call, but a client held across requests is one whose identity is
 * whatever the first request left behind.
 */
export function createSupabaseClient() {
  return createClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
    accessToken: async () => (await auth()).getToken(),
  });
}
