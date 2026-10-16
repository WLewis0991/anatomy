"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";

/**
 * The browser's Supabase client, with its Realtime socket already authenticated.
 *
 * Supplying `accessToken` alone is not enough, which is what this function exists
 * to fix. supabase-js hands that token to `realtime.setAuth` on a microtask, but
 * `channel().subscribe()` reaches `connect()` before the microtask resolves, so
 * the join frame goes out with no token and Realtime authorises the subscription
 * as `anon`. The row policies grant nothing to `anon`, so the subscription
 * matches no rows and delivers no events — and raises no CHANNEL_ERROR to say so.
 * The symptom is a progress page that shows the reconciled stage and then never
 * moves.
 *
 * Awaiting `realtime.setAuth(token)` before this function returns is what makes
 * the join frame carry the token: it populates `socket.accessTokenValue`, which
 * `RealtimeChannel.subscribe` reads when it builds that frame. Doing it here
 * rather than at each call site means a caller cannot forget — there is no way to
 * get a client from this function without the socket having been handed its token
 * first.
 *
 * Returns null when Clerk has no session token: there is then no authenticated
 * socket to open, and subscribing anyway would only reproduce the silent `anon`
 * subscription above. The caller decides what an unauthenticated screen shows.
 */
export async function createBrowserSupabaseClient(
  url: string,
  publishableKey: string,
  accessToken: () => Promise<string | null>,
): Promise<SupabaseClient<Database> | null> {
  const token = await accessToken();
  if (!token) return null;

  const client = createClient<Database>(url, publishableKey, {
    accessToken: async () => (await accessToken()) ?? "",
  });

  await client.realtime.setAuth(token);
  return client;
}
