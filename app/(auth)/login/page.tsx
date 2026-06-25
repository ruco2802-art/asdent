"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { signInAction, sendMagicLinkAction } from "@/lib/actions/auth";

export default function LoginPage() {
  const [mode, setMode] = useState<"password" | "magic-link">("password");
  const [pwState, pwAction, pwPending] = useActionState(signInAction, {});
  const [mlState, mlAction, mlPending] = useActionState(
    sendMagicLinkAction,
    {}
  );

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold text-gray-900">Iniciar sesión</h1>
        <p className="mt-1 text-sm text-gray-500">
          ASDent — Panel de administración
        </p>
      </div>

      {mode === "password" ? (
        <form action={pwAction} className="space-y-4">
          {pwState.error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
              {pwState.error}
            </p>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Correo electrónico
            </label>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="correo@clinica.com"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Contraseña
            </label>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <button
            type="submit"
            disabled={pwPending}
            className="w-full bg-blue-600 text-white rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {pwPending ? "Iniciando sesión..." : "Iniciar sesión"}
          </button>
        </form>
      ) : (
        <form action={mlAction} className="space-y-4">
          {mlState.error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
              {mlState.error}
            </p>
          )}
          {mlState.success && (
            <p className="text-sm text-green-700 bg-green-50 px-3 py-2 rounded-lg">
              {mlState.message}
            </p>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Correo electrónico
            </label>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="correo@clinica.com"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <button
            type="submit"
            disabled={mlPending || mlState.success}
            className="w-full bg-blue-600 text-white rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {mlPending ? "Enviando..." : "Enviar enlace mágico"}
          </button>
        </form>
      )}

      <div className="mt-4 text-center">
        <button
          type="button"
          onClick={() =>
            setMode(mode === "password" ? "magic-link" : "password")
          }
          className="text-sm text-blue-600 hover:text-blue-700 underline underline-offset-2"
        >
          {mode === "password"
            ? "Iniciar con enlace mágico"
            : "Iniciar con contraseña"}
        </button>
      </div>

      <div className="mt-6 pt-6 border-t border-gray-100 text-center text-sm text-gray-500">
        ¿No tienes cuenta?{" "}
        <Link
          href="/signup"
          className="text-blue-600 hover:text-blue-700 font-medium"
        >
          Crear cuenta
        </Link>
      </div>
    </div>
  );
}
