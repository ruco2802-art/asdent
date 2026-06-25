"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CaretLeft,
  CaretRight,
  X,
  Warning,
  User,
  Clock,
  Phone,
  Clipboard,
} from "@phosphor-icons/react";
import { updateAppointmentStatusAction } from "@/lib/actions/appointments";

type Appt = {
  id: string;
  service: string;
  starts_at: string;
  ends_at: string;
  status: string | null;
  is_urgent: boolean | null;
  is_new_patient: boolean | null;
  full_name: string;
  phone: string;
  medical_notes: string | null;
};

const MONTH_NAMES = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];
const DAY_NAMES = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function buildCalendarDays(year: number, month: number): (number | null)[] {
  const firstDay = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekday = (firstDay.getDay() + 6) % 7; // Mon=0
  const days: (number | null)[] = Array<null>(firstWeekday).fill(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(d);
  while (days.length % 7 !== 0) days.push(null);
  return days;
}

function getLocalDay(isoString: string, tz: string): number {
  return parseInt(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, day: "numeric" }).format(
      new Date(isoString)
    )
  );
}

function fmtTime(isoString: string, tz: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(isoString));
}

function fmtFull(isoString: string, tz: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: tz,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(isoString));
}

const STATUS_MAP: Record<string, string> = {
  confirmed: "Confirmada",
  cancelled: "Cancelada",
  completed: "Completada",
};

interface Props {
  appointments: Appt[];
  timezone: string;
  year: number;
  month: number;
}

