# ASDent — Agente WhatsApp para Clínicas Dentales

SaaS multi-tenant que convierte WhatsApp en un sistema de agendamiento inteligente para clínicas dentales. Un agente IA (Claude Sonnet 4.6) gestiona las conversaciones, agenda citas, detecta urgencias y traspasa a humano cuando es necesario.

---

## Stack

| Capa | Tecnología |
|------|-----------|
| Framework | Next.js 16 (App Router, TypeScript strict) |
| UI | TailwindCSS v4, Phosphor Icons |
| Auth + DB | Supabase (PostgreSQL, RLS, Realtime) |
| IA | Anthropic Claude Sonnet 4.6 via AI SDK 6 |
| WhatsApp | Meta Cloud API (webhooks) |
| Calendario | Google Calendar API (OAuth 2.0) |
| Transcripción | OpenAI Whisper (audios de WhatsApp) |
| Cifrado | AES-256-GCM (tokens en BD) |
| Deploy | Vercel (Edge + Node runtimes) |

---

## Arquitectura

```
WhatsApp (Meta Cloud API)
        │ webhook POST /api/webhook/[orgId]
        ▼
Next.js API Route ──► enqueue background task
        │
        ▼ (background)
  Agent loop (AI SDK 6)
    ├─ check-availability tool   → Supabase appointments
    ├─ book-appointment tool     → Supabase + Google Calendar
    ├─ update-contact-info tool  → Supabase contacts
    └─ request-handoff tool      → bot_active = false
        │
        ▼
  sendWhatsAppMessage → Meta Cloud API
        │
        ▼
  Supabase Realtime → Dashboard (SSE to browser)
```

**Multi-tenancy**: Cada clínica es una `organization`. RLS en todas las tablas garantiza aislamiento total. El webhook usa `[orgId]` en la URL para enrutar al tenant correcto.

---

## Variables de entorno

Copia `.env.example` a `.env.local` y rellena todos los valores:

```bash
cp .env.example .env.local
```

| Variable | Descripción | Dónde obtenerla |
|----------|-------------|-----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave anon (pública) | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role (secreta, solo servidor) | Supabase → Settings → API |
| `ANTHROPIC_API_KEY` | API key de Anthropic | console.anthropic.com |
| `OPENAI_API_KEY` | API key de OpenAI (Whisper) | platform.openai.com/api-keys |
| `GOOGLE_CLIENT_ID` | Client ID OAuth 2.0 | Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | Client Secret OAuth 2.0 | Google Cloud Console |
| `GOOGLE_OAUTH_REDIRECT_URI` | URI de redirección registrada | Mismo que en Google Cloud Console |
| `ENCRYPTION_KEY` | 32 bytes en base64 para AES-256-GCM | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `NEXT_PUBLIC_APP_URL` | URL pública de la app | `http://localhost:3000` en dev |

---

## Setup local

### 1. Instalar dependencias

```bash
cd asdent
pnpm install
```

### 2. Crear proyecto Supabase

