"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { ChatDots, Warning } from "@phosphor-icons/react";
import { createClient } from "@/lib/supabase/client";

export interface ConvItem {
  id: string;
  bot_active: boolean;
  booking_state: string | null;
  last_message_at: string | null;
  contact: { wa_phone: string; full_name: string | null };
  last_message: string | null;
}

interface Props {
  initialConversations: ConvItem[];
  organizationId: string;
  children: React.ReactNode;
}

export function ConversationsShell({
  initialConversations,
  organizationId,
  children,
}: Props) {
  const [conversations, setConversations] =
    useState<ConvItem[]>(initialConversations);
  const pathname = usePathname();
  // pathname is /conversaciones or /conversaciones/[id]
  const segments = pathname.split("/");
  const selectedId = segments.length >= 3 && segments[2] ? segments[2] : null;

  useEffect(() => {
    if (!organizationId) return;
    const supabase = createClient();

    const channel = supabase
      .channel(`org-convs-${organizationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "conversations",
          filter: `organization_id=eq.${organizationId}`,
        },
        async (payload) => {
          const row = payload.new as {
            id: string;
            bot_active: boolean | null;
            booking_state: string | null;
            last_message_at: string | null;
            contact_id: string;
          };

          // Fetch contact name/phone for the new conversation
          const { data: contactRaw } = await supabase
            .from("contacts")
            .select("wa_phone, full_name")
            .eq("id", row.contact_id)
            .single();
          // DECISION: cast necesario — supabase-js@2.49.9 infiere never para .single() con tipos manuales
          const contact = contactRaw as {
            wa_phone: string;
            full_name: string | null;
          } | null;

          setConversations((prev) => {
            if (prev.some((c) => c.id === row.id)) return prev;
            return [
              {
                id: row.id,
                bot_active: row.bot_active ?? true,
                booking_state: row.booking_state,
                last_message_at: row.last_message_at,
                contact: contact ?? { wa_phone: "", full_name: null },
                last_message: null,
              },
              ...prev,
            ];
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversations",
          // No server-side filter for UPDATE — requires REPLICA IDENTITY FULL;
          // RLS ensures this user only receives their org's events
        },
        (payload) => {
          const row = payload.new as {
            id: string;
            bot_active: boolean | null;
            booking_state: string | null;
            last_message_at: string | null;
          };
          setConversations((prev) =>
            prev.map((c) =>
              c.id === row.id
                ? {
                    ...c,
                    bot_active: row.bot_active ?? true,
                    booking_state: row.booking_state,
                    last_message_at: row.last_message_at,
                  }
                : c
            )
          );
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload) => {
          const msg = payload.new as {
            conversation_id: string;
            content: string | null;
          };
          setConversations((prev) =>
            prev.map((c) =>
              c.id === msg.conversation_id
                ? {
                    ...c,
                    last_message: msg.content,
                    last_message_at: new Date().toISOString(),
                  }
                : c
            )
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId]);

  const sorted = [...conversations].sort((a, b) => {
    const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
    const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
    return tb - ta;
  });

  const handoffCount = sorted.filter((c) => !c.bot_active).length;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel — conversation list */}
      <div className="w-72 flex-shrink-0 flex flex-col border-r border-stone-200 bg-white overflow-hidden">
        <div className="px-4 py-3.5 border-b border-stone-200 flex items-center justify-between flex-shrink-0">
          <div>
            <h1 className="text-sm font-semibold text-slate-900">
              Conversaciones
            </h1>
            <p className="text-xs text-stone-400 mt-0.5">
              {sorted.length} {sorted.length === 1 ? "hilo" : "hilos"}
            </p>
          </div>
          {handoffCount > 0 && (
            <span className="flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 rounded-full px-2 py-0.5 border border-red-100">
              <Warning size={12} weight="fill" />
              {handoffCount}
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-stone-100">
          {sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center px-4">
              <ChatDots size={32} weight="thin" className="text-stone-300" />
              <p className="mt-2 text-sm text-stone-400">
                Sin conversaciones aún
              </p>
            </div>
          ) : (
            sorted.map((conv) => (
              <ConvListItem
                key={conv.id}
                conv={conv}
                isSelected={conv.id === selectedId}
              />
            ))
          )}
        </div>
      </div>

      {/* Right panel — detail or empty state */}
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

function ConvListItem({
  conv,
  isSelected,
}: {
  conv: ConvItem;
  isSelected: boolean;
}) {
  const displayName = conv.contact.full_name ?? conv.contact.wa_phone;
  const initials =
    displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?";

  const relTime = conv.last_message_at
    ? formatRelTime(conv.last_message_at)
    : null;

  return (
    <Link
      href={`/conversaciones/${conv.id}`}
      className={[
        "flex items-start gap-3 px-4 py-3 transition-colors border-l-2",
        isSelected
          ? "bg-teal-50 border-l-teal-500"
          : "hover:bg-stone-50 border-l-transparent",
      ].join(" ")}
    >
      <div className="relative flex-shrink-0 mt-0.5">
        <div className="w-9 h-9 rounded-full bg-teal-100 text-teal-700 text-xs font-semibold flex items-center justify-center select-none">
          {initials}
        </div>
        {!conv.bot_active && (
          <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-red-500 border-2 border-white" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-1">
          <span className="text-sm font-medium text-slate-800 truncate">
            {displayName}
          </span>
          {relTime && (
            <span className="text-[11px] text-stone-400 flex-shrink-0 leading-none">
              {relTime}
            </span>
          )}
        </div>
        <p className="text-xs text-stone-500 truncate mt-0.5 leading-tight">
          {conv.last_message ?? (
            <span className="italic text-stone-400">Sin mensajes</span>
          )}
        </p>
      </div>
    </Link>
  );
}

function formatRelTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