export function CalendarView({ appointments, timezone, year, month }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Appt | null>(null);
  const [isUpdating, startUpdate] = useTransition();
  const [updateError, setUpdateError] = useState<string | null>(null);

  const days = buildCalendarDays(year, month);
  const apptsByDay: Record<number, Appt[]> = {};
  for (const a of appointments) {
    const d = getLocalDay(a.starts_at, timezone);
    (apptsByDay[d] ??= []).push(a);
  }

  const today = new Date();
  const isCurrentMonth =
    today.getFullYear() === year && today.getMonth() + 1 === month;
  const todayDay = getLocalDay(today.toISOString(), timezone);

  function navigate(dir: -1 | 1) {
    const d = new Date(year, month - 1 + dir, 1);
    router.push(`/citas?year=${d.getFullYear()}&month=${d.getMonth() + 1}`);
  }

  function changeStatus(newStatus: string) {
    if (!selected) return;
    const id = selected.id;
    startUpdate(async () => {
      const fd = new FormData();
      fd.set("appointmentId", id);
      fd.set("status", newStatus);
      const res = await updateAppointmentStatusAction(fd);
      if (res?.error) {
        setUpdateError(res.error);
      } else {
        setSelected(null);
        router.refresh();
      }
    });
  }

  const confirmed = appointments.filter((a) => a.status === "confirmed").length;
  const urgent = appointments.filter(
    (a) => a.is_urgent && a.status === "confirmed"
  ).length;

  return (
    <div>
      {/* Summary */}
      <div className="flex items-center gap-3 mb-5 text-sm">
        <span className="text-stone-500">{appointments.length} citas este mes</span>
        <span className="text-stone-300">·</span>
        <span className="font-medium text-teal-600">{confirmed} confirmadas</span>
        {urgent > 0 && (
          <>
            <span className="text-stone-300">·</span>
            <span className="flex items-center gap-1 font-medium text-red-600">
              <Warning size={14} weight="fill" />
              {urgent} urgentes
            </span>
          </>
        )}
      </div>

      {/* Calendar card */}
      <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
        {/* Nav header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-100">
          <button
            onClick={() => navigate(-1)}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-stone-100 transition-colors"
          >
            <CaretLeft size={16} className="text-stone-600" />
          </button>
          <h2 className="text-sm font-semibold text-slate-800">
            {MONTH_NAMES[month - 1]} {year}
          </h2>
          <button
            onClick={() => navigate(1)}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-stone-100 transition-colors"
          >
            <CaretRight size={16} className="text-stone-600" />
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-stone-100 bg-stone-50">
          {DAY_NAMES.map((d) => (
            <div
              key={d}
              className="py-2 text-center text-[11px] font-medium text-stone-400 tracking-wide"
            >
              {d}
            </div>
          ))}
        </div>

        {/* Grid */}
        <div className="grid grid-cols-7">
          {days.map((day, idx) => {
            const dayAppts = day ? (apptsByDay[day] ?? []) : [];
            const isToday = isCurrentMonth && day === todayDay;
            const isWeekend = idx % 7 >= 5;
            const rowIdx = Math.floor(idx / 7);
            const totalRows = days.length / 7;

            return (
              <div
                key={idx}
                className={[
                  "min-h-[90px] p-1.5",
                  rowIdx < totalRows - 1 ? "border-b border-stone-100" : "",
                  idx % 7 < 6 ? "border-r border-stone-100" : "",
                  isWeekend ? "bg-stone-50/50" : "",
                ].join(" ")}
              >
                {day !== null && (
                  <>
                    <div
                      className={[
                        "w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-medium mb-1",
                        isToday
                          ? "bg-teal-600 text-white"
                          : "text-slate-500",
                      ].join(" ")}
                    >
                      {day}
                    </div>
                    <div className="space-y-0.5">
                      {dayAppts.slice(0, 3).map((a) => (
                        <button
                          key={a.id}
                          onClick={() => {
                            setSelected(a);
                            setUpdateError(null);
                          }}
                          className={[
                            "w-full text-left px-1.5 py-0.5 rounded text-[10px] font-medium truncate leading-tight hover:opacity-80 transition-opacity",
                            a.status === "cancelled"
                              ? "bg-stone-100 text-stone-400 line-through"
                              : a.status === "completed"
                              ? "bg-stone-100 text-stone-500"
                              : a.is_urgent
                              ? "bg-red-100 text-red-700 border border-red-200"
                              : "bg-teal-100 text-teal-700",
                          ].join(" ")}
                        >
                          {fmtTime(a.starts_at, timezone)}{" "}
                          {a.full_name.split(" ")[0]}
                        </button>
                      ))}
                      {dayAppts.length > 3 && (
                        <p className="text-[10px] text-stone-400 pl-1">
                          +{dayAppts.length - 3}
                        </p>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3">
        <span className="flex items-center gap-1.5 text-xs text-stone-500">
          <span className="w-3 h-3 rounded bg-teal-100 border border-teal-200 inline-block" />
          Confirmada
        </span>
        <span className="flex items-center gap-1.5 text-xs text-stone-500">
          <span className="w-3 h-3 rounded bg-red-100 border border-red-200 inline-block" />
          Urgencia
        </span>
        <span className="flex items-center gap-1.5 text-xs text-stone-500">
          <span className="w-3 h-3 rounded bg-stone-100 border border-stone-200 inline-block" />
          Cancelada / Completada
        </span>
      </div>

      {/* Modal */}
      {selected && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelected(null);
          }}
        >
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base font-semibold text-slate-900">
                    {selected.service}
                  </h3>
                  {selected.is_urgent && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 border border-red-200">
                      <Warning size={11} weight="fill" />
                      Urgencia
                    </span>
                  )}
                  {selected.is_new_patient && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                      Paciente nuevo
                    </span>
                  )}
                </div>
                <p className="text-xs text-stone-400 mt-0.5">
                  {STATUS_MAP[selected.status ?? "confirmed"] ?? selected.status}
                </p>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="flex-shrink-0 p-1.5 rounded-lg hover:bg-stone-100 transition-colors ml-2"
              >
                <X size={16} className="text-stone-500" />
              </button>
            </div>

            <div className="space-y-2.5 text-sm">
              <div className="flex items-center gap-2.5">
                <User size={15} className="text-stone-400 flex-shrink-0" />
                <span className="text-slate-700">{selected.full_name}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <Phone size={15} className="text-stone-400 flex-shrink-0" />
                <span className="text-slate-700">{selected.phone}</span>
              </div>
              <div className="flex items-start gap-2.5">
                <Clock size={15} className="text-stone-400 flex-shrink-0 mt-0.5" />
                <span className="text-slate-700 capitalize">
                  {fmtFull(selected.starts_at, timezone)}
                </span>
              </div>
              {selected.medical_notes && (
                <div className="flex items-start gap-2.5">
                  <Clipboard
                    size={15}
                    className="text-stone-400 flex-shrink-0 mt-0.5"
                  />
                  <span className="text-slate-600 text-xs leading-relaxed">
                    {selected.medical_notes}
                  </span>
                </div>
              )}
            </div>

            {selected.status === "confirmed" && (
              <div className="mt-5 flex gap-2.5">
                <button
                  onClick={() => changeStatus("completed")}
                  disabled={isUpdating}
                  className="flex-1 py-2 rounded-xl bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 disabled:opacity-50 transition-colors"
                >
                  Completar
                </button>
                <button
                  onClick={() => changeStatus("cancelled")}
                  disabled={isUpdating}
                  className="flex-1 py-2 rounded-xl border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 disabled:opacity-50 transition-colors"
                >
                  Cancelar
                </button>
              </div>
            )}
            {selected.status !== "confirmed" && (
              <div className="mt-5">
                <button
                  onClick={() => changeStatus("confirmed")}
                  disabled={isUpdating}
                  className="w-full py-2 rounded-xl border border-stone-200 text-stone-600 text-sm font-medium hover:bg-stone-50 disabled:opacity-50 transition-colors"
                >
                  Reactivar como Confirmada
                </button>
              </div>
            )}
            {updateError && (
              <p className="mt-2 text-xs text-red-500 text-center">
                {updateError}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
