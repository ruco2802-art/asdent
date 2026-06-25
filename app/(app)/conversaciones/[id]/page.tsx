import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile, Json } from "@/lib/database.types";
import { ConversationDetail } from "../_components/conversation-detail";

export default async function ConversacionDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

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
  if (!organizationId) redirect("/conversaciones");

  // Fetch the conversation (RLS ensures it belongs to this org)
  const { data: rawConv } = await supabase
    .from("conversations")
    .select(
      "id, bot_active, booking_state, booking_data, organization_id, contacts(id, wa_phone, full_name)"
    )
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!rawConv) redirect("/conversaciones");

  // DECISION: cast necesario — supabase-js@2.49.9 infiere never para join en .maybeSingle() con tipos manuales
  const conv = rawConv as {
    id: string;
    bot_active: boolean | null;
    booking_state: string | null;
    booking_data: Json | null;
    organization_id: string;
    contacts: { id: string; wa_phone: string; full_name: string | null } | null;
  };

  // Fetch last 50 messages ordered oldest-first for chronological display
  const { data: rawMessages } = await supabase
    .from("messages")
    .select("id, direction, sender, content, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true })
    .limit(50);

  // DECISION: cast necesario — supabase-js@2.49.9 infiere never para select parcial con tipos manuales
  const messages = (rawMessages ?? []) as Array<{
    id: string;
    direction: string;
    sender: string;
    content: string | null;
    created_at: string | null;
  }>;

  return (
    <ConversationDetail
      conversationId={id}
      organizationId={organizationId}
      botActive={conv.bot_active ?? true}
      bookingState={conv.booking_state}
      contact={{
        id: conv.contacts?.id ?? "",
        wa_phone: conv.contacts?.wa_phone ?? "",
        full_name: conv.contacts?.full_name ?? null,
      }}
      initialMessages={messages.map((m) => ({
        id: m.id,
        direction: m.direction as "inbound" | "outbound",
        sender: m.sender as "contact" | "bot" | "human",
        content: m.content,
        created_at: m.created_at ?? new Date().toISOString(),
      }))}
    />
  );
}
