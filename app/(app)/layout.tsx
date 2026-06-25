import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile, Organization } from "@/lib/database.types";
import { Sidebar } from "./_components/sidebar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // supabase-js@2.49.9 infiere 'never' para .single() con tipos de DB escritos manualmente;
  // el cast a Profile | null es seguro — la estructura en runtime coincide con Profile.Row
  const { data: rawProfile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  const profile = rawProfile as Profile | null;

  let orgName = "Mi Clínica";
  if (profile?.organization_id) {
    const { data: rawOrg } = await supabase
      .from("organizations")
      .select("*")
      .eq("id", profile.organization_id)
      .single();
    const org = rawOrg as Organization | null;
    orgName = org?.name ?? "Mi Clínica";
  }

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar
        orgName={orgName}
        userName={profile?.full_name ?? ""}
        userEmail={user.email ?? ""}
      />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
