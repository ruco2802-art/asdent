import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/database.types";
import { ConversationsShell } from "./_components/conversations-shell";

// Force dynamic rendering — nuevos mensajes llegan por WhatsApp en cualquier
// momento y esta lista debe reflejar el estado real de la BD en cada carga,
// nunca un render en caché (mismo patrón que /citas, ver commit b29cec5).
export const dynamic = "force-dynamic";

export default async function ConversacionesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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

  if (!organizationId) {
    return (
      <ConversationsShell initialConversations={[]} organizationId="">
        {children}
      </ConversationsShell>
    );
  }

  // Fetch conversations with embedded contact info
  const { data: rawConvs } = await supabase
    .from("conversations")
    .select("id, bot_active, booking_state, last_message_at, contact_id, contacts(wa_phone, full_name)")
    .eq("organization_id", organizationId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(50);

  // DECISION: cast necesario — supabase-js@2.49.9 infiere never para join en select parcial con tipos manuales
  const convRows = (rawConvs ?? []) as Array<{
    id: string;
    bot_active: boolean | null;
    booking_state: string | null;
    last_message_at: string | null;
    contact_id: string;
    contacts: { wa_phone: string; full_name: string | null } | null;
  }>;

  // Fetch last message preview for each conversation in a single query
  const convIds = convRows.map((c) => c.id);
  const lastMessageMap: Record<string, string | null> = {};

  if (convIds.length > 0) {
    const { data: rawMsgs } = await supabase
      .from("messages")
      .select("conversation_id, content")
      .in("conversation_id", convIds)
      .order("created_at", { ascending: false })
      .limit(100);

    for (const row of rawMsgs ?? []) {
      // DECISION: cast necesario — supabase-js@2.49.9 infiere never para select parcial con tipos manuales
      const m = row as { conversation_id: string; content: string | null };
      if (!(m.conversation_id in lastMessageMap)) {
        lastMessageMap[m.conversation_id] = m.content;
      }
    }
  }

  const initialConversations = convRows.map((c) => ({
    id: c.id,
    bot_active: c.bot_active ?? true,
    booking_state: c.booking_state,
    last_message_at: c.last_message_at,
    contact: {
      wa_phone: c.contacts?.wa_phone ?? "",
      full_name: c.contacts?.full_name ?? null,
    },
    last_message: lastMessageMap[c.id] ?? null,
  }));

  return (
    <ConversationsShell
      initialConversations={initialConversations}
      organizationId={organizationId}
    >
      {children}
    </ConversationsShell>
  );
}
