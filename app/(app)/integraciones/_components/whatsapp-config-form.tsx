"use client";

import { useActionState, useTransition, useState } from "react";
import { Copy, Check, CheckCircle, XCircle } from "@phosphor-icons/react";
import {
  saveWhatsappConfigAction,
  testWhatsappConnectionAction,
  type IntegrationState,
} from "@/lib/actions/integrations";
import type { WhatsappConfig } from "@/lib/database.types";

type ConfigPreview = Pick<WhatsappConfig, "phone_number_id" | "waba_id" | "verify_token">;

interface WhatsappConfigFormProps {
  config: ConfigPreview | null;
  webhookUrl: string;
}

export function WhatsappConfigForm({ config, webhookUrl }: WhatsappConfigFormProps) {
  const [saveState, saveAction, savePending] = useActionState(
    saveWhatsappConfigAction,
    {}
  );
  const [testResult, setTestResult] = useState<IntegrationState | null>(null);
  const [testPending, startTest] = useTransition();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTest = () => {
    setTestResult(null);
    startTest(async () => {
      const result = await testWhatsappConnectionAction();
      setTestResult(result);
    });
  };

  return (
    <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-stone-100 flex items-center gap-3">
        <div
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            config ? "bg-teal-500" : "bg-stone-300"
          }`}
        />
        <div>
          <h2 className="text-base font-semibold text-slate-800">
            WhatsApp Business
          </h2>
          <p className="text-xs text-stone-400 mt-0.5">
            {config
              ? "Configurado — deja el token y secret vacíos para mantener los actuales"
              : "Sin configurar — ingresa tus credenciales de Meta Developer"}
          </p>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Webhook URL */}
        <div>
          <p className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-2">
            URL del Webhook
          </p>
          <div className="flex items-center gap-2 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2.5">
            <code className="flex-1 text-sm text-slate-700 truncate select-all">
              {webhookUrl}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="flex-shrink-0 p-1 rounded text-stone-400 hover:text-slate-700 transition-colors"
              title="Copiar URL"
            >
              {copied ? (
                <Check size={15} className="text-teal-600" />
              ) : (
                <Copy size={15} />
              )}
            </button>
          </div>
          <p className="text-xs text-stone-400 mt-1.5">
            Registra esta URL en la sección Webhooks de tu app de Meta. Callback URL = esta URL.
          </p>
        </div>

        {/* Form */}
        <form action={saveAction} className="space-y-4">
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Phone Number ID
              </label>
              <input
                name="phone_number_id"
                type="text"
                required
                defaultValue={config?.phone_number_id ?? ""}
                placeholder="1234567890123"
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                WABA ID
              </label>
              <input
                name="waba_id"
                type="text"
                required
                defaultValue={config?.waba_id ?? ""}
                placeholder="9876543210987"
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Verify Token
            </label>
            <input
              name="verify_token"
              type="text"
              required
              defaultValue={config?.verify_token ?? ""}
              placeholder="mi_token_secreto_123"
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
            <p className="text-xs text-stone-400 mt-1">
              String secreto que colocas en el campo &quot;Verify Token&quot; de Meta al registrar el webhook.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              System User Access Token
            </label>
            <input
              name="access_token"
              type="password"
              placeholder={
                config
                  ? "●●●●●●●●●●●● Dejar vacío para mantener el actual"
                  : "EAAxxxxxxx..."
              }
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              App Secret
            </label>
            <input
              name="app_secret"
              type="password"
              placeholder={
                config
                  ? "●●●●●●●●●●●● Dejar vacío para mantener el actual"
                  : "abc123def456..."
              }
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
            <p className="text-xs text-stone-400 mt-1">
              Se cifra con AES-256-GCM antes de guardarse. Nunca se expone al browser.
            </p>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={savePending}
              className="px-4 py-2.5 bg-teal-700 text-white text-sm font-medium rounded-lg hover:bg-teal-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {savePending ? "Guardando..." : "Guardar configuración"}
            </button>

            {config && (
              <button
                type="button"
                onClick={handleTest}
                disabled={testPending}
                className="px-4 py-2.5 border border-stone-300 text-sm font-medium text-slate-700 rounded-lg hover:bg-stone-50 disabled:opacity-50 transition-colors"
              >
                {testPending ? "Probando..." : "Probar conexión"}
              </button>
            )}
          </div>
        </form>

        {/* Test result (outside the form) */}
        {testResult && (
          <p
            className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${
              testResult.success
                ? "text-teal-700 bg-teal-50"
                : "text-red-600 bg-red-50"
            }`}
          >
            {testResult.success ? (
              <CheckCircle size={15} className="flex-shrink-0" />
            ) : (
              <XCircle size={15} className="flex-shrink-0" />
            )}
            {testResult.success ? testResult.message : testResult.error}
          </p>
        )}
      </div>
    </div>
  );
}
