"use client";

import { useActionState, useTransition, useState } from "react";
import { CalendarBlank, CheckCircle, XCircle } from "@phosphor-icons/react";
import {
  connectGoogleCalendarAction,
  saveCalendarIdAction,
  type IntegrationState,
} from "@/lib/actions/integrations";

export interface GoogleCalendarItem {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole?: string;
}

interface GoogleCalendarSectionProps {
  isConnected: boolean;
  calendars: GoogleCalendarItem[];
  selectedCalendarId: string | null;
  connectStatus?: string;
  connectReason?: string;
}

export function GoogleCalendarSection({
  isConnected,
  calendars,
  selectedCalendarId,
  connectStatus,
  connectReason,
}: GoogleCalendarSectionProps) {
  const [saveState, saveAction, savePending] = useActionState(
    saveCalendarIdAction,
    {}
  );
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectPending, startConnect] = useTransition();

  const handleConnect = () => {
    setConnectError(null);
    startConnect(async () => {
      const result = await connectGoogleCalendarAction();
      if ("url" in result) {
        window.location.href = result.url;
      } else {
        setConnectError(result.error ?? "Error al iniciar la conexión con Google");
      }
    });
  };

  const connectErrorMessage = (reason?: string) => {
    if (reason === "no_refresh_token")
      return "Google no devolvió refresh_token. Revoca el acceso en myaccount.google.com/permissions y vuelve a conectar.";
    if (reason === "csrf") return "Error de seguridad (nonce inválido). Intenta de nuevo.";
    if (reason === "token_exchange") return "Error al intercambiar el código con Google. Intenta de nuevo.";
    return "Error al conectar con Google. Intenta de nuevo.";
  };

  return (
    <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-stone-100 flex items-center gap-3">
        <div
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            isConnected ? "bg-teal-500" : "bg-stone-300"
          }`}
        />
        <div>
          <h2 className="text-base font-semibold text-slate-800">
            Google Calendar
          </h2>
          <p className="text-xs text-stone-400 mt-0.5">
            {isConnected
              ? "Conectado — el agente usará este calendario"
              : "Sin conectar — necesario para verificar disponibilidad y crear citas"}
          </p>
        </div>
      </div>

      <div className="p-6 space-y-5">
        {/* Flash messages desde URL params */}
        {connectStatus === "connected" && (
          <p className="flex items-center gap-2 text-sm text-teal-700 bg-teal-50 px-3 py-2 rounded-lg">
            <CheckCircle size={15} className="flex-shrink-0" />
            Google Calendar conectado. Selecciona el calendario que quieres usar.
          </p>
        )}
        {connectStatus === "error" && (
          <p className="flex items-center gap-2 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
            <XCircle size={15} className="flex-shrink-0" />
            {connectErrorMessage(connectReason)}
          </p>
        )}
        {connectError && (
          <p className="flex items-center gap-2 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
            <XCircle size={15} className="flex-shrink-0" />
            {connectError}
          </p>
        )}

        {!isConnected ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Conecta tu cuenta de Google para que el agente pueda consultar tu
              disponibilidad y agendar citas directamente en tu calendario.
            </p>
            <button
              type="button"
              onClick={handleConnect}
              disabled={connectPending}
              className="flex items-center gap-2.5 px-4 py-2.5 border border-stone-300 text-sm font-medium text-slate-700 rounded-lg hover:bg-stone-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <CalendarBlank size={17} className="text-slate-400" />
              {connectPending ? "Redirigiendo a Google..." : "Conectar con Google"}
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Calendar picker */}
            {saveState.error && (
              <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                {saveState.error}
              </p>
            )}
            {saveState.success && (
              <p className="flex items-center gap-2 text-sm text-teal-700 bg-teal-50 px-3 py-2 rounded-lg">
                <CheckCircle size={15} />
                {saveState.message}
              </p>
            )}

            <form action={saveAction}>
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Calendario activo
                  </label>
                  {calendars.length > 0 ? (
                    <select
                      name="calendar_id"
                      defaultValue={selectedCalendarId ?? "primary"}
                      className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                    >
                      {calendars.map((cal) => (
                        <option key={cal.id} value={cal.id}>
                          {cal.summary}
                          {cal.primary ? " (principal)" : ""}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-sm text-stone-400 py-2">
                      No se pudieron cargar los calendarios. El token puede haber expirado — reconecta tu cuenta.
                    </p>
                  )}
                </div>
                {calendars.length > 0 && (
                  <button
                    type="submit"
                    disabled={savePending}
                    className="px-4 py-2.5 bg-teal-700 text-white text-sm font-medium rounded-lg hover:bg-teal-800 disabled:opacity-50 transition-colors"
                  >
                    {savePending ? "Guardando..." : "Guardar"}
                  </button>
                )}
              </div>
            </form>

            {/* Reconnect */}
            <div className="pt-1 border-t border-stone-100">
              <button
                type="button"
                onClick={handleConnect}
                disabled={connectPending}
                className="text-sm text-stone-400 hover:text-slate-700 transition-colors disabled:opacity-50"
              >
                {connectPending ? "Redirigiendo..." : "Reconectar cuenta de Google"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
