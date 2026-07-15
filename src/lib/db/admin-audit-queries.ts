/**
 * Admin Audit Log — Famy Patch 4 / Module 2. Read-only: audit_logs rows are
 * append-only (see 20260716020000_admin_operations_and_audit_trail.sql —
 * admin can SELECT only, no UPDATE/DELETE path exists for anyone). Actor
 * names are resolved client-side per page (audit_logs.actor_id references
 * auth.users, not public.profiles, so PostgREST can't embed it directly);
 * booking_id has a real FK to bookings and is embedded normally.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type AuditLogRow = {
  id: string;
  actor_id: string | null;
  actor_role: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  booking_id: string | null;
  reason: string | null;
  correlation_id: string | null;
  old_values: Record<string, any> | null;
  new_values: Record<string, any> | null;
  diff: Record<string, any> | null;
  created_at: string;
  booking?: { id: string; status: string; customer_id: string } | null;
  actor_name?: string | null;
};

export type AuditLogFilters = {
  action?: string;
  entity?: string;
  actorId?: string;
  bookingId?: string;
  entityId?: string;
  dateFrom?: string;
  dateTo?: string;
};

const PAGE_SIZE = 25;

export function useAdminAuditLogs(filters: AuditLogFilters, page: number) {
  return useQuery({
    queryKey: ['admin', 'audit-log', filters, page],
    queryFn: async () => {
      let q = supabase
        .from('audit_logs')
        .select('*, booking:bookings(id, status, customer_id)', { count: 'exact' })
        .order('created_at', { ascending: false });

      if (filters.action) q = q.eq('action', filters.action);
      if (filters.entity) q = q.eq('entity', filters.entity);
      if (filters.actorId) q = q.eq('actor_id', filters.actorId);
      if (filters.bookingId) q = q.eq('booking_id', filters.bookingId);
      if (filters.entityId) q = q.eq('entity_id', filters.entityId);
      if (filters.dateFrom) q = q.gte('created_at', filters.dateFrom);
      if (filters.dateTo) q = q.lte('created_at', filters.dateTo);

      const from = page * PAGE_SIZE;
      const { data, error, count } = await q.range(from, from + PAGE_SIZE - 1);
      if (error) throw error;

      const rows = (data ?? []) as AuditLogRow[];
      const actorIds = Array.from(new Set(rows.map((r) => r.actor_id).filter(Boolean))) as string[];
      if (actorIds.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', actorIds);
        const byId = new Map((profiles ?? []).map((p: any) => [p.id, p.full_name]));
        for (const r of rows) r.actor_name = r.actor_id ? (byId.get(r.actor_id) ?? null) : null;
      }

      return { rows, total: count ?? 0, pageSize: PAGE_SIZE };
    },
  });
}

export function useAdminAuditLogEntities() {
  return useQuery({
    queryKey: ['admin', 'audit-log', 'entities'],
    queryFn: async () => {
      // audit_logs can grow large; distinct entity/action values are pulled
      // from a bounded recent slice rather than the full table.
      const { data, error } = await supabase
        .from('audit_logs')
        .select('entity, action')
        .order('created_at', { ascending: false })
        .limit(2000);
      if (error) throw error;
      const entities = new Set<string>();
      const actions = new Set<string>();
      for (const r of data ?? []) {
        if (r.entity) entities.add(r.entity);
        if (r.action) actions.add(r.action);
      }
      return { entities: Array.from(entities).sort(), actions: Array.from(actions).sort() };
    },
  });
}
