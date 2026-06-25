import Link from "next/link";
import {
  WhatsappLogo,
  CalendarCheck,
  ImageSquare,
  Microphone,
  Robot,
  ArrowRight,
  Check,
} from "@phosphor-icons/react/dist/ssr";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-stone-50 text-slate-900">

      {/* ── Nav ──────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 bg-stone-50/90 backdrop-blur border-b border-stone-200">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-teal-700 flex items-center justify-center">
              <Robot size={15} weight="fill" className="text-white" />
            </span>
            <span className="font-semibold text-slate-900 tracking-tight">ASDent</span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors px-3 py-1.5"
            >
              Iniciar sesión
            </Link>
            <Link
              href="/signup"
              className="text-sm font-medium bg-teal-700 text-white px-4 py-1.5 rounded-lg hover:bg-teal-800 transition-colors"
            >
              Crear cuenta
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-6 pt-20 pb-24 text-center">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 bg-teal-50 border border-teal-200 text-teal-700 text-xs font-semibold px-3 py-1 rounded-full mb-8">
          <WhatsappLogo size={13} weight="fill" />
          Agendamiento automático por WhatsApp
        </div>

        {/* Headline */}
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-slate-900 leading-tight max-w-3xl mx-auto">
          Tu clínica dental atiende y agenda{" "}
          <span className="text-teal-700">sola, las 24 horas</span>
        </h1>

        <p className="mt-6 text-lg text-stone-500 max-w-xl mx-auto leading-relaxed">
          Un agente de inteligencia artificial gestiona las conversaciones de
          WhatsApp, agenda citas en Google Calendar y detecta urgencias —
          sin intervención humana.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/signup"
            className="flex items-center gap-2 bg-teal-700 text-white font-semibold px-7 py-3 rounded-xl hover:bg-teal-800 transition-colors text-sm shadow-sm shadow-teal-900/10"
          >
            Crear cuenta gratis
            <ArrowRight size={15} weight="bold" />
          </Link>
          <Link
            href="/login"
            className="flex items-center gap-2 border border-stone-300 text-slate-700 font-medium px-7 py-3 rounded-xl hover:bg-white hover:border-stone-400 transition-colors text-sm"
          >
            Iniciar sesión
          </Link>
        </div>

        {/* Social proof strip */}
        <p className="mt-8 text-xs text-stone-400">
          Sin tarjeta de crédito · Configuración en menos de 15 minutos · Cancela cuando quieras
        </p>

        {/* Hero visual */}
        <div className="mt-14 relative max-w-2xl mx-auto">
          <div className="bg-white rounded-2xl border border-stone-200 shadow-xl shadow-stone-900/5 overflow-hidden">
            {/* Mock chat header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-stone-100 bg-stone-50">
              <div className="w-8 h-8 rounded-full bg-teal-700 flex items-center justify-center">
                <Robot size={15} weight="fill" className="text-white" />
              </div>
              <div className="text-left">
                <p className="text-xs font-semibold text-slate-800">Asistente — Clínica Dental</p>
                <p className="text-[10px] text-teal-600 font-medium">En línea</p>
              </div>
            </div>
            {/* Mock messages */}
            <div className="px-4 py-4 space-y-3 text-left">
              <ChatBubble side="left" text="Hola, me duele mucho una muela desde ayer. ¿Tienen cita para hoy?" />
              <ChatBubble
                side="right"
                text="¡Hola! Entiendo que estás con dolor — eso es urgente. Tenemos disponibilidad hoy a las 4:30 p.m. ¿Te funciona ese horario?"
              />
              <ChatBubble side="left" text="Sí, perfecto." />
              <ChatBubble
                side="right"
                text="Listo. Tu cita queda confirmada para hoy a las 4:30 p.m. Te esperamos. ¿Tienes alguna alergia a medicamentos que debamos saber?"
              />
            </div>
            {/* Mock input */}
            <div className="px-4 py-3 border-t border-stone-100 bg-stone-50 flex items-center gap-2">
              <div className="flex-1 h-8 rounded-lg bg-white border border-stone-200 text-xs text-stone-300 flex items-center px-3">
                Escribe un mensaje…
              </div>
              <div className="w-8 h-8 rounded-lg bg-teal-700 flex items-center justify-center flex-shrink-0">
                <ArrowRight size={13} weight="bold" className="text-white" />
              </div>
            </div>
          </div>
          {/* Floating badge */}
          <div className="absolute -top-3 -right-3 sm:right-4 bg-teal-700 text-white text-[11px] font-semibold px-3 py-1.5 rounded-full shadow-lg flex items-center gap-1.5">
            <CalendarCheck size={12} weight="fill" />
            Cita agendada en Google Calendar
          </div>
        </div>
      </section>

      {/* ── Beneficios ───────────────────────────────────────── */}
      <section className="bg-white border-y border-stone-200">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <p className="text-center text-xs font-semibold uppercase tracking-widest text-stone-400 mb-12">
            Por qué ASDent
          </p>
          <div className="grid sm:grid-cols-3 gap-8">
            <BenefitCard
              icon={<WhatsappLogo size={22} weight="fill" className="text-teal-700" />}
              title="Responde 24/7"
              description="El agente atiende mensajes de madrugada, fines de semana y festivos. Ningún paciente queda sin respuesta por falta de personal."
            />
            <BenefitCard
              icon={<CalendarCheck size={22} weight="fill" className="text-teal-700" />}
              title="Agenda en Google Calendar"
              description="Cada cita confirmada aparece automáticamente en tu calendario con el nombre del paciente, servicio y notas clínicas relevantes."
            />
            <BenefitCard
              icon={<ImageSquare size={22} weight="fill" className="text-teal-700" />}
              title="Entiende fotos, audios y documentos"
              description="El agente procesa imágenes de radiografías, transcribe audios del paciente y lee PDFs de historias clínicas para dar contexto real."
            />
          </div>
        </div>
      </section>

      {/* ── Cómo funciona ─────────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-6 py-20">
        <p className="text-center text-xs font-semibold uppercase tracking-widest text-stone-400 mb-3">
          Cómo funciona
        </p>
        <h2 className="text-center text-2xl sm:text-3xl font-bold text-slate-900 mb-14">
          Tres pasos, cero fricción
        </h2>

        <div className="grid sm:grid-cols-3 gap-6 relative">
          {/* Connector line (desktop) */}
          <div className="hidden sm:block absolute top-8 left-[calc(33%+1rem)] right-[calc(33%+1rem)] h-px bg-stone-200" />

          <StepCard
            number="1"
            icon={<WhatsappLogo size={20} weight="fill" className="text-teal-700" />}
            title="El paciente escribe por WhatsApp"
            description="El paciente envía un mensaje al número de WhatsApp de la clínica, en cualquier momento del día."
          />
          <StepCard
            number="2"
            icon={<Robot size={20} weight="fill" className="text-teal-700" />}
            title="El agente IA atiende y agenda"
            description="El agente saluda, detecta si es urgencia, recolecta los datos necesarios y confirma la cita — todo en la misma conversación."
          />
          <StepCard
            number="3"
            icon={<CalendarCheck size={20} weight="fill" className="text-teal-700" />}
            title="La cita aparece en tu calendario"
            description="La cita se crea en Google Calendar y queda visible en el panel web de la clínica, lista para el día de la consulta."
          />
        </div>
      </section>

      {/* ── Features detalle ─────────────────────────────────── */}
      <section className="bg-teal-700">
        <div className="max-w-5xl mx-auto px-6 py-16">
          <div className="grid sm:grid-cols-2 gap-x-16 gap-y-10 items-center">
            <div>
              <h2 className="text-2xl sm:text-3xl font-bold text-white leading-tight mb-4">
                Todo lo que necesita una clínica dental moderna
              </h2>
              <p className="text-teal-200 text-sm leading-relaxed mb-8">
                ASDent no es un chatbot genérico. Fue diseñado específicamente
                para odontología, con lógica que entiende urgencias, tiempos de
                procedimiento y datos clínicos relevantes.
              </p>
              <ul className="space-y-3">
                {[
                  "Detección automática de urgencias dentales",
                  "Duración de cita según el servicio",
                  "Recolecta alergias y medicamentos pre-cita",
                  "Panel en tiempo real para el dueño de la clínica",
                  "Traspaso a humano con un clic",
                  "Soporte de imágenes, audios y radiografías",
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-teal-100">
                    <Check size={15} weight="bold" className="text-teal-300 mt-0.5 flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>

            {/* Mini dashboard mock */}
            <div className="bg-white/10 rounded-2xl border border-white/20 p-4 space-y-3">
              <p className="text-xs font-semibold text-teal-200 uppercase tracking-widest mb-4">
                Panel de control
              </p>
              {[
                { label: "Conversaciones (30 días)", value: "47", color: "bg-teal-400" },
                { label: "Citas confirmadas esta semana", value: "12", color: "bg-sky-400" },
                { label: "Urgencias (7 días)", value: "3", color: "bg-red-400" },
              ].map((kpi) => (
                <div key={kpi.label} className="flex items-center gap-3 bg-white/10 rounded-xl px-4 py-3">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${kpi.color}`} />
                  <p className="flex-1 text-xs text-teal-100">{kpi.label}</p>
                  <p className="text-lg font-bold text-white">{kpi.value}</p>
                </div>
              ))}
              <div className="bg-amber-400/20 border border-amber-400/30 rounded-xl px-4 py-3 flex items-center gap-2.5 mt-2">
                <div className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
                <p className="text-xs text-amber-200 flex-1">2 conversaciones esperando atención humana</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Multimodal callout ────────────────────────────────── */}
      <section className="bg-white border-y border-stone-200">
        <div className="max-w-5xl mx-auto px-6 py-16 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-3">
            Más que texto
          </p>
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-4">
            El agente ve, escucha y lee
          </h2>
          <p className="text-stone-500 text-sm max-w-lg mx-auto mb-10">
            Los pacientes no siempre pueden describir su problema con palabras.
            ASDent procesa cualquier tipo de archivo que llegue por WhatsApp.
          </p>
          <div className="grid sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
            <div className="bg-stone-50 border border-stone-200 rounded-2xl p-5 text-left">
              <ImageSquare size={24} weight="fill" className="text-teal-700 mb-3" />
              <p className="text-sm font-semibold text-slate-800 mb-1">Imágenes</p>
              <p className="text-xs text-stone-500 leading-relaxed">
                Fotos de dientes, radiografías, resultados. Claude las analiza con visión nativa.
              </p>
            </div>
            <div className="bg-stone-50 border border-stone-200 rounded-2xl p-5 text-left">
              <Microphone size={24} weight="fill" className="text-teal-700 mb-3" />
              <p className="text-sm font-semibold text-slate-800 mb-1">Audios</p>
              <p className="text-xs text-stone-500 leading-relaxed">
                Mensajes de voz transcritos automáticamente con OpenAI Whisper antes de procesarlos.
              </p>
            </div>
            <div className="bg-stone-50 border border-stone-200 rounded-2xl p-5 text-left">
              <Robot size={24} weight="fill" className="text-teal-700 mb-3" />
              <p className="text-sm font-semibold text-slate-800 mb-1">PDFs</p>
              <p className="text-xs text-stone-500 leading-relaxed">
                Historias clínicas y documentos leídos y resumidos como contexto para la cita.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA final ────────────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-6 py-24 text-center">
        <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
          Tu clínica, trabajando mientras descansas
        </h2>
        <p className="text-stone-500 text-base max-w-md mx-auto mb-10">
          Configura ASDent en 15 minutos. Sin contrato, sin tarjeta de
          crédito. El primer mes es tuyo para probar.
        </p>
        <Link
          href="/signup"
          className="inline-flex items-center gap-2 bg-teal-700 text-white font-semibold px-8 py-3.5 rounded-xl hover:bg-teal-800 transition-colors text-sm shadow-sm shadow-teal-900/10"
        >
          Comenzar ahora
          <ArrowRight size={15} weight="bold" />
        </Link>
        <p className="mt-4 text-xs text-stone-400">
          ¿Ya tienes cuenta?{" "}
          <Link href="/login" className="text-teal-700 hover:underline font-medium">
            Inicia sesión
          </Link>
        </p>
      </section>

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer className="border-t border-stone-200 bg-stone-50">
        <div className="max-w-5xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 rounded bg-teal-700 flex items-center justify-center">
              <Robot size={11} weight="fill" className="text-white" />
            </span>
            <span className="text-xs font-semibold text-slate-600">ASDent</span>
          </div>
          <p className="text-xs text-stone-400">
            Agente IA para clínicas dentales · Hecho en Colombia
          </p>
        </div>
      </footer>
    </div>
  );
}

// ─── Helper components ────────────────────────────────────────────────────────

function ChatBubble({ side, text }: { side: "left" | "right"; text: string }) {
  return (
    <div className={`flex ${side === "right" ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] px-3 py-2 rounded-xl text-xs leading-relaxed ${
          side === "right"
            ? "bg-teal-700 text-white rounded-br-sm"
            : "bg-stone-100 text-slate-700 rounded-bl-sm"
        }`}
      >
        {text}
      </div>
    </div>
  );
}

function BenefitCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="w-10 h-10 rounded-xl bg-teal-50 border border-teal-100 flex items-center justify-center">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      <p className="text-sm text-stone-500 leading-relaxed">{description}</p>
    </div>
  );
}

function StepCard({
  number,
  icon,
  title,
  description,
}: {
  number: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="relative bg-white border border-stone-200 rounded-2xl p-6 text-center shadow-sm">
      <div className="w-10 h-10 rounded-full bg-teal-700 text-white font-bold text-sm flex items-center justify-center mx-auto mb-4 z-10 relative">
        {number}
      </div>
      <div className="flex justify-center mb-3">{icon}</div>
      <h3 className="text-sm font-semibold text-slate-900 mb-2">{title}</h3>
      <p className="text-xs text-stone-500 leading-relaxed">{description}</p>
    </div>
  );
}
