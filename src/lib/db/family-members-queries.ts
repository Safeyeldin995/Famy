/**
 * Family members data layer.
 * RLS: family_members_customer_all (owner only) / family_members_admin_all
 * (admin) — see migration 20260714210000_family_members.sql. No DELETE is
 * granted to authenticated users — removal is always soft (is_active=false)
 * since a member may already be referenced by historical bookings.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type FamilyMemberRow = Database['public']['Tables']['family_members']['Row'];
export type Relationship = 'spouse' | 'son' | 'daughter' | 'father' | 'mother' | 'sibling' | 'grandparent' | 'other';

export type FamilyMemberInput = {
  full_name: string;
  relationship: Relationship;
  relationship_other?: string | null;
  date_of_birth: string;
  gender?: 'male' | 'female' | 'other' | null;
  phone?: string | null;
  allergies?: string | null;
  medical_notes?: string | null;
  access_notes?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
};

function toFamilyMemberRow(input: FamilyMemberInput) {
  return {
    full_name: input.full_name.trim(),
    relationship: input.relationship,
    relationship_other: input.relationship === 'other' ? (input.relationship_other?.trim() || null) : null,
    date_of_birth: input.date_of_birth,
    gender: input.gender ?? null,
    phone: input.phone ?? null,
    allergies: input.allergies ?? null,
    medical_notes: input.medical_notes ?? null,
    access_notes: input.access_notes ?? null,
    emergency_contact_name: input.emergency_contact_name ?? null,
    emergency_contact_phone: input.emergency_contact_phone ?? null,
  };
}

/** All of the current customer's family members, most recent first. */
export function useFamilyMembers() {
  return useQuery({
    queryKey: ['family-members'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from('family_members')
        .select('*')
        .eq('customer_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Active members only — the set selectable when booking. */
export function useActiveFamilyMembers() {
  return useQuery({
    queryKey: ['family-members', 'active'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from('family_members')
        .select('*')
        .eq('customer_id', user.id)
        .eq('is_active', true)
        .order('full_name', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useFamilyMember(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: ['family-member', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('family_members').select('*').eq('id', id!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

function invalidateFamilyMembers(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['family-members'] });
}

export function useCreateFamilyMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: FamilyMemberInput) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('auth required');
      const { data, error } = await supabase
        .from('family_members')
        .insert({ ...toFamilyMemberRow(input), customer_id: user.id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateFamilyMembers(qc),
  });
}

export function useUpdateFamilyMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: FamilyMemberInput & { id: string }) => {
      const { data, error } = await supabase
        .from('family_members')
        .update(toFamilyMemberRow(input))
        .eq('id', input.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      invalidateFamilyMembers(qc);
      qc.invalidateQueries({ queryKey: ['family-member', vars.id] });
    },
  });
}

/** Soft-deactivate — never a hard delete, so historical bookings stay intact and readable. */
export function useDeactivateFamilyMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('family_members').update({ is_active: false }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => invalidateFamilyMembers(qc),
  });
}