1. Ir a [app.supabase.com](https://app.supabase.com) → New project
2. En **SQL Editor**, ejecutar `supabase/migrations/20260101000000_initial_schema.sql`
3. En **Authentication → Providers → Email**, activar "Confirm email" = desactivado (dev)
4. Copiar URL y claves a `.env.local`

### 3. Habilitar Supabase Realtime

En el dashboard de Supabase → **Database → Replication → Supabase Realtime**:
- Activar las tablas: `conversations`, `messages`

### 4. Configurar Google OAuth (Calendar)

1. Google Cloud Console → APIs & Services → Credentials → Create OAuth 2.0 Client ID
2. Tipo: **Web application**
3. Authorized redirect URIs: `http://localhost:3000/api/auth/google/callback`
4. Habilitar **Google Calendar API**
5. Copiar Client ID y Secret a `.env.local`

### 5. Configurar Meta WhatsApp

1. Meta for Developers → Crear App → Business → WhatsApp
2. En **WhatsApp → Configuration → Webhook**:
   - URL: `https://tu-dominio/api/webhook/<organization-id>`
   - Verify token: cualquier string (el mismo que `verify_token` en `whatsapp_configs`)
   - Suscribir a: `messages`
3. En la app, ir a **Configuración de WhatsApp** y completar el formulario con el Phone Number ID, WABA ID, Access Token y App Secret

### 6. Arrancar en desarrollo

```bash
pnpm dev
```

Abre [http://localhost:3000](http://localhost:3000).

---

## Despliegue en Vercel

### 1. Push a GitHub/GitLab

Asegúrate de que `.gitignore` incluye `.env.local` (ya está configurado).

### 2. Importar proyecto en Vercel

1. [vercel.com/new](https://vercel.com/new) → Import Git repository
2. Framework: **Next.js** (detectado automáticamente)
3. Root directory: `asdent`

### 3. Variables de entorno en Vercel

En Vercel → Settings → Environment Variables, añadir todas las variables de `.env.example` con sus valores de producción:

- `GOOGLE_OAUTH_REDIRECT_URI` debe ser `https://tu-dominio.vercel.app/api/auth/google/callback`
- `NEXT_PUBLIC_APP_URL` debe ser `https://tu-dominio.vercel.app`

### 4. Actualizar URIs en Google Cloud Console

Añadir la URI de producción a los **Authorized redirect URIs** del OAuth client.

### 5. Actualizar webhook en Meta

Cambiar la URL del webhook a `https://tu-dominio.vercel.app/api/webhook/<organization-id>`.

---

## Flujo de onboarding de una clínica nueva

1. Registrar cuenta en `/register`
2. En `/configuracion-whatsapp`, completar las credenciales de la API de Meta
3. (Opcional) En `/configuracion-whatsapp`, conectar Google Calendar con OAuth
4. En `/personalizacion`, configurar el prompt del agente, servicios y horarios
5. Copiar la URL del webhook y configurarla en Meta for Developers

---

## Páginas principales

| Ruta | Descripción |
|------|-------------|
| `/` | Redirect a `/dashboard` o `/login` |
| `/login`, `/register` | Auth con Supabase |
| `/dashboard` | KPIs: conversaciones, citas, urgencias, handoffs |
| `/conversaciones` | Lista en tiempo real + detalle de conversación |
| `/conversaciones/[id]` | Mensajes, toggle bot/humano, respuesta manual |
| `/citas` | Calendario mensual de citas con modal de detalle |
| `/personalizacion` | Prompt, tono, servicios, horarios, sandbox de prueba |
| `/configuracion-whatsapp` | Credenciales Meta API + OAuth Google Calendar |

---

## API Routes

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/webhook/[orgId]` | Verificación del webhook de Meta |
| POST | `/api/webhook/[orgId]` | Recepción de mensajes de WhatsApp |
| POST | `/api/agent-sandbox` | Prueba del agente con prompt personalizado |
| GET | `/api/auth/google` | Inicio del flujo OAuth Google Calendar |
| GET | `/api/auth/google/callback` | Callback OAuth, guarda tokens cifrados |

---

## Seguridad

- **RLS en todas las tablas**: Cada usuario solo accede a los datos de su `organization_id`
- **Tokens cifrados con AES-256-GCM**: `whatsapp_configs.access_token_encrypted`, `google_calendar_configs.refresh_token_encrypted`, etc.
- **`SUPABASE_SERVICE_ROLE_KEY` solo en servidor**: Nunca expuesta al browser. Solo se usa en Server Actions y API Routes donde se necesita bypass de RLS
- **Webhook retorna 200 inmediatamente**: El procesamiento del mensaje se hace en background para cumplir el timeout de 20s de Meta
- **Verificación de propiedad en mutaciones**: Server Actions filtran por `organization_id` del usuario autenticado

---

## Soporte multimodal

El agente procesa automáticamente:

| Tipo | Procesamiento |
|------|--------------|
| Texto | Directo |
| Imagen | Enviada como imagen base64 a Claude (visión) |
| Audio (ogg/mp3) | Transcrito con Whisper → texto |
| Documento PDF | Extraído con pdf-parse → texto |
| Sticker | Ignorado silenciosamente |

---

## Estructura del proyecto

```
asdent/
├── app/
│   ├── (app)/              # Layout autenticado con sidebar
│   │   ├── dashboard/
│   │   ├── conversaciones/
│   │   ├── citas/
│   │   ├── personalizacion/
│   │   └── configuracion-whatsapp/
│   ├── (auth)/             # Login y registro
│   └── api/
│       ├── webhook/[orgId]/
│       ├── agent-sandbox/
│       └── auth/google/
├── lib/
│   ├── agent/
│   │   ├── tools/          # Herramientas del agente IA
│   │   └── run-agent.ts
│   ├── actions/            # Server Actions
│   ├── crypto.ts           # AES-256-GCM
│   ├── google-calendar.ts
│   ├── whatsapp.ts
│   └── database.types.ts
└── supabase/
    ├── migrations/
    └── seed.sql
```
