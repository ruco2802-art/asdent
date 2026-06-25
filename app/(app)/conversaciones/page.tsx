"use client";

import { ChatDots } from "@phosphor-icons/react";

export default function ConversacionesPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      <ChatDots size={48} weight="thin" className="text-stone-300" />
      <p className="mt-3 text-sm font-medium text-stone-500">
        Selecciona una conversación
      </p>
      <p className="mt-1 text-xs text-stone-400 max-w-xs">
        Elige un hilo de la lista para ver los mensajes y gestionar al
        paciente.
      </p>
    </div>
  );
}
