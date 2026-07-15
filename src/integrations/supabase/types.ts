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
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      addresses: {
        Row: {
          access_notes: string | null
          apartment: string | null
          area: string | null
          building: string | null
          city: string
          compound: string | null
          country: string
          created_at: string
          custom_label: string | null
          floor: string | null
          id: string
          is_default: boolean
          label: string
          landmark: string | null
          lat: number | null
          line1: string
          line2: string | null
          lng: number | null
          street: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_notes?: string | null
          apartment?: string | null
          area?: string | null
          building?: string | null
          city: string
          compound?: string | null
          country?: string
          created_at?: string
          custom_label?: string | null
          floor?: string | null
          id?: string
          is_default?: boolean
          label?: string
          landmark?: string | null
          lat?: number | null
          line1: string
          line2?: string | null
          lng?: number | null
          street?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_notes?: string | null
          apartment?: string | null
          area?: string | null
          building?: string | null
          city?: string
          compound?: string | null
          country?: string
          created_at?: string
          custom_label?: string | null
          floor?: string | null
          id?: string
          is_default?: boolean
          label?: string
          landmark?: string | null
          lat?: number | null
          line1?: string
          line2?: string | null
          lng?: number | null
          street?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string | null
          booking_id: string | null
          correlation_id: string | null
          created_at: string
          diff: Json | null
          entity: string
          entity_id: string | null
          id: string
          ip_address: unknown
          new_values: Json | null
          old_values: Json | null
          reason: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role?: string | null
          booking_id?: string | null
          correlation_id?: string | null
          created_at?: string
          diff?: Json | null
          entity: string
          entity_id?: string | null
          id?: string
          ip_address?: unknown
          new_values?: Json | null
          old_values?: Json | null
          reason?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: string | null
          booking_id?: string | null
          correlation_id?: string | null
          created_at?: string
          diff?: Json | null
          entity?: string
          entity_id?: string | null
          id?: string
          ip_address?: unknown
          new_values?: Json | null
          old_values?: Json | null
          reason?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_exceptions: {
        Row: {
          created_at: string
          date: string
          end_date: string | null
          end_time: string | null
          id: string
          is_blocked: boolean
          provider_id: string
          reason: string | null
          start_time: string | null
        }
        Insert: {
          created_at?: string
          date: string
          end_date?: string | null
          end_time?: string | null
          id?: string
          is_blocked?: boolean
          provider_id: string
          reason?: string | null
          start_time?: string | null
        }
        Update: {
          created_at?: string
          date?: string
          end_date?: string | null
          end_time?: string | null
          id?: string
          is_blocked?: boolean
          provider_id?: string
          reason?: string | null
          start_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "availability_exceptions_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_rules: {
        Row: {
          created_at: string
          end_time: string
          id: string
          provider_id: string
          start_time: string
          timezone: string
          weekday: number
        }
        Insert: {
          created_at?: string
          end_time: string
          id?: string
          provider_id: string
          start_time: string
          timezone?: string
          weekday: number
        }
        Update: {
          created_at?: string
          end_time?: string
          id?: string
          provider_id?: string
          start_time?: string
          timezone?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "availability_rules_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_cancellations: {
        Row: {
          booking_id: string
          cancelled_at: string
          cancelled_by_role: string
          cancelled_by_user_id: string
          id: string
          note: string | null
          previous_status: Database["public"]["Enums"]["booking_status"]
          reason_code: string
          reason_id: string | null
          reason_name_ar: string
          reason_name_en: string
        }
        Insert: {
          booking_id: string
          cancelled_at?: string
          cancelled_by_role: string
          cancelled_by_user_id: string
          id?: string
          note?: string | null
          previous_status: Database["public"]["Enums"]["booking_status"]
          reason_code: string
          reason_id?: string | null
          reason_name_ar: string
          reason_name_en: string
        }
        Update: {
          booking_id?: string
          cancelled_at?: string
          cancelled_by_role?: string
          cancelled_by_user_id?: string
          id?: string
          note?: string | null
          previous_status?: Database["public"]["Enums"]["booking_status"]
          reason_code?: string
          reason_id?: string | null
          reason_name_ar?: string
          reason_name_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_cancellations_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_cancellations_reason_id_fkey"
            columns: ["reason_id"]
            isOneToOne: false
            referencedRelation: "cancellation_reasons"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_family_member_snapshots: {
        Row: {
          access_notes: string | null
          allergies: string | null
          booking_id: string
          created_at: string
          date_of_birth: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          family_member_id: string | null
          full_name: string
          gender: string | null
          medical_notes: string | null
          phone: string | null
          relationship: string
          relationship_other: string | null
        }
        Insert: {
          access_notes?: string | null
          allergies?: string | null
          booking_id: string
          created_at?: string
          date_of_birth?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          family_member_id?: string | null
          full_name: string
          gender?: string | null
          medical_notes?: string | null
          phone?: string | null
          relationship: string
          relationship_other?: string | null
        }
        Update: {
          access_notes?: string | null
          allergies?: string | null
          booking_id?: string
          created_at?: string
          date_of_birth?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          family_member_id?: string | null
          full_name?: string
          gender?: string | null
          medical_notes?: string | null
          phone?: string | null
          relationship?: string
          relationship_other?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_family_member_snapshots_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_family_member_snapshots_family_member_id_fkey"
            columns: ["family_member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_locations: {
        Row: {
          access_notes: string | null
          address_id: string | null
          apartment: string | null
          area: string | null
          booking_id: string
          building: string | null
          city: string
          compound: string | null
          created_at: string
          custom_label: string | null
          floor: string | null
          label: string
          landmark: string | null
          lat: number
          lng: number
          street: string | null
          travel_fee: number | null
          zone_id: string | null
          zone_name_ar: string | null
          zone_name_en: string | null
        }
        Insert: {
          access_notes?: string | null
          address_id?: string | null
          apartment?: string | null
          area?: string | null
          booking_id: string
          building?: string | null
          city: string
          compound?: string | null
          created_at?: string
          custom_label?: string | null
          floor?: string | null
          label: string
          landmark?: string | null
          lat: number
          lng: number
          street?: string | null
          travel_fee?: number | null
          zone_id?: string | null
          zone_name_ar?: string | null
          zone_name_en?: string | null
        }
        Update: {
          access_notes?: string | null
          address_id?: string | null
          apartment?: string | null
          area?: string | null
          booking_id?: string
          building?: string | null
          city?: string
          compound?: string | null
          created_at?: string
          custom_label?: string | null
          floor?: string | null
          label?: string
          landmark?: string | null
          lat?: number
          lng?: number
          street?: string | null
          travel_fee?: number | null
          zone_id?: string | null
          zone_name_ar?: string | null
          zone_name_en?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_locations_address_id_fkey"
            columns: ["address_id"]
            isOneToOne: false
            referencedRelation: "addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_locations_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_locations_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_message_reads: {
        Row: {
          booking_id: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          booking_id: string
          last_read_at?: string
          user_id: string
        }
        Update: {
          booking_id?: string
          last_read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_message_reads_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_reminder_rules: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          lead_minutes: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          lead_minutes: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          lead_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      booking_reminders: {
        Row: {
          booking_id: string
          created_at: string
          id: string
          notification_id: string | null
          recipient_user_id: string
          rule_id: string
          scheduled_for: string
          status: string
          updated_at: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          id?: string
          notification_id?: string | null
          recipient_user_id: string
          rule_id: string
          scheduled_for: string
          status?: string
          updated_at?: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          id?: string
          notification_id?: string | null
          recipient_user_id?: string
          rule_id?: string
          scheduled_for?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_reminders_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_reminders_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_reminders_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "booking_reminder_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_requirement_selections: {
        Row: {
          booking_id: string
          chosen_by: string
          created_at: string
          extra_fee: number
          fulfillment_mode: string
          id: string
          name_ar: string
          name_en: string
          requirement_code: string
          requirement_id: string | null
        }
        Insert: {
          booking_id: string
          chosen_by: string
          created_at?: string
          extra_fee?: number
          fulfillment_mode: string
          id?: string
          name_ar: string
          name_en: string
          requirement_code: string
          requirement_id?: string | null
        }
        Update: {
          booking_id?: string
          chosen_by?: string
          created_at?: string
          extra_fee?: number
          fulfillment_mode?: string
          id?: string
          name_ar?: string
          name_en?: string
          requirement_code?: string
          requirement_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_requirement_selections_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_requirement_selections_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "service_requirements"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_reschedule_requests: {
        Row: {
          booking_id: string
          created_at: string
          id: string
          original_end_at: string
          original_start_at: string
          proposed_end_at: string
          proposed_start_at: string
          request_reason: string | null
          requested_at: string
          requested_by: string
          responded_at: string | null
          responded_by: string | null
          responds_to_id: string | null
          response_reason: string | null
          status: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          id?: string
          original_end_at: string
          original_start_at: string
          proposed_end_at: string
          proposed_start_at: string
          request_reason?: string | null
          requested_at?: string
          requested_by: string
          responded_at?: string | null
          responded_by?: string | null
          responds_to_id?: string | null
          response_reason?: string | null
          status?: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          id?: string
          original_end_at?: string
          original_start_at?: string
          proposed_end_at?: string
          proposed_start_at?: string
          request_reason?: string | null
          requested_at?: string
          requested_by?: string
          responded_at?: string | null
          responded_by?: string | null
          responds_to_id?: string | null
          response_reason?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_reschedule_requests_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_reschedule_requests_responds_to_id_fkey"
            columns: ["responds_to_id"]
            isOneToOne: false
            referencedRelation: "booking_reschedule_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_status_history: {
        Row: {
          booking_id: string
          changed_by: string | null
          created_at: string
          from_status: Database["public"]["Enums"]["booking_status"] | null
          id: string
          reason: string | null
          to_status: Database["public"]["Enums"]["booking_status"]
        }
        Insert: {
          booking_id: string
          changed_by?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["booking_status"] | null
          id?: string
          reason?: string | null
          to_status: Database["public"]["Enums"]["booking_status"]
        }
        Update: {
          booking_id?: string
          changed_by?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["booking_status"] | null
          id?: string
          reason?: string | null
          to_status?: Database["public"]["Enums"]["booking_status"]
        }
        Relationships: [
          {
            foreignKeyName: "booking_status_history_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          address_id: string | null
          arrival_confirmed_at: string | null
          arrival_confirmed_by: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          completion_requested_at: string | null
          coupon_id: string | null
          created_at: string
          currency: string
          customer_id: string
          deleted_at: string | null
          dispute_reason: string | null
          dispute_resolved_at: string | null
          dispute_resolved_by: string | null
          disputed_at: string | null
          end_at: string
          family_member_id: string | null
          id: string
          no_show_party: string | null
          no_show_reason: string | null
          no_show_reported_by: string | null
          notes: string | null
          payment_id: string | null
          price_discount: number
          price_extras_total: number
          price_platform_fee: number
          price_subtotal: number
          price_total: number
          price_travel_fee: number
          price_vat: number
          promo_code: string | null
          promo_code_id: string | null
          promo_description_ar: string | null
          promo_description_en: string | null
          promo_discount_type: string | null
          promo_discount_value: number | null
          provider_id: string
          requirement_selections: Json
          service_id: string
          start_at: string
          status: Database["public"]["Enums"]["booking_status"]
          status_changed_at: string | null
          status_changed_by: string | null
          updated_at: string
        }
        Insert: {
          address_id?: string | null
          arrival_confirmed_at?: string | null
          arrival_confirmed_by?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          completion_requested_at?: string | null
          coupon_id?: string | null
          created_at?: string
          currency?: string
          customer_id: string
          deleted_at?: string | null
          dispute_reason?: string | null
          dispute_resolved_at?: string | null
          dispute_resolved_by?: string | null
          disputed_at?: string | null
          end_at: string
          family_member_id?: string | null
          id?: string
          no_show_party?: string | null
          no_show_reason?: string | null
          no_show_reported_by?: string | null
          notes?: string | null
          payment_id?: string | null
          price_discount?: number
          price_extras_total?: number
          price_platform_fee?: number
          price_subtotal?: number
          price_total?: number
          price_travel_fee?: number
          price_vat?: number
          promo_code?: string | null
          promo_code_id?: string | null
          promo_description_ar?: string | null
          promo_description_en?: string | null
          promo_discount_type?: string | null
          promo_discount_value?: number | null
          provider_id: string
          requirement_selections?: Json
          service_id: string
          start_at: string
          status?: Database["public"]["Enums"]["booking_status"]
          status_changed_at?: string | null
          status_changed_by?: string | null
          updated_at?: string
        }
        Update: {
          address_id?: string | null
          arrival_confirmed_at?: string | null
          arrival_confirmed_by?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          completion_requested_at?: string | null
          coupon_id?: string | null
          created_at?: string
          currency?: string
          customer_id?: string
          deleted_at?: string | null
          dispute_reason?: string | null
          dispute_resolved_at?: string | null
          dispute_resolved_by?: string | null
          disputed_at?: string | null
          end_at?: string
          family_member_id?: string | null
          id?: string
          no_show_party?: string | null
          no_show_reason?: string | null
          no_show_reported_by?: string | null
          notes?: string | null
          payment_id?: string | null
          price_discount?: number
          price_extras_total?: number
          price_platform_fee?: number
          price_subtotal?: number
          price_total?: number
          price_travel_fee?: number
          price_vat?: number
          promo_code?: string | null
          promo_code_id?: string | null
          promo_description_ar?: string | null
          promo_description_en?: string | null
          promo_discount_type?: string | null
          promo_discount_value?: number | null
          provider_id?: string
          requirement_selections?: Json
          service_id?: string
          start_at?: string
          status?: Database["public"]["Enums"]["booking_status"]
          status_changed_at?: string | null
          status_changed_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_address_id_fkey"
            columns: ["address_id"]
            isOneToOne: false
            referencedRelation: "addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_family_member_id_fkey"
            columns: ["family_member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_promo_code_id_fkey"
            columns: ["promo_code_id"]
            isOneToOne: false
            referencedRelation: "promo_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      cancellation_reasons: {
        Row: {
          actor_type: string
          applicable_statuses: Database["public"]["Enums"]["booking_status"][]
          code: string
          created_at: string
          description_ar: string | null
          description_en: string | null
          display_order: number
          id: string
          is_active: boolean
          name_ar: string
          name_en: string
          requires_note: boolean
          updated_at: string
        }
        Insert: {
          actor_type: string
          applicable_statuses?: Database["public"]["Enums"]["booking_status"][]
          code: string
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name_ar: string
          name_en: string
          requires_note?: boolean
          updated_at?: string
        }
        Update: {
          actor_type?: string
          applicable_statuses?: Database["public"]["Enums"]["booking_status"][]
          code?: string
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name_ar?: string
          name_en?: string
          requires_note?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          created_at: string
          description_ar: string | null
          description_en: string | null
          icon: string | null
          id: string
          is_active: boolean
          name_ar: string
          name_en: string
          parent_id: string | null
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          name_ar: string
          name_en: string
          parent_id?: string | null
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          name_ar?: string
          name_en?: string
          parent_id?: string | null
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          booking_id: string
          created_at: string
          customer_id: string
          id: string
          provider_user_id: string
          updated_at: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          customer_id: string
          id?: string
          provider_user_id: string
          updated_at?: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          customer_id?: string
          id?: string
          provider_user_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      coupon_redemptions: {
        Row: {
          booking_id: string | null
          coupon_id: string
          id: string
          redeemed_at: string
          user_id: string
        }
        Insert: {
          booking_id?: string | null
          coupon_id: string
          id?: string
          redeemed_at?: string
          user_id: string
        }
        Update: {
          booking_id?: string | null
          coupon_id?: string
          id?: string
          redeemed_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coupon_redemptions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemptions_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          code: string
          created_at: string
          expires_at: string | null
          id: string
          is_active: boolean
          max_uses: number | null
          min_total: number
          type: Database["public"]["Enums"]["coupon_type"]
          uses_count: number
          value: number
        }
        Insert: {
          code: string
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          max_uses?: number | null
          min_total?: number
          type: Database["public"]["Enums"]["coupon_type"]
          uses_count?: number
          value: number
        }
        Update: {
          code?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          max_uses?: number | null
          min_total?: number
          type?: Database["public"]["Enums"]["coupon_type"]
          uses_count?: number
          value?: number
        }
        Relationships: []
      }
      disputes: {
        Row: {
          admin_notes: string | null
          booking_id: string
          created_at: string
          description: string
          evidence_paths: string[]
          id: string
          opened_by: string
          opened_by_role: string
          previous_status: Database["public"]["Enums"]["booking_status"]
          reason: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          booking_id: string
          created_at?: string
          description: string
          evidence_paths?: string[]
          id?: string
          opened_by: string
          opened_by_role: string
          previous_status: Database["public"]["Enums"]["booking_status"]
          reason: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          booking_id?: string
          created_at?: string
          description?: string
          evidence_paths?: string[]
          id?: string
          opened_by?: string
          opened_by_role?: string
          previous_status?: Database["public"]["Enums"]["booking_status"]
          reason?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "disputes_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      family_members: {
        Row: {
          access_notes: string | null
          allergies: string | null
          created_at: string
          customer_id: string
          date_of_birth: string
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          full_name: string
          gender: string | null
          id: string
          is_active: boolean
          medical_notes: string | null
          phone: string | null
          relationship: string
          relationship_other: string | null
          updated_at: string
        }
        Insert: {
          access_notes?: string | null
          allergies?: string | null
          created_at?: string
          customer_id: string
          date_of_birth: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          full_name: string
          gender?: string | null
          id?: string
          is_active?: boolean
          medical_notes?: string | null
          phone?: string | null
          relationship: string
          relationship_other?: string | null
          updated_at?: string
        }
        Update: {
          access_notes?: string | null
          allergies?: string | null
          created_at?: string
          customer_id?: string
          date_of_birth?: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          full_name?: string
          gender?: string | null
          id?: string
          is_active?: boolean
          medical_notes?: string | null
          phone?: string | null
          relationship?: string
          relationship_other?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      favorites: {
        Row: {
          created_at: string
          id: string
          provider_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          provider_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          provider_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          id: string
          message_type: string
          sender_id: string | null
          sender_role: string
          system_key: string | null
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string
          id?: string
          message_type?: string
          sender_id?: string | null
          sender_role: string
          system_key?: string | null
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          message_type?: string
          sender_id?: string | null
          sender_role?: string
          system_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      no_show_reports: {
        Row: {
          admin_notes: string | null
          booking_id: string
          created_at: string
          evidence_paths: string[]
          id: string
          previous_status: Database["public"]["Enums"]["booking_status"]
          reason: string
          reported_by: string
          reported_party: string
          reporter_role: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          booking_id: string
          created_at?: string
          evidence_paths?: string[]
          id?: string
          previous_status: Database["public"]["Enums"]["booking_status"]
          reason: string
          reported_by: string
          reported_party: string
          reporter_role: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          booking_id?: string
          created_at?: string
          evidence_paths?: string[]
          id?: string
          previous_status?: Database["public"]["Enums"]["booking_status"]
          reason?: string
          reported_by?: string
          reported_party?: string
          reporter_role?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "no_show_reports_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_campaigns: {
        Row: {
          body_ar: string
          body_en: string
          channel_push: boolean
          created_at: string
          created_by: string | null
          id: string
          recipient_count: number | null
          scheduled_for: string | null
          sent_at: string | null
          status: string
          target: string
          title_ar: string
          title_en: string
          updated_at: string
        }
        Insert: {
          body_ar: string
          body_en: string
          channel_push?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          recipient_count?: number | null
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string
          target: string
          title_ar: string
          title_en: string
          updated_at?: string
        }
        Update: {
          body_ar?: string
          body_en?: string
          channel_push?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          recipient_count?: number | null
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string
          target?: string
          title_ar?: string
          title_en?: string
          updated_at?: string
        }
        Relationships: []
      }
      notification_outbox: {
        Row: {
          attempts: number
          created_at: string
          id: string
          idempotency_key: string
          last_error_safe: string | null
          next_attempt_at: string
          notification_id: string
          processed_at: string | null
          processing_started_at: string | null
          recipient_user_id: string
          status: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          idempotency_key: string
          last_error_safe?: string | null
          next_attempt_at?: string
          notification_id: string
          processed_at?: string | null
          processing_started_at?: string | null
          recipient_user_id: string
          status?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          idempotency_key?: string
          last_error_safe?: string | null
          next_attempt_at?: string
          notification_id?: string
          processed_at?: string | null
          processing_started_at?: string | null
          recipient_user_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_outbox_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          booking_push: boolean
          campaign_in_app: boolean
          campaign_push: boolean
          chat_push: boolean
          reminder_push: boolean
          support_push: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          booking_push?: boolean
          campaign_in_app?: boolean
          campaign_push?: boolean
          chat_push?: boolean
          reminder_push?: boolean
          support_push?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          booking_push?: boolean
          campaign_in_app?: boolean
          campaign_push?: boolean
          chat_push?: boolean
          reminder_push?: boolean
          support_push?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          body_ar: string | null
          body_en: string | null
          booking_id: string | null
          campaign_id: string | null
          category: string
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at: string
          deep_link: string | null
          id: string
          payload: Json
          read_at: string | null
          title: string
          title_ar: string | null
          title_en: string | null
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          body_ar?: string | null
          body_en?: string | null
          booking_id?: string | null
          campaign_id?: string | null
          category?: string
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          deep_link?: string | null
          id?: string
          payload?: Json
          read_at?: string | null
          title: string
          title_ar?: string | null
          title_en?: string | null
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          body_ar?: string | null
          body_en?: string | null
          booking_id?: string | null
          campaign_id?: string | null
          category?: string
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          deep_link?: string | null
          id?: string
          payload?: Json
          read_at?: string | null
          title?: string
          title_ar?: string | null
          title_en?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "notification_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          code: string
          created_at: string
          display_order: number
          id: string
          instructions_ar: string | null
          instructions_en: string | null
          is_active: boolean
          is_default: boolean
          method_type: string
          name_ar: string
          name_en: string
          public_config: Json
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          display_order?: number
          id?: string
          instructions_ar?: string | null
          instructions_en?: string | null
          is_active?: boolean
          is_default?: boolean
          method_type: string
          name_ar: string
          name_en: string
          public_config?: Json
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          display_order?: number
          id?: string
          instructions_ar?: string | null
          instructions_en?: string | null
          is_active?: boolean
          is_default?: boolean
          method_type?: string
          name_ar?: string
          name_en?: string
          public_config?: Json
          updated_at?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          booking_id: string
          captured_at: string | null
          created_at: string
          currency: string
          customer_id: string
          id: string
          metadata: Json
          method: Database["public"]["Enums"]["payment_method"] | null
          payment_method_code: string | null
          payment_method_id: string | null
          payment_method_name_ar: string | null
          payment_method_name_en: string | null
          payment_method_snapshot: Json
          payment_method_type: string | null
          proof_path: string | null
          proof_uploaded_at: string | null
          provider_ref: string | null
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
        }
        Insert: {
          amount: number
          booking_id: string
          captured_at?: string | null
          created_at?: string
          currency?: string
          customer_id: string
          id?: string
          metadata?: Json
          method?: Database["public"]["Enums"]["payment_method"] | null
          payment_method_code?: string | null
          payment_method_id?: string | null
          payment_method_name_ar?: string | null
          payment_method_name_en?: string | null
          payment_method_snapshot?: Json
          payment_method_type?: string | null
          proof_path?: string | null
          proof_uploaded_at?: string | null
          provider_ref?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          booking_id?: string
          captured_at?: string | null
          created_at?: string
          currency?: string
          customer_id?: string
          id?: string
          metadata?: Json
          method?: Database["public"]["Enums"]["payment_method"] | null
          payment_method_code?: string | null
          payment_method_id?: string | null
          payment_method_name_ar?: string | null
          payment_method_name_en?: string | null
          payment_method_snapshot?: Json
          payment_method_type?: string | null
          proof_path?: string | null
          proof_uploaded_at?: string | null
          provider_ref?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          deleted_at: string | null
          email: string | null
          full_name: string | null
          id: string
          is_suspended: boolean
          locale: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          is_suspended?: boolean
          locale?: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          is_suspended?: boolean
          locale?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      promo_code_categories: {
        Row: {
          category_id: string
          promo_code_id: string
        }
        Insert: {
          category_id: string
          promo_code_id: string
        }
        Update: {
          category_id?: string
          promo_code_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promo_code_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_code_categories_promo_code_id_fkey"
            columns: ["promo_code_id"]
            isOneToOne: false
            referencedRelation: "promo_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      promo_code_redemptions: {
        Row: {
          booking_id: string
          customer_id: string
          discount_amount: number
          id: string
          promo_code_id: string
          redeemed_at: string
        }
        Insert: {
          booking_id: string
          customer_id: string
          discount_amount: number
          id?: string
          promo_code_id: string
          redeemed_at?: string
        }
        Update: {
          booking_id?: string
          customer_id?: string
          discount_amount?: number
          id?: string
          promo_code_id?: string
          redeemed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "promo_code_redemptions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_code_redemptions_promo_code_id_fkey"
            columns: ["promo_code_id"]
            isOneToOne: false
            referencedRelation: "promo_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      promo_code_services: {
        Row: {
          promo_code_id: string
          service_id: string
        }
        Insert: {
          promo_code_id: string
          service_id: string
        }
        Update: {
          promo_code_id?: string
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promo_code_services_promo_code_id_fkey"
            columns: ["promo_code_id"]
            isOneToOne: false
            referencedRelation: "promo_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_code_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      promo_codes: {
        Row: {
          applicable_scope: string
          code: string
          created_at: string
          created_by: string | null
          description_ar: string | null
          description_en: string | null
          discount_type: string
          discount_value: number
          expires_at: string | null
          first_booking_only: boolean
          id: string
          is_active: boolean
          maximum_discount: number | null
          minimum_booking_amount: number
          starts_at: string | null
          total_usage_limit: number | null
          updated_at: string
          usage_count: number
          usage_limit_per_customer: number | null
        }
        Insert: {
          applicable_scope?: string
          code: string
          created_at?: string
          created_by?: string | null
          description_ar?: string | null
          description_en?: string | null
          discount_type: string
          discount_value: number
          expires_at?: string | null
          first_booking_only?: boolean
          id?: string
          is_active?: boolean
          maximum_discount?: number | null
          minimum_booking_amount?: number
          starts_at?: string | null
          total_usage_limit?: number | null
          updated_at?: string
          usage_count?: number
          usage_limit_per_customer?: number | null
        }
        Update: {
          applicable_scope?: string
          code?: string
          created_at?: string
          created_by?: string | null
          description_ar?: string | null
          description_en?: string | null
          discount_type?: string
          discount_value?: number
          expires_at?: string | null
          first_booking_only?: boolean
          id?: string
          is_active?: boolean
          maximum_discount?: number | null
          minimum_booking_amount?: number
          starts_at?: string | null
          total_usage_limit?: number | null
          updated_at?: string
          usage_count?: number
          usage_limit_per_customer?: number | null
        }
        Relationships: []
      }
      provider_documents: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          notes: string | null
          provider_id: string
          rejected_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["verification_status"]
          storage_path: string
          type: Database["public"]["Enums"]["document_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          notes?: string | null
          provider_id: string
          rejected_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["verification_status"]
          storage_path: string
          type: Database["public"]["Enums"]["document_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          notes?: string | null
          provider_id?: string
          rejected_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["verification_status"]
          storage_path?: string
          type?: Database["public"]["Enums"]["document_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_documents_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_incidents: {
        Row: {
          booking_id: string | null
          created_at: string
          description: string | null
          id: string
          kind: string
          provider_id: string
          reported_by: string | null
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: Database["public"]["Enums"]["incident_severity"]
          status: Database["public"]["Enums"]["incident_status"]
          updated_at: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          kind: string
          provider_id: string
          reported_by?: string | null
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: Database["public"]["Enums"]["incident_severity"]
          status?: Database["public"]["Enums"]["incident_status"]
          updated_at?: string
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          kind?: string
          provider_id?: string
          reported_by?: string | null
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: Database["public"]["Enums"]["incident_severity"]
          status?: Database["public"]["Enums"]["incident_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_incidents_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_incidents_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_requirement_fulfillments: {
        Row: {
          created_at: string
          evidence_storage_path: string | null
          id: string
          notes: string | null
          provider_id: string
          requirement_id: string
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          evidence_storage_path?: string | null
          id?: string
          notes?: string | null
          provider_id: string
          requirement_id: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          evidence_storage_path?: string | null
          id?: string
          notes?: string | null
          provider_id?: string
          requirement_id?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_requirement_fulfillments_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_requirement_fulfillments_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "service_requirements"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_services: {
        Row: {
          created_at: string
          flagged_for_review: boolean
          id: string
          price_override: number | null
          provider_id: string
          rejection_reason: string | null
          service_id: string
          status: string
        }
        Insert: {
          created_at?: string
          flagged_for_review?: boolean
          id?: string
          price_override?: number | null
          provider_id: string
          rejection_reason?: string | null
          service_id: string
          status?: string
        }
        Update: {
          created_at?: string
          flagged_for_review?: boolean
          id?: string
          price_override?: number | null
          provider_id?: string
          rejection_reason?: string | null
          service_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_services_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_vacations: {
        Row: {
          created_at: string
          end_date: string
          id: string
          provider_id: string
          reason: string | null
          start_date: string
        }
        Insert: {
          created_at?: string
          end_date: string
          id?: string
          provider_id: string
          reason?: string | null
          start_date: string
        }
        Update: {
          created_at?: string
          end_date?: string
          id?: string
          provider_id?: string
          reason?: string | null
          start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_vacations_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      providers: {
        Row: {
          bio_ar: string | null
          bio_en: string | null
          buffer_minutes: number
          city: string | null
          country: string
          created_at: string
          deleted_at: string | null
          hourly_rate: number
          id: string
          is_active: boolean
          is_top_pro: boolean
          is_verified: boolean
          languages: string[]
          max_advance_days: number
          min_notice_hours: number
          profile_id: string
          response_time_min: number | null
          updated_at: string
          vacation_mode: boolean
          years_experience: number
        }
        Insert: {
          bio_ar?: string | null
          bio_en?: string | null
          buffer_minutes?: number
          city?: string | null
          country?: string
          created_at?: string
          deleted_at?: string | null
          hourly_rate?: number
          id?: string
          is_active?: boolean
          is_top_pro?: boolean
          is_verified?: boolean
          languages?: string[]
          max_advance_days?: number
          min_notice_hours?: number
          profile_id: string
          response_time_min?: number | null
          updated_at?: string
          vacation_mode?: boolean
          years_experience?: number
        }
        Update: {
          bio_ar?: string | null
          bio_en?: string | null
          buffer_minutes?: number
          city?: string | null
          country?: string
          created_at?: string
          deleted_at?: string | null
          hourly_rate?: number
          id?: string
          is_active?: boolean
          is_top_pro?: boolean
          is_verified?: boolean
          languages?: string[]
          max_advance_days?: number
          min_notice_hours?: number
          profile_id?: string
          response_time_min?: number | null
          updated_at?: string
          vacation_mode?: boolean
          years_experience?: number
        }
        Relationships: [
          {
            foreignKeyName: "providers_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth_key: string
          created_at: string
          device_label: string | null
          endpoint: string
          id: string
          last_seen_at: string
          p256dh: string
          revoked_at: string | null
          user_id: string
        }
        Insert: {
          auth_key: string
          created_at?: string
          device_label?: string | null
          endpoint: string
          id?: string
          last_seen_at?: string
          p256dh: string
          revoked_at?: string | null
          user_id: string
        }
        Update: {
          auth_key?: string
          created_at?: string
          device_label?: string | null
          endpoint?: string
          id?: string
          last_seen_at?: string
          p256dh?: string
          revoked_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      ratings_summary: {
        Row: {
          provider_id: string
          rating_avg: number
          rating_count: number
          updated_at: string
        }
        Insert: {
          provider_id: string
          rating_avg?: number
          rating_count?: number
          updated_at?: string
        }
        Update: {
          provider_id?: string
          rating_avg?: number
          rating_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ratings_summary_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: true
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          booking_id: string
          comment: string | null
          created_at: string
          customer_id: string
          deleted_at: string | null
          id: string
          provider_id: string
          provider_reply: string | null
          rating: number
          updated_at: string
        }
        Insert: {
          booking_id: string
          comment?: string | null
          created_at?: string
          customer_id: string
          deleted_at?: string | null
          id?: string
          provider_id: string
          provider_reply?: string | null
          rating: number
          updated_at?: string
        }
        Update: {
          booking_id?: string
          comment?: string | null
          created_at?: string
          customer_id?: string
          deleted_at?: string | null
          id?: string
          provider_id?: string
          provider_reply?: string | null
          rating?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      service_requirements: {
        Row: {
          code: string
          created_at: string
          description_ar: string | null
          description_en: string | null
          evidence_required: boolean
          fulfillment_mode: string
          id: string
          is_active: boolean
          name_ar: string
          name_en: string
          provider_extra_fee: number
          required_during_booking: boolean
          required_for_provider_approval: boolean
          requirement_type: string
          service_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          evidence_required?: boolean
          fulfillment_mode?: string
          id?: string
          is_active?: boolean
          name_ar: string
          name_en: string
          provider_extra_fee?: number
          required_during_booking?: boolean
          required_for_provider_approval?: boolean
          requirement_type: string
          service_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          evidence_required?: boolean
          fulfillment_mode?: string
          id?: string
          is_active?: boolean
          name_ar?: string
          name_en?: string
          provider_extra_fee?: number
          required_during_booking?: boolean
          required_for_provider_approval?: boolean
          requirement_type?: string
          service_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_requirements_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          base_price: number
          category_id: string
          created_at: string
          deleted_at: string | null
          description_ar: string | null
          description_en: string | null
          duration_min: number
          id: string
          is_active: boolean
          maximum_extras_total: number | null
          maximum_price: number | null
          minimum_price: number | null
          name_ar: string
          name_en: string
          pricing_model: string
          provider_pricing_allowed: boolean
          slug: string
          updated_at: string
        }
        Insert: {
          base_price?: number
          category_id: string
          created_at?: string
          deleted_at?: string | null
          description_ar?: string | null
          description_en?: string | null
          duration_min?: number
          id?: string
          is_active?: boolean
          maximum_extras_total?: number | null
          maximum_price?: number | null
          minimum_price?: number | null
          name_ar: string
          name_en: string
          pricing_model?: string
          provider_pricing_allowed?: boolean
          slug: string
          updated_at?: string
        }
        Update: {
          base_price?: number
          category_id?: string
          created_at?: string
          deleted_at?: string | null
          description_ar?: string | null
          description_en?: string | null
          duration_min?: number
          id?: string
          is_active?: boolean
          maximum_extras_total?: number | null
          maximum_price?: number | null
          minimum_price?: number | null
          name_ar?: string
          name_en?: string
          pricing_model?: string
          provider_pricing_allowed?: boolean
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      support_tickets: {
        Row: {
          assigned_admin_id: string | null
          booking_id: string
          category: string
          created_at: string
          description: string
          id: string
          opened_by_role: string
          resolution_notes: string | null
          resolved_at: string | null
          status: Database["public"]["Enums"]["ticket_status"]
          subject: string
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_admin_id?: string | null
          booking_id: string
          category: string
          created_at?: string
          description: string
          id?: string
          opened_by_role: string
          resolution_notes?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          subject: string
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_admin_id?: string | null
          booking_id?: string
          category?: string
          created_at?: string
          description?: string
          id?: string
          opened_by_role?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          subject?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_messages: {
        Row: {
          author_id: string
          author_role: string
          body: string
          created_at: string
          id: string
          ticket_id: string
        }
        Insert: {
          author_id: string
          author_role: string
          body: string
          created_at?: string
          id?: string
          ticket_id: string
        }
        Update: {
          author_id?: string
          author_role?: string
          body?: string
          created_at?: string
          id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: string
          kind: string
          metadata: Json
          payment_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          id?: string
          kind: string
          metadata?: Json
          payment_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          kind?: string
          metadata?: Json
          payment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      trust_scores: {
        Row: {
          cancelled_bookings: number
          completed_bookings: number
          completion_score: number
          components: Json
          incident_count: number
          incidents_score: number
          no_show_count: number
          provider_id: string
          reliability_score: number
          repeat_score: number
          response_score: number
          review_score: number
          score: number
          tenure_score: number
          total_bookings: number
          updated_at: string
          verification_score: number
        }
        Insert: {
          cancelled_bookings?: number
          completed_bookings?: number
          completion_score?: number
          components?: Json
          incident_count?: number
          incidents_score?: number
          no_show_count?: number
          provider_id: string
          reliability_score?: number
          repeat_score?: number
          response_score?: number
          review_score?: number
          score?: number
          tenure_score?: number
          total_bookings?: number
          updated_at?: string
          verification_score?: number
        }
        Update: {
          cancelled_bookings?: number
          completed_bookings?: number
          completion_score?: number
          components?: Json
          incident_count?: number
          incidents_score?: number
          no_show_count?: number
          provider_id?: string
          reliability_score?: number
          repeat_score?: number
          response_score?: number
          review_score?: number
          score?: number
          tenure_score?: number
          total_bookings?: number
          updated_at?: string
          verification_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "trust_scores_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: true
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      verification_records: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          kind: string
          notes: string | null
          provider_id: string
          rejected_reason: string | null
          renewal_required_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["verification_status"]
          submitted_at: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          kind: string
          notes?: string | null
          provider_id: string
          rejected_reason?: string | null
          renewal_required_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["verification_status"]
          submitted_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          kind?: string
          notes?: string | null
          provider_id?: string
          rejected_reason?: string | null
          renewal_required_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["verification_status"]
          submitted_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "verification_records_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      zone_providers: {
        Row: {
          created_at: string
          id: string
          provider_id: string
          zone_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          provider_id: string
          zone_id: string
        }
        Update: {
          created_at?: string
          id?: string
          provider_id?: string
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "zone_providers_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zone_providers_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      zone_services: {
        Row: {
          created_at: string
          id: string
          service_id: string
          zone_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          service_id: string
          zone_id: string
        }
        Update: {
          created_at?: string
          id?: string
          service_id?: string
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "zone_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zone_services_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      zones: {
        Row: {
          center_lat: number
          center_lng: number
          created_at: string
          id: string
          is_active: boolean
          name_ar: string
          name_en: string
          radius_km: number
          travel_fee: number
          updated_at: string
        }
        Insert: {
          center_lat: number
          center_lng: number
          created_at?: string
          id?: string
          is_active?: boolean
          name_ar: string
          name_en: string
          radius_km: number
          travel_fee?: number
          updated_at?: string
        }
        Update: {
          center_lat?: number
          center_lng?: number
          created_at?: string
          id?: string
          is_active?: boolean
          name_ar?: string
          name_en?: string
          radius_km?: number
          travel_fee?: number
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_activate_campaign: {
        Args: { p_campaign_id: string }
        Returns: undefined
      }
      admin_cancel_campaign: {
        Args: { p_campaign_id: string }
        Returns: undefined
      }
      admin_operations_summary: {
        Args: never
        Returns: {
          item_count: number
          oldest_at: string
          queue: string
        }[]
      }
      admin_preview_campaign_audience: {
        Args: { p_target: string }
        Returns: number
      }
      admin_resolve_dispute: {
        Args: {
          p_admin_notes?: string
          p_booking_status?: string
          p_dispute_id: string
          p_status: string
        }
        Returns: string
      }
      admin_resolve_no_show: {
        Args: {
          p_admin_notes?: string
          p_booking_status?: string
          p_report_id: string
          p_status: string
        }
        Returns: string
      }
      admin_resolve_reschedule: {
        Args: { p_action: string; p_reason: string; p_request_id: string }
        Returns: undefined
      }
      admin_retry_notification: { Args: { p_id: string }; Returns: undefined }
      admin_set_default_payment_method: {
        Args: { p_id: string }
        Returns: undefined
      }
      admin_set_provider_service_status: {
        Args: { p_id: string; p_reason?: string; p_status: string }
        Returns: undefined
      }
      admin_set_provider_verification: {
        Args: { p_provider_id: string; p_reason?: string; p_verified: boolean }
        Returns: undefined
      }
      audit_redact_jsonb: {
        Args: { p_deny_keys: string[]; p_value: Json }
        Returns: Json
      }
      cancel_booking: {
        Args: { p_booking_id: string; p_note?: string; p_reason_id: string }
        Returns: string
      }
      cancel_reschedule_request: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      check_booking_slot: {
        Args: {
          p_end: string
          p_exclude_booking_id?: string
          p_provider_id: string
          p_start: string
        }
        Returns: undefined
      }
      claim_notification_outbox_batch: {
        Args: { p_batch_size?: number; p_stale_minutes?: number }
        Returns: {
          attempts: number
          created_at: string
          id: string
          idempotency_key: string
          last_error_safe: string | null
          next_attempt_at: string
          notification_id: string
          processed_at: string | null
          processing_started_at: string | null
          recipient_user_id: string
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "notification_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_support_ticket: {
        Args: {
          p_booking_id: string
          p_category: string
          p_description: string
          p_subject: string
        }
        Returns: string
      }
      expand_campaign_recipients: {
        Args: { p_campaign_id: string }
        Returns: number
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_not_suspended: { Args: { _user_id: string }; Returns: boolean }
      mark_push_subscription_expired: {
        Args: { p_endpoint: string }
        Returns: undefined
      }
      open_booking_dispute: {
        Args: {
          p_booking_id: string
          p_description: string
          p_evidence_paths?: string[]
          p_reason: string
        }
        Returns: string
      }
      process_due_campaigns: { Args: never; Returns: number }
      process_due_reminders: { Args: never; Returns: number }
      recompute_trust_score: {
        Args: { _provider_id: string }
        Returns: undefined
      }
      register_push_subscription: {
        Args: {
          p_auth_key: string
          p_device_label?: string
          p_endpoint: string
          p_p256dh: string
        }
        Returns: string
      }
      report_no_show: {
        Args: {
          p_booking_id: string
          p_evidence_paths?: string[]
          p_reason: string
        }
        Returns: string
      }
      request_reschedule: {
        Args: {
          p_booking_id: string
          p_proposed_end: string
          p_proposed_start: string
          p_reason: string
        }
        Returns: string
      }
      resolve_zone: {
        Args: { p_lat: number; p_lng: number }
        Returns: {
          name_ar: string
          name_en: string
          travel_fee: number
          zone_id: string
        }[]
      }
      respond_reschedule: {
        Args: {
          p_action: string
          p_counter_end?: string
          p_counter_start?: string
          p_reason?: string
          p_request_id: string
        }
        Returns: string
      }
      revoke_push_subscription: {
        Args: { p_endpoint: string }
        Returns: undefined
      }
      revoke_push_subscription_by_id: {
        Args: { p_id: string }
        Returns: undefined
      }
      validate_promo_code: {
        Args: { p_code: string; p_service_id: string; p_subtotal: number }
        Returns: Json
      }
    }
    Enums: {
      app_role: "customer" | "provider" | "admin"
      booking_status:
        | "pending"
        | "confirmed"
        | "on_the_way"
        | "arrived"
        | "arrival_confirmed"
        | "in_progress"
        | "completion_requested"
        | "disputed"
        | "completed"
        | "cancelled"
        | "no_show"
      coupon_type: "percent" | "fixed"
      document_type:
        | "id_card"
        | "passport"
        | "criminal_record"
        | "certificate"
        | "other"
      incident_severity: "low" | "medium" | "high" | "critical"
      incident_status: "open" | "investigating" | "resolved" | "dismissed"
      notification_channel: "in_app" | "email" | "sms" | "push" | "whatsapp"
      payment_method: "card" | "wallet" | "cash" | "instapay" | "paymob"
      payment_status:
        | "pending"
        | "authorized"
        | "captured"
        | "failed"
        | "refunded"
        | "partially_refunded"
        | "pending_review"
        | "rejected"
      ticket_status: "open" | "pending" | "resolved" | "closed"
      verification_status:
        | "pending"
        | "approved"
        | "rejected"
        | "expired"
        | "renewal_required"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["customer", "provider", "admin"],
      booking_status: [
        "pending",
        "confirmed",
        "on_the_way",
        "arrived",
        "arrival_confirmed",
        "in_progress",
        "completion_requested",
        "disputed",
        "completed",
        "cancelled",
        "no_show",
      ],
      coupon_type: ["percent", "fixed"],
      document_type: [
        "id_card",
        "passport",
        "criminal_record",
        "certificate",
        "other",
      ],
      incident_severity: ["low", "medium", "high", "critical"],
      incident_status: ["open", "investigating", "resolved", "dismissed"],
      notification_channel: ["in_app", "email", "sms", "push", "whatsapp"],
      payment_method: ["card", "wallet", "cash", "instapay", "paymob"],
      payment_status: [
        "pending",
        "authorized",
        "captured",
        "failed",
        "refunded",
        "partially_refunded",
        "pending_review",
        "rejected",
      ],
      ticket_status: ["open", "pending", "resolved", "closed"],
      verification_status: [
        "pending",
        "approved",
        "rejected",
        "expired",
        "renewal_required",
      ],
    },
  },
} as const
