"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Robot,
  User,
  Phone,
  PaperPlaneTilt,
  Warning,
} from "@phosphor-icons/react";
import {
  toggleBotAction,
  sendHumanMessageAction,
} from "@/lib/actions/conversations";

interface MessageItem {
  id: string;
  direction: "inbound" | "outbound";
  sender: "contact" | "bot" | "human";
  content: string | null;
  created_at: string;
}

interface ContactInfo {
  id: string;
  wa_phone: string;
  full_name: string | null;
}

interface Props {
  conversationId: string;
  organizationId: string;
  botActive: boolean;
  bookingState: string | null;
  contact: ContactInfo;
  initialMessages: MessageItem[];
}

const BOOKING_STATE_LABELS: Record<string, { label: string; cls: string }> = {
  collecting_service: {
    label: "Seleccionando servicio",
    cls: "bg-amber-50 text-amber-700 border-amber-200",
  },
  collecting_slot: {
    label: "Eligiendo horario",
    cls: "bg-amber-50 text-amber-700 border-amber-200",
  },
  collecting_name: {
    label: "Recolectando nombre",
    cls: "bg-amber-50 text-amber-700 border-amber-200",
  },
  collecting_new_patient: {
    label: "¿Paciente nuevo?",
    cls: "bg-amber-50 text-amber-700 border-amber-200",
  },
  collecting_medical_info: {
    label: "Datos médicos",
    cls: "bg-amber-50 text-amber-700 border-amber-200",
  },
  confirming: {
    label: "Confirmando cita",
    cls: "bg-orange-50 text-orange-700 border-orange-200",
  },
  done: {
    label: "Cita agendada",
    cls: "bg-teal-50 text-teal-700 border-teal-200",
  },
};

function getInitials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?"
  );
}

