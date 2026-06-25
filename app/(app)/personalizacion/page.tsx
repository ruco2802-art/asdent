import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile, AgentConfig } from "@/lib/database.types";
import { PersonalizacionForm } from "./_components/personalizacion-form";

export default async function PersonalizacionPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: rawProfile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();
  // DECISION: cast necesario — supabase-js@2.49.9 infiere never para .single() con tipos manuales
  const profile = rawProfile as Pick<Profile, "organization_id"> | null;
  const organizationId = profile?.organization_id;
  if (!organizationId) redirect("/login");

  const { data: rawConfig } = await supabase
    .from("agent_configs")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
  // DECISION: cast necesario — mismo patrón
  const config = rawConfig as AgentConfig | null;

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-xl font-semibold text-slate-900 mb-6">
          Personalización del agente
        </h1>
        <PersonalizacionForm initialConfig={config} />
      </div>
    </div>
  );
}
