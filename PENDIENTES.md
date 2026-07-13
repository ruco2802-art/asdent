# Pendientes del proyecto

Registrado el 2026-07-13. Lista de trabajo conocido, aún no implementado, para que quede visible en futuras sesiones.

---

## 1. Alerta automática de Google Calendar desconectado

**Prioridad: media-alta**

**Contexto:** en esta sesión, el token de Google Calendar de una organización murió de forma silenciosa (`invalid_grant`) y nadie se enteró durante días. Como consecuencia, `get_available_slots` dejó de poder confiar en Calendar para saber qué horarios estaban ocupados, lo que contribuyó a un doble-booking real (dos pacientes agendados a la misma hora). Ya existe un chequeo de respaldo contra la tabla `appointments` directamente (independiente de Calendar), pero nadie se entera hoy si la conexión de Calendar en sí se cae.

**Qué falta implementar:**
- Cuando una llamada a Google Calendar falle con `invalid_grant` o cualquier error de autenticación (en `lib/google-calendar.ts`, función `getGoogleCalendarContext` / `refreshAccessToken`), crear automáticamente una alerta en la tabla `alerts` con un tipo nuevo `calendar_disconnected`.
- Notificar al administrador por WhatsApp reutilizando el sistema de alertas ya existente (`lib/alerts.ts`, función `createAlert`).
- Mostrar un banner visible en el dashboard cuando la integración de Calendar esté caída, para que el equipo no dependa de revisar logs.

**Archivos relevantes:** `lib/google-calendar.ts`, `lib/alerts.ts`, `app/(app)/dashboard/page.tsx`.

---

## 2. Solapamiento de citas por duración de servicio

**Prioridad: media**

**Contexto:** ya existe un comentario `// TODO` en `lib/agent/tools/book-appointment.ts` marcando esto explícitamente.

**El problema:** la restricción `unique` agregada en la migración `20260713000000_appointment_double_booking_guard.sql` (índice `appointments_org_starts_at_active_unique`) solo compara `starts_at` exacto. Como los servicios tienen duraciones distintas, dos citas con horas de **inicio diferentes** que se solapan en el tiempo no se detectan como conflicto — ejemplo: una cita de 3:00pm de 60 minutos (termina 4:00pm) y otra de 3:30pm de 30 minutos, quedarían agendadas ambas sin ningún error, a pesar de solaparse.

**Qué falta implementar:** resolver comparando el rango completo `[starts_at, ends_at)` de la nueva cita contra los rangos de las citas activas existentes, no solo el instante de inicio. Probablemente requiere un `exclusion constraint` con el tipo `tstzrange` de Postgres (`EXCLUDE USING gist`), o una verificación a nivel de aplicación antes del insert, ya que un índice `unique` normal no puede expresar "rangos que se solapan".

**Archivos relevantes:** `lib/agent/tools/book-appointment.ts`, futura migración en `supabase/migrations/`.

---

## 3. Verificación formal de la app en Google Cloud

**Prioridad: baja**

**Contexto:** la app de Google Cloud está publicada en modo "En producción" pero sin verificación formal de Google. Esto tiene dos consecuencias conocidas:
- Las clínicas ven una pantalla de advertencia ("Google no ha verificado esta app") al conectar su Google Calendar — genera desconfianza y fricción en el onboarding.
- Los refresh tokens de cuentas no verificadas pueden tener comportamiento menos estable a largo plazo que los de una app verificada.

**Qué falta implementar:** completar el proceso de verificación de Google (requiere, entre otras cosas, una política de privacidad pública, un dominio verificado, y posiblemente una revisión manual de Google dado que el scope de Calendar es sensible). Vale la pena completarlo cuando haya varios clientes reales usando la integración, no es urgente para uno o dos clientes en fase de piloto.

**Archivos relevantes:** ninguno en el código — esto se gestiona desde Google Cloud Console → APIs & Services → OAuth consent screen.
