// Generated from the database with Supabase's type generator, against this
// project's `public` schema. Regenerate it after every migration; a hand edit
// here drifts from the schema without anything noticing, which is the same
// failure as a column that exists in one of the two places and not the other.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      analyses: {
        Row: {
          coverage_json: Json | null
          adapter: string | null
          created_at: string
          error_detail: string | null
          frontend: string | null
          head_sha: string | null
          id: string
          organization_id: string
          project_id: string
          stage: string
          stage_message: string | null
          status: string
        }
        Insert: {
          adapter?: string | null
          coverage_json?: Json | null
          created_at?: string
          error_detail?: string | null
          frontend?: string | null
          head_sha?: string | null
          id?: string
          organization_id: string
          project_id: string
          stage?: string
          stage_message?: string | null
          status?: string
        }
        Update: {
          adapter?: string | null
          coverage_json?: Json | null
          created_at?: string
          error_detail?: string | null
          frontend?: string | null
          head_sha?: string | null
          id?: string
          organization_id?: string
          project_id?: string
          stage?: string
          stage_message?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "analyses_project_id_organization_id_fkey"
            columns: ["project_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      edges: {
        Row: {
          analysis_id: string
          from_file_id: string
          id: string
          kind: string
          organization_id: string
          specifier: string
          to_file_id: string
        }
        Insert: {
          analysis_id: string
          from_file_id: string
          id?: string
          kind: string
          organization_id: string
          specifier: string
          to_file_id: string
        }
        Update: {
          analysis_id?: string
          from_file_id?: string
          id?: string
          kind?: string
          organization_id?: string
          specifier?: string
          to_file_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "edges_analysis_id_organization_id_fkey"
            columns: ["analysis_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "edges_from_file_id_organization_id_fkey"
            columns: ["from_file_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "edges_to_file_id_organization_id_fkey"
            columns: ["to_file_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      explanations: {
        Row: {
          body: string
          file_id: string
          id: string
          organization_id: string
        }
        Insert: {
          body: string
          file_id: string
          id?: string
          organization_id: string
        }
        Update: {
          body?: string
          file_id?: string
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "explanations_file_id_organization_id_fkey"
            columns: ["file_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      file_roles: {
        Row: {
          file_id: string
          id: string
          organization_id: string
          role: string
          source: string
        }
        Insert: {
          file_id: string
          id?: string
          organization_id: string
          role: string
          source?: string
        }
        Update: {
          file_id?: string
          id?: string
          organization_id?: string
          role?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "file_roles_file_id_organization_id_fkey"
            columns: ["file_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      files: {
        Row: {
          analysis_id: string
          flags: string[]
          id: string
          organization_id: string
          path: string
          role: string | null
        }
        Insert: {
          analysis_id: string
          flags?: string[]
          id?: string
          organization_id: string
          path: string
          role?: string | null
        }
        Update: {
          analysis_id?: string
          flags?: string[]
          id?: string
          organization_id?: string
          path?: string
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "files_analysis_id_organization_id_fkey"
            columns: ["analysis_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      insights: {
        Row: {
          analysis_id: string
          answer: string
          id: string
          organization_id: string
          question: string
        }
        Insert: {
          analysis_id: string
          answer: string
          id?: string
          organization_id: string
          question: string
        }
        Update: {
          analysis_id?: string
          answer?: string
          id?: string
          organization_id?: string
          question?: string
        }
        Relationships: [
          {
            foreignKeyName: "insights_analysis_id_organization_id_fkey"
            columns: ["analysis_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
        }
        Insert: {
          created_at?: string
          id: string
        }
        Update: {
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          created_at: string
          id: string
          name: string
          organization_id: string
          url: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          organization_id: string
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      routes: {
        Row: {
          analysis_id: string
          id: string
          method: string | null
          organization_id: string
          path: string
        }
        Insert: {
          analysis_id: string
          id?: string
          method?: string | null
          organization_id: string
          path: string
        }
        Update: {
          analysis_id?: string
          id?: string
          method?: string | null
          organization_id?: string
          path?: string
        }
        Relationships: [
          {
            foreignKeyName: "routes_analysis_id_organization_id_fkey"
            columns: ["analysis_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof (DefaultSchema["Enums"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"] &
        DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof (DefaultSchema["Enums"] & DefaultSchema["Views"])
    ? (DefaultSchema["Enums"] & DefaultSchema["Views"])[DefaultSchemaEnumNameOrOptions] extends {
        Enum: infer E
      }
      ? E
      : never
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"])
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const