// Generado manualmente a partir de supabase/migrations/20260101000000_initial_schema.sql
// Reemplazar con: supabase gen types typescript --project-id <id> > lib/database.types.ts

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          name: string;
          slug: string;
          timezone: string;
          business_type: string;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          timezone?: string;
          business_type?: string;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          timezone?: string;
          business_type?: string;
          created_at?: string | null;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          organization_id: string | null;
          full_name: string | null;
          role: string | null;
          created_at: string | null;
        };
        Insert: {
          id: string;
          organization_id?: string | null;
          full_name?: string | null;
          role?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string | null;
          full_name?: string | null;
          role?: string | null;
          created_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey";
            columns: ["id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profiles_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      whatsapp_configs: {
        Row: {
          organization_id: string;
          phone_number_id: string;
          waba_id: string;
          access_token_encrypted: string;
          verify_token: string;
          app_secret_encrypted: string;
          updated_at: string | null;
        };
        Insert: {
          organization_id: string;
          phone_number_id: string;
          waba_id: string;
          access_token_encrypted: string;
          verify_token: string;
          app_secret_encrypted: string;
          updated_at?: string | null;
        };
        Update: {
          organization_id?: string;
          phone_number_id?: string;
          waba_id?: string;
          access_token_encrypted?: string;
          verify_token?: string;
          app_secret_encrypted?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "whatsapp_configs_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      google_calendar_configs: {
        Row: {
          organization_id: string;
          calendar_id: string;
          refresh_token_encrypted: string;
          access_token_encrypted: string | null;
          token_expires_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          organization_id: string;
          calendar_id: string;
          refresh_token_encrypted: string;
          access_token_encrypted?: string | null;
          token_expires_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          organization_id?: string;
          calendar_id?: string;
          refresh_token_encrypted?: string;
          access_token_encrypted?: string | null;
          token_expires_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "google_calendar_configs_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      agent_configs: {
        Row: {
          organization_id: string;
          system_prompt: string;
          tone: string;
          business_info: Json;
          services: Json;
          business_hours: Json;
          handoff_message: string | null;
          confirmation_template: string | null;
          assistant_name: string | null;
          updated_at: string | null;
        };
        Insert: {
          organization_id: string;
          system_prompt: string;
          tone?: string;
          business_info?: Json;
          services?: Json;
          business_hours?: Json;
          handoff_message?: string | null;
          confirmation_template?: string | null;
          assistant_name?: string | null;
          updated_at?: string | null;
        };
        Update: {
          organization_id?: string;
          system_prompt?: string;
          tone?: string;
          business_info?: Json;
          services?: Json;
          business_hours?: Json;
          handoff_message?: string | null;
          confirmation_template?: string | null;
          assistant_name?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "agent_configs_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      contacts: {
        Row: {
          id: string;
          organization_id: string;
          wa_phone: string;
          full_name: string | null;
          is_new_patient: boolean | null;
          has_allergies: boolean | null;
          allergy_notes: string | null;
          takes_anticoagulants: boolean | null;
          medical_notes: string | null;
          metadata: Json | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          wa_phone: string;
          full_name?: string | null;
          is_new_patient?: boolean | null;
          has_allergies?: boolean | null;
          allergy_notes?: string | null;
          takes_anticoagulants?: boolean | null;
          medical_notes?: string | null;
          metadata?: Json | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          wa_phone?: string;
          full_name?: string | null;
          is_new_patient?: boolean | null;
          has_allergies?: boolean | null;
          allergy_notes?: string | null;
          takes_anticoagulants?: boolean | null;
          medical_notes?: string | null;
          metadata?: Json | null;
          created_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "contacts_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      conversations: {
        Row: {
          id: string;
          organization_id: string;
          contact_id: string;
          bot_active: boolean | null;
          booking_state: string | null;
          booking_data: Json | null;
          last_message_at: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          contact_id: string;
          bot_active?: boolean | null;
          booking_state?: string | null;
          booking_data?: Json | null;
          last_message_at?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          contact_id?: string;
          bot_active?: boolean | null;
          booking_state?: string | null;
          booking_data?: Json | null;
          last_message_at?: string | null;
          created_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "conversations_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversations_contact_id_fkey";
            columns: ["contact_id"];
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          id: string;
          conversation_id: string;
          organization_id: string;
          wa_message_id: string | null;
          direction: string;
          sender: string;
          content: string | null;
          raw: Json | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          organization_id: string;
          wa_message_id?: string | null;
          direction: string;
          sender: string;
          content?: string | null;
          raw?: Json | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          organization_id?: string;
          wa_message_id?: string | null;
          direction?: string;
          sender?: string;
          content?: string | null;
          raw?: Json | null;
          created_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey";
            columns: ["conversation_id"];
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      appointments: {
        Row: {
          id: string;
          organization_id: string;
          contact_id: string;
          service: string;
          starts_at: string;
          ends_at: string;
          google_event_id: string | null;
          status: string | null;
          is_new_patient: boolean | null;
          is_urgent: boolean | null;
          full_name: string;
          phone: string;
          notes: string | null;
          medical_notes: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          contact_id: string;
          service: string;
          starts_at: string;
          ends_at: string;
          google_event_id?: string | null;
          status?: string | null;
          is_new_patient?: boolean | null;
          is_urgent?: boolean | null;
          full_name: string;
          phone: string;
          notes?: string | null;
          medical_notes?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          contact_id?: string;
          service?: string;
          starts_at?: string;
          ends_at?: string;
          google_event_id?: string | null;
          status?: string | null;
          is_new_patient?: boolean | null;
          is_urgent?: boolean | null;
          full_name?: string;
          phone?: string;
          notes?: string | null;
          medical_notes?: string | null;
          created_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "appointments_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "appointments_contact_id_fkey";
            columns: ["contact_id"];
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

// ---- Helper types (equivalentes a los que genera supabase gen types) ----

type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Row"];

export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"];

export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"];

// Aliases de conveniencia para los tipos de Row más usados
export type Organization = Tables<"organizations">;
export type Profile = Tables<"profiles">;
export type WhatsappConfig = Tables<"whatsapp_configs">;
export type GoogleCalendarConfig = Tables<"google_calendar_configs">;
export type AgentConfig = Tables<"agent_configs">;
export type Contact = Tables<"contacts">;
export type Conversation = Tables<"conversations">;
export type Message = Tables<"messages">;
export type Appointment = Tables<"appointments">;
