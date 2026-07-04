"use client";

import { useState } from "react";
import {
  Plus,
  Trash,
  FloppyDisk,
  Robot,
  X,
  PaperPlaneTilt,
  CheckCircle,
} from "@phosphor-icons/react";
import { saveAgentConfigAction } from "@/lib/actions/personalizacion";
import type { AgentConfig } from "@/lib/database.types";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ServiceItem {
  _id: string; // client-only key
  name: string;
  duration_minutes: number;
  description: string;
  requires_new_patient_intake: boolean;
}

interface BusinessInfo {
  name: string;
  address: string;
  phone: string;
  website: string;
  faq: string;
}

interface HourPeriod {
  enabled: boolean;
  start: string;
  end: string;
}

type HoursState = Record<string, HourPeriod>;

interface SandboxMsg {
  role: "user" | "assistant";
  content: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TONES = [
  "profesional y cálido",
  "formal",
  "amigable y cercano",
  "técnico y preciso",
];

const WEEKDAYS = [
  { key: "mon", label: "Lunes" },
  { key: "tue", label: "Martes" },
  { key: "wed", label: "Miércoles" },
  { key: "thu", label: "Jueves" },
  { key: "fri", label: "Viernes" },
  { key: "sat", label: "Sábado" },
  { key: "sun", label: "Domingo" },
];

const DEFAULT_PROMPT =
  "Eres el asistente virtual de la clínica dental. Tu función es agendar citas de forma eficiente y con empatía.\n\nResponde siempre en español. Si el paciente menciona dolor, urgencia o emergencia dental, responde con empatía inmediata y ofrece el slot más próximo disponible.\n\nConfirma siempre todos los datos con el paciente antes de registrar la cita.";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2);
}

function initServices(raw: unknown): ServiceItem[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[]).map((s) => ({
    _id: uid(),
    name: String(s.name ?? ""),
    duration_minutes: Number(s.duration_minutes ?? 30),
    description: String(s.description ?? ""),
    requires_new_patient_intake: Boolean(s.requires_new_patient_intake ?? false),
  }));
}

function initHours(raw: unknown): HoursState {
  const state: HoursState = {};
  const src = (raw ?? {}) as Record<string, { start: string; end: string }[]>;
  for (const { key } of WEEKDAYS) {
    const periods = src[key];
    state[key] = {
      enabled: Array.isArray(periods) && periods.length > 0,
      start: periods?.[0]?.start ?? "08:00",
      end: periods?.[0]?.end ?? "18:00",
    };
  }
  return state;
}

