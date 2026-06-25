import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// Cliente con service_role para operaciones del webhook (bypassa RLS).
// NUNCA exponer este cliente al browser.
export function createServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