export function ConversationDetail({
  conversationId,
  organizationId,
  botActive: initialBotActive,
  bookingState: initialBookingState,
  contact,
  initialMessages,
}: Props) {
  const [messages, setMessages] = useState<MessageItem[]>(initialMessages);
  const [botActive, setBotActive] = useState(initialBotActive);
  const [bookingState, setBookingState] = useState(initialBookingState);
  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isTogglingBot, startToggleTransition] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Realtime subscriptions
  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`conv-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as {
            id: string;
            direction: string;
            sender: string;
            content: string | null;
            created_at: string | null;
          };
          setMessages((prev) => {
            if (prev.some((m) => m.id === row.id)) return prev;
            return [
              ...prev,
              {
                id: row.id,
                direction: row.direction as "inbound" | "outbound",
                sender: row.sender as "contact" | "bot" | "human",
                content: row.content,
                created_at: row.created_at ?? new Date().toISOString(),
              },
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
          filter: `id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as {
            bot_active: boolean | null;
            booking_state: string | null;
          };
          setBotActive(row.bot_active ?? true);
          setBookingState(row.booking_state);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  function handleToggleBot() {
    const newValue = !botActive;
    setBotActive(newValue); // optimistic
    startToggleTransition(async () => {
      const fd = new FormData();
      fd.set("conversationId", conversationId);
      fd.set("botActive", String(newValue));
      const result = await toggleBotAction(fd);
      if (result?.error) setBotActive(!newValue); // revert
    });
  }

  async function handleSend() {
    const content = inputValue.trim();
    if (!content || isSending) return;

    setIsSending(true);
    setSendError(null);

    const fd = new FormData();
    fd.set("conversationId", conversationId);
    fd.set("organizationId", organizationId);
    fd.set("waPhone", contact.wa_phone);
    fd.set("content", content);

    const result = await sendHumanMessageAction(fd);
    if (result?.error) {
      setSendError(result.error);
    } else {
      setInputValue("");
    }
    setIsSending(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  const displayName = contact.full_name ?? contact.wa_phone;
  const bookingInfo = bookingState
    ? (BOOKING_STATE_LABELS[bookingState] ?? null)
    : null;

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-stone-200 flex-shrink-0 min-h-[56px]">
        <div className="w-8 h-8 rounded-full bg-teal-100 text-teal-700 text-xs font-semibold flex items-center justify-center select-none flex-shrink-0">
          {getInitials(displayName)}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-900 truncate">
              {displayName}
            </span>
            {contact.full_name && (
              <span className="flex items-center gap-1 text-xs text-stone-400 flex-shrink-0">
                <Phone size={11} />
                {contact.wa_phone}
              </span>
            )}
            {bookingInfo && (
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${bookingInfo.cls}`}
              >
                {bookingInfo.label}
              </span>
            )}
          </div>
        </div>

        {/* Bot toggle */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {!botActive && (
            <span className="flex items-center gap-1 text-xs font-medium text-red-500">
              <Warning size={12} weight="fill" />
              Requiere atención
            </span>
          )}
          <span className="text-xs text-stone-500">Bot</span>
          <button
            onClick={handleToggleBot}
            disabled={isTogglingBot}
            className={[
              "relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500",
              botActive ? "bg-teal-500" : "bg-stone-300",
              isTogglingBot
                ? "opacity-60 cursor-not-allowed"
                : "cursor-pointer",
            ].join(" ")}
            title={botActive ? "Desactivar bot" : "Activar bot"}
            aria-label={botActive ? "Desactivar bot" : "Activar bot"}
            aria-pressed={botActive}
          >
            <span
              className={[
                "inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform duration-150",
                botActive ? "translate-x-[1.125rem]" : "translate-x-0.5",
              ].join(" ")}
            />
          </button>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-stone-400">Sin mensajes aún</p>
          </div>
        ) : (
          messages.map((msg) => <MessageBubble key={msg.id} msg={msg} />)
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-stone-200 bg-white px-4 py-3 flex-shrink-0">
        {botActive && (
          <p className="flex items-center gap-1.5 text-xs text-amber-600 mb-2">
            <Robot size={12} weight="fill" />
            El bot está activo. Tu mensaje se enviará igualmente.
          </p>
        )}
        {sendError && (
          <p className="text-xs text-red-500 mb-2">{sendError}</p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escribe como humano… (Enter para enviar, Shift+Enter para nueva línea)"
            rows={2}
            className="flex-1 resize-none rounded-xl border border-stone-200 px-3 py-2 text-sm text-slate-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent transition-shadow"
          />
          <button
            onClick={() => void handleSend()}
            disabled={isSending || !inputValue.trim()}
            className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-xl bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            aria-label="Enviar mensaje"
          >
            <PaperPlaneTilt size={16} weight="fill" />
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: MessageItem }) {
  const isOutbound = msg.direction === "outbound";
  const isBot = msg.sender === "bot";

  const timeStr = new Date(msg.created_at).toLocaleTimeString("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  if (!isOutbound) {
    return (
      <div className="flex items-end gap-2 max-w-[78%]">
        <div className="w-6 h-6 rounded-full bg-stone-200 flex items-center justify-center flex-shrink-0 mb-1">
          <User size={13} className="text-stone-500" />
        </div>
        <div>
          <div className="bg-stone-100 text-slate-800 rounded-2xl rounded-bl-md px-3.5 py-2 text-sm leading-relaxed">
            {msg.content ? (
              <span className="whitespace-pre-wrap">{msg.content}</span>
            ) : (
              <span className="italic text-stone-400">
                Media (imagen/audio/PDF)
              </span>
            )}
          </div>
          <p className="text-[11px] text-stone-400 mt-0.5 ml-1">{timeStr}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-end gap-2 max-w-[78%] ml-auto flex-row-reverse">
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mb-1 ${
          isBot ? "bg-teal-100" : "bg-blue-100"
        }`}
      >
        {isBot ? (
          <Robot size={13} className="text-teal-600" weight="fill" />
        ) : (
          <User size={13} className="text-blue-600" weight="fill" />
        )}
      </div>
      <div>
        <div
          className={`rounded-2xl rounded-br-md px-3.5 py-2 text-sm leading-relaxed ${
            isBot ? "bg-teal-100 text-teal-900" : "bg-blue-50 text-blue-900"
          }`}
        >
          {msg.content ? (
            <span className="whitespace-pre-wrap">{msg.content}</span>
          ) : (
            <span
              className={`italic ${isBot ? "text-teal-500" : "text-blue-400"}`}
            >
              Media
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 justify-end mt-0.5 mr-1">
          <span
            className={`text-[11px] font-medium ${
              isBot ? "text-teal-500" : "text-blue-400"
            }`}
          >
            {isBot ? "Bot" : "Tú"}
          </span>
          <span className="text-[11px] text-stone-400">{timeStr}</span>
        </div>
      </div>
    </div>
  );
}