function initBusinessInfo(raw: unknown): BusinessInfo {
  const src = (raw ?? {}) as Record<string, unknown>;
  return {
    name: String(src.name ?? ""),
    address: String(src.address ?? ""),
    phone: String(src.phone ?? ""),
    website: String(src.website ?? ""),
    faq: String(src.faq ?? ""),
  };
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function PersonalizacionForm({
  initialConfig,
}: {
  initialConfig: AgentConfig | null;
}) {
  // ── Form state ──
  const [systemPrompt, setSystemPrompt] = useState(
    initialConfig?.system_prompt ?? DEFAULT_PROMPT
  );
  const [tone, setTone] = useState(
    initialConfig?.tone ?? "profesional y cálido"
  );
  const [assistantName, setAssistantName] = useState(
    initialConfig?.assistant_name ?? "Valentina"
  );
  const [businessInfo, setBusinessInfo] = useState<BusinessInfo>(
    initBusinessInfo(initialConfig?.business_info)
  );
  const [services, setServices] = useState<ServiceItem[]>(
    initServices(initialConfig?.services)
  );
  const [hours, setHours] = useState<HoursState>(
    initHours(initialConfig?.business_hours)
  );
  const [handoffMsg, setHandoffMsg] = useState(
    initialConfig?.handoff_message ??
      "Te comunico con un miembro de nuestro equipo en un momento. ¡Gracias por tu paciencia!"
  );
  const [confirmTpl, setConfirmTpl] = useState(
    initialConfig?.confirmation_template ??
      "Tu cita ha sido confirmada para el {fecha} a las {hora}. Recuerda llegar 10 minutos antes."
  );

  // ── Save state ──
  const [isSaving, setIsSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // ── Sandbox state ──
  const [sandboxOpen, setSandboxOpen] = useState(false);
  const [sandboxHistory, setSandboxHistory] = useState<SandboxMsg[]>([]);
  const [sandboxInput, setSandboxInput] = useState("");
  const [sandboxLoading, setSandboxLoading] = useState(false);
  const [sandboxError, setSandboxError] = useState<string | null>(null);

  // ── Handlers ──

  async function handleSave() {
    setIsSaving(true);
    setSaveMsg(null);

    const fd = new FormData();
    fd.set("system_prompt", systemPrompt);
    fd.set("tone", tone);
    fd.set("assistant_name", assistantName);
    fd.set("handoff_message", handoffMsg);
    fd.set("confirmation_template", confirmTpl);
    fd.set("business_info", JSON.stringify(businessInfo));
    fd.set(
      "services",
      JSON.stringify(services.map(({ _id: _, ...s }) => s))
    );
    const bhOut: Record<string, { start: string; end: string }[]> = {};
    for (const { key } of WEEKDAYS) {
      const h = hours[key];
      if (h?.enabled) bhOut[key] = [{ start: h.start, end: h.end }];
    }
    fd.set("business_hours", JSON.stringify(bhOut));

    const result = await saveAgentConfigAction(fd);
    setSaveMsg(
      result?.error
        ? { type: "error", text: result.error }
        : { type: "success", text: "Configuración guardada correctamente" }
    );
    setIsSaving(false);
    if (!result?.error)
      setTimeout(() => setSaveMsg(null), 3000);
  }

  async function sendSandboxMessage() {
    const msg = sandboxInput.trim();
    if (!msg || sandboxLoading) return;

    const newHistory: SandboxMsg[] = [
      ...sandboxHistory,
      { role: "user", content: msg },
    ];
    setSandboxHistory(newHistory);
    setSandboxInput("");
    setSandboxLoading(true);
    setSandboxError(null);

    try {
      const res = await fetch("/api/agent-sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg,
          history: sandboxHistory,
          systemPrompt,
        }),
      });
      const data = (await res.json()) as { response?: string; error?: string };
      if (data.response) {
        setSandboxHistory([
          ...newHistory,
          { role: "assistant", content: data.response },
        ]);
      } else {
        setSandboxError(data.error ?? "Error del agente");
      }
    } catch {
      setSandboxError("Error de conexión");
    }
    setSandboxLoading(false);
  }

  // ── Service helpers ──

  function addService() {
    setServices((prev) => [
      ...prev,
      {
        _id: uid(),
        name: "",
        duration_minutes: 30,
        description: "",
        requires_new_patient_intake: false,
      },
    ]);
  }

  function removeService(id: string) {
    setServices((prev) => prev.filter((s) => s._id !== id));
  }

  function updateService(id: string, field: keyof ServiceItem, value: unknown) {
    setServices((prev) =>
      prev.map((s) => (s._id === id ? { ...s, [field]: value } : s))
    );
  }

  // ── UI ──

  return (
    <div className="space-y-8">
      {/* ── Información del negocio ── */}
      <Section title="Información del negocio">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Nombre de la clínica">
            <input
              type="text"
              value={businessInfo.name}
              onChange={(e) =>
                setBusinessInfo((p) => ({ ...p, name: e.target.value }))
              }
              className={inputCls}
              placeholder="Clínica Dental ASDent"
            />
          </Field>
          <Field label="Teléfono">
            <input
              type="text"
              value={businessInfo.phone}
              onChange={(e) =>
                setBusinessInfo((p) => ({ ...p, phone: e.target.value }))
              }
              className={inputCls}
              placeholder="+57 300 000 0000"
            />
          </Field>
          <Field label="Dirección" className="col-span-2">
            <input
              type="text"
              value={businessInfo.address}
              onChange={(e) =>
                setBusinessInfo((p) => ({ ...p, address: e.target.value }))
              }
              className={inputCls}
              placeholder="Calle 123 #45-67, Bogotá"
            />
          </Field>
          <Field label="Sitio web">
            <input
              type="text"
              value={businessInfo.website}
              onChange={(e) =>
                setBusinessInfo((p) => ({ ...p, website: e.target.value }))
              }
              className={inputCls}
              placeholder="https://clinica.com"
            />
          </Field>
        </div>
        <Field label="FAQ / Preguntas frecuentes y políticas" className="mt-4">
          <textarea
            value={businessInfo.faq}
            onChange={(e) =>
              setBusinessInfo((p) => ({ ...p, faq: e.target.value }))
            }
            rows={3}
            className={inputCls + " resize-none"}
            placeholder="El pago se realiza al finalizar la consulta. Aceptamos efectivo y tarjeta..."
          />
        </Field>
      </Section>

      {/* ── Prompt y tono ── */}
      <Section title="Prompt del asistente">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Nombre del asistente">
            <input
              type="text"
              value={assistantName}
              onChange={(e) => setAssistantName(e.target.value)}
              className={inputCls}
              placeholder="Valentina"
            />
          </Field>
          <Field label="Tono de voz">
            <select
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              className={inputCls}
            >
              {TONES.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="System prompt" className="mt-4">
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={8}
            className={inputCls + " resize-none font-mono text-xs leading-relaxed"}
          />
          <p className="text-xs text-stone-400 mt-1">
            Texto base que define la personalidad y reglas del agente. Las
            reglas críticas de agendamiento se añaden automáticamente.
          </p>
        </Field>
      </Section>

      {/* ── Servicios ── */}
      <Section title="Servicios">
        <div className="space-y-2">
          {services.map((s) => (
            <div
              key={s._id}
              className="grid grid-cols-[1fr_80px_1fr_auto_auto] gap-2 items-center"
            >
              <input
                type="text"
                value={s.name}
                onChange={(e) => updateService(s._id, "name", e.target.value)}
                className={inputCls}
                placeholder="Nombre del servicio"
              />
              <div className="relative">
                <input
                  type="number"
                  value={s.duration_minutes}
                  onChange={(e) =>
                    updateService(s._id, "duration_minutes", parseInt(e.target.value) || 30)
                  }
                  min={5}
                  max={480}
                  className={inputCls + " pr-8"}
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-stone-400 pointer-events-none">
                  min
                </span>
              </div>
              <input
                type="text"
                value={s.description}
                onChange={(e) =>
                  updateService(s._id, "description", e.target.value)
                }
                className={inputCls}
                placeholder="Descripción opcional"
              />
              <label className="flex items-center gap-1.5 cursor-pointer whitespace-nowrap text-xs text-stone-600">
                <input
                  type="checkbox"
                  checked={s.requires_new_patient_intake}
                  onChange={(e) =>
                    updateService(
                      s._id,
                      "requires_new_patient_intake",
                      e.target.checked
                    )
                  }
                  className="w-3.5 h-3.5 rounded accent-teal-600"
                />
                Nuevo pac.
              </label>
              <button
                type="button"
                onClick={() => removeService(s._id)}
                className="p-1.5 rounded-lg hover:bg-red-50 text-stone-400 hover:text-red-500 transition-colors"
              >
                <Trash size={14} />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addService}
          className="mt-3 flex items-center gap-1.5 text-sm text-teal-600 hover:text-teal-700 font-medium transition-colors"
        >
          <Plus size={15} />
          Agregar servicio
        </button>
      </Section>

      {/* ── Horarios ── */}
      <Section title="Horarios de atención">
        <div className="space-y-2">
          {WEEKDAYS.map(({ key, label }) => {
            const h = hours[key] ?? { enabled: false, start: "08:00", end: "18:00" };
            return (
              <div key={key} className="flex items-center gap-3">
                <label className="flex items-center gap-2 w-28 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={h.enabled}
                    onChange={(e) =>
                      setHours((p) => ({
                        ...p,
                        [key]: { ...h, enabled: e.target.checked },
                      }))
                    }
                    className="w-3.5 h-3.5 rounded accent-teal-600"
                  />
                  <span className="text-sm text-slate-700">{label}</span>
                </label>
                <input
                  type="time"
                  value={h.start}
                  disabled={!h.enabled}
                  onChange={(e) =>
                    setHours((p) => ({
                      ...p,
                      [key]: { ...h, start: e.target.value },
                    }))
                  }
                  className={
                    inputCls +
                    " w-28 " +
                    (!h.enabled ? "opacity-40 cursor-not-allowed" : "")
                  }
                />
                <span className="text-stone-400 text-sm">–</span>
                <input
                  type="time"
                  value={h.end}
                  disabled={!h.enabled}
                  onChange={(e) =>
                    setHours((p) => ({
                      ...p,
                      [key]: { ...h, end: e.target.value },
                    }))
                  }
                  className={
                    inputCls +
                    " w-28 " +
                    (!h.enabled ? "opacity-40 cursor-not-allowed" : "")
                  }
                />
              </div>
            );
          })}
        </div>
      </Section>

      {/* ── Mensajes ── */}
      <Section title="Mensajes del sistema">
        <Field label="Mensaje de traspaso a humano (handoff)">
          <textarea
            value={handoffMsg}
            onChange={(e) => setHandoffMsg(e.target.value)}
            rows={2}
            className={inputCls + " resize-none"}
          />
        </Field>
        <Field label="Plantilla de confirmación de cita" className="mt-4">
          <textarea
            value={confirmTpl}
            onChange={(e) => setConfirmTpl(e.target.value)}
            rows={3}
            className={inputCls + " resize-none"}
          />
          <p className="text-xs text-stone-400 mt-1">
            Variables disponibles: {"{fecha}"}, {"{hora}"}, {"{servicio}"}
          </p>
        </Field>
      </Section>

      {/* ── Action bar ── */}
      <div className="flex items-center justify-between pt-2 border-t border-stone-200">
        <button
          type="button"
          onClick={() => {
            setSandboxOpen(true);
            setSandboxHistory([]);
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-stone-200 text-sm font-medium text-slate-600 hover:bg-stone-50 transition-colors"
        >
          <Robot size={16} weight="fill" className="text-teal-500" />
          Probar agente
        </button>

        <div className="flex items-center gap-3">
          {saveMsg && (
            <span
              className={`flex items-center gap-1.5 text-sm font-medium ${
                saveMsg.type === "success" ? "text-teal-600" : "text-red-500"
              }`}
            >
              {saveMsg.type === "success" && (
                <CheckCircle size={15} weight="fill" />
              )}
              {saveMsg.text}
            </span>
          )}
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving}
            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 disabled:opacity-50 transition-colors"
          >
            <FloppyDisk size={15} weight="fill" />
            {isSaving ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </div>

      {/* ── Sandbox modal ── */}
      {sandboxOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-end sm:justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col h-[520px]">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 flex-shrink-0">
              <div className="flex items-center gap-2">
                <Robot size={18} weight="fill" className="text-teal-500" />
                <span className="text-sm font-semibold text-slate-800">
                  Sandbox — probar agente
                </span>
              </div>
              <button
                onClick={() => setSandboxOpen(false)}
                className="p-1.5 rounded-lg hover:bg-stone-100 transition-colors"
              >
                <X size={15} className="text-stone-500" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {sandboxHistory.length === 0 && (
                <p className="text-xs text-stone-400 text-center py-4">
                  Escribe un mensaje para probar el sistema prompt actual.
                </p>
              )}
              {sandboxHistory.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] px-3 py-2 rounded-xl text-sm leading-relaxed ${
                      m.role === "user"
                        ? "bg-teal-600 text-white rounded-br-sm"
                        : "bg-stone-100 text-slate-800 rounded-bl-sm"
                    }`}
                  >
                    <span className="whitespace-pre-wrap">{m.content}</span>
                  </div>
                </div>
              ))}
              {sandboxLoading && (
                <div className="flex justify-start">
                  <div className="bg-stone-100 text-stone-400 px-3 py-2 rounded-xl rounded-bl-sm text-sm animate-pulse">
                    Escribiendo…
                  </div>
                </div>
              )}
              {sandboxError && (
                <p className="text-xs text-red-500 text-center">
                  {sandboxError}
                </p>
              )}
            </div>

            {/* Input */}
            <div className="px-4 py-3 border-t border-stone-200 flex-shrink-0">
              <div className="flex items-end gap-2">
                <textarea
                  value={sandboxInput}
                  onChange={(e) => setSandboxInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void sendSandboxMessage();
                    }
                  }}
                  placeholder="Simula un mensaje del paciente…"
                  rows={2}
                  className={
                    "flex-1 resize-none rounded-xl border border-stone-200 px-3 py-2 text-sm text-slate-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent"
                  }
                />
                <button
                  onClick={() => void sendSandboxMessage()}
                  disabled={sandboxLoading || !sandboxInput.trim()}
                  className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-xl bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40 transition-colors"
                >
                  <PaperPlaneTilt size={15} weight="fill" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Reusable style helpers ────────────────────────────────────────────────────

const inputCls =
  "w-full rounded-lg border border-stone-200 px-3 py-2 text-sm text-slate-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent transition-shadow bg-white";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-stone-200 p-5">
      <h2 className="text-sm font-semibold text-slate-800 mb-4">{title}</h2>
      {children}
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-stone-500 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}
