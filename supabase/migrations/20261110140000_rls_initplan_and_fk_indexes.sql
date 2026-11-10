-- RLS initplan: wrap auth.uid()/auth.role()/auth.jwt() for per-query evaluation.
-- Missing FK column indexes (Supabase performance advisor).
-- Forward-only. No data changes. Semantics unchanged except initplan wrapping.
-- Part of issue #309.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) RLS policies: (select auth.*()) initplan wrap
-- ---------------------------------------------------------------------------

ALTER POLICY addresses_self ON public.addresses
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));
ALTER POLICY area_requests_insert_own ON public.area_requests
  WITH CHECK ((user_id = (select auth.uid())));
ALTER POLICY area_requests_select_own ON public.area_requests
  USING (((user_id = (select auth.uid())) OR has_role((select auth.uid()), 'admin'::app_role)));
ALTER POLICY audit_admin ON public.audit_logs
  USING (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY avail_exc_admin_all ON public.availability_exceptions
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY avail_exc_self_manage ON public.availability_exceptions
  USING ((EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = availability_exceptions.provider_id) AND (p.profile_id = (select auth.uid()))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = availability_exceptions.provider_id) AND (p.profile_id = (select auth.uid()))))));
ALTER POLICY avail_admin_all ON public.availability_rules
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY avail_self_manage ON public.availability_rules
  USING ((EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = availability_rules.provider_id) AND (p.profile_id = (select auth.uid()))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = availability_rules.provider_id) AND (p.profile_id = (select auth.uid()))))));
ALTER POLICY booking_cancellations_party_read ON public.booking_cancellations
  USING ((has_role((select auth.uid()), 'admin'::app_role) OR (EXISTS ( SELECT 1
   FROM bookings b
  WHERE ((b.id = booking_cancellations.booking_id) AND ((b.customer_id = (select auth.uid())) OR (EXISTS ( SELECT 1
           FROM providers p
          WHERE ((p.id = b.provider_id) AND (p.profile_id = (select auth.uid())))))))))));
ALTER POLICY bfms_admin_all ON public.booking_family_member_snapshots
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY bfms_customer_read ON public.booking_family_member_snapshots
  USING ((EXISTS ( SELECT 1
   FROM bookings b
  WHERE ((b.id = booking_family_member_snapshots.booking_id) AND (b.customer_id = (select auth.uid()))))));
ALTER POLICY bfms_provider_read ON public.booking_family_member_snapshots
  USING ((EXISTS ( SELECT 1
   FROM (bookings b
     JOIN providers p ON ((p.id = b.provider_id)))
  WHERE ((b.id = booking_family_member_snapshots.booking_id) AND (p.profile_id = (select auth.uid())) AND (b.status = ANY (ARRAY['confirmed'::booking_status, 'on_the_way'::booking_status, 'arrived'::booking_status, 'arrival_confirmed'::booking_status, 'in_progress'::booking_status, 'completion_requested'::booking_status]))))));
ALTER POLICY booking_locations_admin_all ON public.booking_locations
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY booking_locations_customer_read ON public.booking_locations
  USING ((EXISTS ( SELECT 1
   FROM bookings b
  WHERE ((b.id = booking_locations.booking_id) AND (b.customer_id = (select auth.uid()))))));
ALTER POLICY booking_locations_provider_read ON public.booking_locations
  USING ((EXISTS ( SELECT 1
   FROM (bookings b
     JOIN providers p ON ((p.id = b.provider_id)))
  WHERE ((b.id = booking_locations.booking_id) AND (p.profile_id = (select auth.uid())) AND (b.status = ANY (ARRAY['confirmed'::booking_status, 'on_the_way'::booking_status, 'arrived'::booking_status, 'arrival_confirmed'::booking_status, 'in_progress'::booking_status, 'completion_requested'::booking_status]))))));
ALTER POLICY booking_message_reads_self ON public.booking_message_reads
  USING ((user_id = (select auth.uid())))
  WITH CHECK (((user_id = (select auth.uid())) AND (EXISTS ( SELECT 1
   FROM bookings b
  WHERE ((b.id = booking_message_reads.booking_id) AND ((b.customer_id = (select auth.uid())) OR (EXISTS ( SELECT 1
           FROM providers p
          WHERE ((p.id = b.provider_id) AND (p.profile_id = (select auth.uid()))))) OR has_role((select auth.uid()), 'admin'::app_role)))))));
ALTER POLICY booking_reminder_rules_admin_all ON public.booking_reminder_rules
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY brs_admin_all ON public.booking_requirement_selections
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY brs_customer_read ON public.booking_requirement_selections
  USING ((EXISTS ( SELECT 1
   FROM bookings b
  WHERE ((b.id = booking_requirement_selections.booking_id) AND (b.customer_id = (select auth.uid()))))));
ALTER POLICY brs_provider_read ON public.booking_requirement_selections
  USING ((EXISTS ( SELECT 1
   FROM (bookings b
     JOIN providers p ON ((p.id = b.provider_id)))
  WHERE ((b.id = booking_requirement_selections.booking_id) AND (p.profile_id = (select auth.uid())) AND (b.status = ANY (ARRAY['confirmed'::booking_status, 'on_the_way'::booking_status, 'arrived'::booking_status, 'arrival_confirmed'::booking_status, 'in_progress'::booking_status, 'completion_requested'::booking_status]))))));
ALTER POLICY reschedule_admin_all ON public.booking_reschedule_requests
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY reschedule_party_read ON public.booking_reschedule_requests
  USING ((EXISTS ( SELECT 1
   FROM bookings b
  WHERE ((b.id = booking_reschedule_requests.booking_id) AND ((b.customer_id = (select auth.uid())) OR (EXISTS ( SELECT 1
           FROM providers p
          WHERE ((p.id = b.provider_id) AND (p.profile_id = (select auth.uid()))))))))));
ALTER POLICY bsh_admin_all ON public.booking_status_history
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY bsh_party_read ON public.booking_status_history
  USING ((EXISTS ( SELECT 1
   FROM bookings b
  WHERE ((b.id = booking_status_history.booking_id) AND ((b.customer_id = (select auth.uid())) OR (EXISTS ( SELECT 1
           FROM providers p
          WHERE ((p.id = b.provider_id) AND (p.profile_id = (select auth.uid()))))))))));
ALTER POLICY bookings_admin_all ON public.bookings
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY bookings_customer_select ON public.bookings
  USING ((customer_id = (select auth.uid())));
ALTER POLICY bookings_customer_update ON public.bookings
  USING ((customer_id = (select auth.uid())))
  WITH CHECK ((customer_id = (select auth.uid())));
ALTER POLICY bookings_provider_select ON public.bookings
  USING ((EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = bookings.provider_id) AND (p.profile_id = (select auth.uid()))))));
ALTER POLICY bookings_provider_update ON public.bookings
  USING ((EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = bookings.provider_id) AND (p.profile_id = (select auth.uid()))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = bookings.provider_id) AND (p.profile_id = (select auth.uid()))))));
ALTER POLICY cancellation_reasons_admin_all ON public.cancellation_reasons
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY categories_admin_all ON public.categories
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY conv_admin_all ON public.conversations
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY conv_select ON public.conversations
  USING ((has_role((select auth.uid()), 'admin'::app_role) OR ((((select auth.uid()) = customer_id) OR ((select auth.uid()) = provider_user_id)) AND (EXISTS ( SELECT 1
   FROM bookings b
  WHERE ((b.id = conversations.booking_id) AND (b.status <> 'pending'::booking_status)))))));
ALTER POLICY cr_self ON public.coupon_redemptions
  USING (((user_id = (select auth.uid())) OR has_role((select auth.uid()), 'admin'::app_role)));
ALTER POLICY coupons_admin_all ON public.coupons
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY customer_education_profiles_admin_all ON public.customer_education_profiles
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY customer_education_profiles_owner_all ON public.customer_education_profiles
  USING ((customer_id = (select auth.uid())))
  WITH CHECK ((customer_id = (select auth.uid())));
ALTER POLICY device_push_tokens_select_own ON public.device_push_tokens
  USING ((user_id = (select auth.uid())));
ALTER POLICY disputes_party_read ON public.disputes
  USING ((has_role((select auth.uid()), 'admin'::app_role) OR (EXISTS ( SELECT 1
   FROM bookings b
  WHERE ((b.id = disputes.booking_id) AND ((b.customer_id = (select auth.uid())) OR (EXISTS ( SELECT 1
           FROM providers p
          WHERE ((p.id = b.provider_id) AND (p.profile_id = (select auth.uid())))))))))));
ALTER POLICY error_logs_admin_read ON public.error_logs
  USING (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY family_members_admin_all ON public.family_members
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY family_members_customer_all ON public.family_members
  USING ((customer_id = (select auth.uid())))
  WITH CHECK ((customer_id = (select auth.uid())));
ALTER POLICY favorites_self ON public.favorites
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));
ALTER POLICY messages_admin_all ON public.messages
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY messages_insert ON public.messages
  WITH CHECK ((((select auth.uid()) = sender_id) AND (EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND (((select auth.uid()) = c.customer_id) OR ((select auth.uid()) = c.provider_user_id)))))));
ALTER POLICY messages_select ON public.messages
  USING ((EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND (has_role((select auth.uid()), 'admin'::app_role) OR ((((select auth.uid()) = c.customer_id) OR ((select auth.uid()) = c.provider_user_id)) AND (EXISTS ( SELECT 1
           FROM bookings b
          WHERE ((b.id = c.booking_id) AND (b.status <> 'pending'::booking_status))))))))));
ALTER POLICY no_show_reports_party_read ON public.no_show_reports
  USING ((has_role((select auth.uid()), 'admin'::app_role) OR (EXISTS ( SELECT 1
   FROM bookings b
  WHERE ((b.id = no_show_reports.booking_id) AND ((b.customer_id = (select auth.uid())) OR (EXISTS ( SELECT 1
           FROM providers p
          WHERE ((p.id = b.provider_id) AND (p.profile_id = (select auth.uid())))))))))));
ALTER POLICY notification_campaigns_admin_all ON public.notification_campaigns
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY notification_outbox_admin_read ON public.notification_outbox
  USING (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY notification_preferences_self ON public.notification_preferences
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));
ALTER POLICY notif_self ON public.notifications
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));
ALTER POLICY payment_methods_admin_all ON public.payment_methods
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY payments_admin_all ON public.payments
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY payments_customer_insert ON public.payments
  WITH CHECK (((customer_id = (select auth.uid())) AND (EXISTS ( SELECT 1
   FROM bookings b
  WHERE ((b.id = payments.booking_id) AND (b.customer_id = (select auth.uid())))))));
ALTER POLICY payments_customer_read ON public.payments
  USING ((customer_id = (select auth.uid())));
ALTER POLICY payments_customer_update_proof ON public.payments
  USING (((customer_id = (select auth.uid())) AND (status = 'pending_review'::payment_status)))
  WITH CHECK (((customer_id = (select auth.uid())) AND (status = 'pending_review'::payment_status)));
ALTER POLICY payments_provider_read ON public.payments
  USING ((EXISTS ( SELECT 1
   FROM (bookings b
     JOIN providers pr ON ((pr.id = b.provider_id)))
  WHERE ((b.id = payments.booking_id) AND (pr.profile_id = (select auth.uid()))))));
ALTER POLICY payments_provider_update ON public.payments
  USING ((EXISTS ( SELECT 1
   FROM (bookings b
     JOIN providers pr ON ((pr.id = b.provider_id)))
  WHERE ((b.id = payments.booking_id) AND (pr.profile_id = (select auth.uid()))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (bookings b
     JOIN providers pr ON ((pr.id = b.provider_id)))
  WHERE ((b.id = payments.booking_id) AND (pr.profile_id = (select auth.uid()))))));
ALTER POLICY profiles_admin_select ON public.profiles
  USING (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY profiles_admin_update ON public.profiles
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY profiles_self_insert ON public.profiles
  WITH CHECK (((select auth.uid()) = id));
ALTER POLICY profiles_self_select ON public.profiles
  USING (((select auth.uid()) = id));
ALTER POLICY profiles_self_update ON public.profiles
  USING (((select auth.uid()) = id))
  WITH CHECK (((select auth.uid()) = id));
ALTER POLICY pcc_admin_all ON public.promo_code_categories
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY pcr_self_read ON public.promo_code_redemptions
  USING (((customer_id = (select auth.uid())) OR has_role((select auth.uid()), 'admin'::app_role)));
ALTER POLICY pcs_admin_all ON public.promo_code_services
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY promo_codes_admin_all ON public.promo_codes
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY provider_admin_internal_notes_admin ON public.provider_admin_internal_notes
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY provider_admin_section_reviews_admin_read ON public.provider_admin_section_reviews
  USING (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY provider_age_group_delete ON public.provider_age_group_capabilities
  USING ((EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = provider_age_group_capabilities.provider_id) AND (p.profile_id = (select auth.uid())) AND provider_onboarding_editable(p.onboarding_status)))));
ALTER POLICY provider_age_group_insert ON public.provider_age_group_capabilities
  WITH CHECK ((EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = provider_age_group_capabilities.provider_id) AND (p.profile_id = (select auth.uid())) AND provider_onboarding_editable(p.onboarding_status)))));
ALTER POLICY provider_age_group_select ON public.provider_age_group_capabilities
  USING ((has_role((select auth.uid()), 'admin'::app_role) OR (EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = provider_age_group_capabilities.provider_id) AND (p.profile_id = (select auth.uid())))))));
ALTER POLICY provider_age_group_update ON public.provider_age_group_capabilities
  USING (((EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = provider_age_group_capabilities.provider_id) AND (p.profile_id = (select auth.uid())) AND provider_onboarding_editable(p.onboarding_status)))) OR (has_role((select auth.uid()), 'admin'::app_role) AND (NOT (EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = provider_age_group_capabilities.provider_id) AND (p.profile_id = (select auth.uid())))))))))
  WITH CHECK (((EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = provider_age_group_capabilities.provider_id) AND (p.profile_id = (select auth.uid())) AND provider_onboarding_editable(p.onboarding_status)))) OR (has_role((select auth.uid()), 'admin'::app_role) AND (NOT (EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = provider_age_group_capabilities.provider_id) AND (p.profile_id = (select auth.uid())))))))));
ALTER POLICY docs_admin ON public.provider_documents
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY docs_self_delete ON public.provider_documents
  USING ((EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = provider_documents.provider_id) AND (p.profile_id = (select auth.uid())) AND provider_onboarding_editable(p.onboarding_status)))));
ALTER POLICY docs_self_insert ON public.provider_documents
  WITH CHECK ((EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = provider_documents.provider_id) AND (p.profile_id = (select auth.uid())) AND provider_onboarding_editable(p.onboarding_status)))));
ALTER POLICY docs_self_select ON public.provider_documents
  USING ((EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = provider_documents.provider_id) AND (p.profile_id = (select auth.uid()))))));
ALTER POLICY "admins manage incidents" ON public.provider_incidents
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY "incidents visible to admin and provider" ON public.provider_incidents
  USING ((has_role((select auth.uid()), 'admin'::app_role) OR (EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = provider_incidents.provider_id) AND (p.profile_id = (select auth.uid()))))) OR (reported_by = (select auth.uid()))));
ALTER POLICY "users can report incidents" ON public.provider_incidents
  WITH CHECK (((select auth.uid()) = reported_by));
ALTER POLICY provider_onboarding_details_admin ON public.provider_onboarding_details
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY provider_onboarding_details_insert ON public.provider_onboarding_details
  WITH CHECK ((has_role((select auth.uid()), 'admin'::app_role) OR (EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = provider_onboarding_details.provider_id) AND (p.profile_id = (select auth.uid())) AND provider_onboarding_editable(p.onboarding_status))))));
ALTER POLICY provider_onboarding_details_select ON public.provider_onboarding_details
  USING ((has_role((select auth.uid()), 'admin'::app_role) OR (EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = provider_onboarding_details.provider_id) AND (p.profile_id = (select auth.uid())))))));
ALTER POLICY provider_onboarding_details_update ON public.provider_onboarding_details
  USING ((has_role((select auth.uid()), 'admin'::app_role) OR (EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = provider_onboarding_details.provider_id) AND (p.profile_id = (select auth.uid())) AND provider_onboarding_editable(p.onboarding_status))))))
  WITH CHECK ((has_role((select auth.uid()), 'admin'::app_role) OR (EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = provider_onboarding_details.provider_id) AND (p.profile_id = (select auth.uid())) AND provider_onboarding_editable(p.onboarding_status))))));
ALTER POLICY provider_onboarding_events_provider_read ON public.provider_onboarding_events
  USING ((has_role((select auth.uid()), 'admin'::app_role) OR (EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = provider_onboarding_events.provider_id) AND (p.profile_id = (select auth.uid())))))));
ALTER POLICY provider_references_admin ON public.provider_references
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY provider_references_delete ON public.provider_references
  USING ((has_role((select auth.uid()), 'admin'::app_role) OR (EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = provider_references.provider_id) AND (p.profile_id = (select auth.uid())) AND provider_onboarding_editable(p.onboarding_status))))));
ALTER POLICY provider_references_insert ON public.provider_references
  WITH CHECK ((has_role((select auth.uid()), 'admin'::app_role) OR (EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = provider_references.provider_id) AND (p.profile_id = (select auth.uid())) AND provider_onboarding_editable(p.onboarding_status))))));
ALTER POLICY provider_references_select ON public.provider_references
  USING ((has_role((select auth.uid()), 'admin'::app_role) OR (EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = provider_references.provider_id) AND (p.profile_id = (select auth.uid())))))));
ALTER POLICY provider_references_update ON public.provider_references
  USING ((has_role((select auth.uid()), 'admin'::app_role) OR (EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = provider_references.provider_id) AND (p.profile_id = (select auth.uid())) AND provider_onboarding_editable(p.onboarding_status))))))
  WITH CHECK ((has_role((select auth.uid()), 'admin'::app_role) OR (EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = provider_references.provider_id) AND (p.profile_id = (select auth.uid())) AND provider_onboarding_editable(p.onboarding_status))))));
ALTER POLICY prf_admin_all ON public.provider_requirement_fulfillments
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY prf_provider_read ON public.provider_requirement_fulfillments
  USING ((EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = provider_requirement_fulfillments.provider_id) AND (p.profile_id = (select auth.uid()))))));
ALTER POLICY prf_provider_write ON public.provider_requirement_fulfillments
  USING ((EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = provider_requirement_fulfillments.provider_id) AND (p.profile_id = (select auth.uid()))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = provider_requirement_fulfillments.provider_id) AND (p.profile_id = (select auth.uid()))))));
ALTER POLICY ps_admin_all ON public.provider_services
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY ps_provider_manage ON public.provider_services
  USING ((EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = provider_services.provider_id) AND (p.profile_id = (select auth.uid()))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = provider_services.provider_id) AND (p.profile_id = (select auth.uid()))))));
ALTER POLICY teaching_cap_admin_read ON public.provider_teaching_capabilities
  USING (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY teaching_cap_owner_read ON public.provider_teaching_capabilities
  USING ((EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = provider_teaching_capabilities.provider_id) AND (p.profile_id = (select auth.uid()))))));
ALTER POLICY "providers manage own vacations" ON public.provider_vacations
  USING (((EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = provider_vacations.provider_id) AND (p.profile_id = (select auth.uid()))))) OR has_role((select auth.uid()), 'admin'::app_role)))
  WITH CHECK (((EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = provider_vacations.provider_id) AND (p.profile_id = (select auth.uid()))))) OR has_role((select auth.uid()), 'admin'::app_role)));
ALTER POLICY providers_admin_all ON public.providers
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY providers_self_read ON public.providers
  USING ((profile_id = (select auth.uid())));
ALTER POLICY providers_self_update ON public.providers
  USING ((profile_id = (select auth.uid())))
  WITH CHECK ((profile_id = (select auth.uid())));
ALTER POLICY providers_self_upsert ON public.providers
  WITH CHECK ((profile_id = (select auth.uid())));
ALTER POLICY push_subs_self_select ON public.push_subscriptions
  USING ((user_id = (select auth.uid())));
ALTER POLICY reviews_customer_insert ON public.reviews
  WITH CHECK (((customer_id = (select auth.uid())) AND (EXISTS ( SELECT 1
   FROM bookings b
  WHERE ((b.id = reviews.booking_id) AND (b.customer_id = (select auth.uid())) AND (b.status = 'completed'::booking_status))))));
ALTER POLICY reviews_customer_update ON public.reviews
  USING ((customer_id = (select auth.uid())))
  WITH CHECK ((customer_id = (select auth.uid())));
ALTER POLICY reviews_provider_reply ON public.reviews
  USING ((EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = reviews.provider_id) AND (p.profile_id = (select auth.uid()))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = reviews.provider_id) AND (p.profile_id = (select auth.uid()))))));
ALTER POLICY sr_admin_all ON public.service_requirements
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY service_teaching_levels_admin ON public.service_teaching_levels
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY services_admin_all ON public.services
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY services_inactive_read ON public.services
  USING (((NOT is_active) AND ((EXISTS ( SELECT 1
   FROM (provider_services ps
     JOIN providers p ON ((p.id = ps.provider_id)))
  WHERE ((ps.service_id = services.id) AND (p.profile_id = (select auth.uid()))))) OR (EXISTS ( SELECT 1
   FROM bookings b
  WHERE ((b.service_id = services.id) AND ((b.customer_id = (select auth.uid())) OR (EXISTS ( SELECT 1
           FROM providers p2
          WHERE ((p2.id = b.provider_id) AND (p2.profile_id = (select auth.uid()))))))))))));
ALTER POLICY settings_admin_write ON public.settings
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY support_tickets_admin_update ON public.support_tickets
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY support_tickets_party_read ON public.support_tickets
  USING ((has_role((select auth.uid()), 'admin'::app_role) OR (EXISTS ( SELECT 1
   FROM bookings b
  WHERE ((b.id = support_tickets.booking_id) AND ((b.customer_id = (select auth.uid())) OR (EXISTS ( SELECT 1
           FROM providers p
          WHERE ((p.id = b.provider_id) AND (p.profile_id = (select auth.uid())))))))))));
ALTER POLICY teaching_curricula_admin ON public.teaching_curricula
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY teaching_curricula_read ON public.teaching_curricula
  USING ((is_active OR has_role((select auth.uid()), 'admin'::app_role)));
ALTER POLICY teaching_levels_admin ON public.teaching_levels
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY teaching_levels_read ON public.teaching_levels
  USING ((is_active OR has_role((select auth.uid()), 'admin'::app_role)));
ALTER POLICY teaching_subject_services_admin ON public.teaching_subject_services
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY teaching_subjects_admin ON public.teaching_subjects
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY teaching_subjects_read ON public.teaching_subjects
  USING ((is_active OR has_role((select auth.uid()), 'admin'::app_role)));
ALTER POLICY ticket_messages_party_insert ON public.ticket_messages
  WITH CHECK (((author_id = (select auth.uid())) AND (EXISTS ( SELECT 1
   FROM support_tickets t
  WHERE ((t.id = ticket_messages.ticket_id) AND (has_role((select auth.uid()), 'admin'::app_role) OR (t.user_id = (select auth.uid())) OR (EXISTS ( SELECT 1
           FROM bookings b
          WHERE ((b.id = t.booking_id) AND ((b.customer_id = (select auth.uid())) OR (EXISTS ( SELECT 1
                   FROM providers p
                  WHERE ((p.id = b.provider_id) AND (p.profile_id = (select auth.uid())))))))))))))));
ALTER POLICY ticket_messages_party_read ON public.ticket_messages
  USING ((EXISTS ( SELECT 1
   FROM support_tickets t
  WHERE ((t.id = ticket_messages.ticket_id) AND (has_role((select auth.uid()), 'admin'::app_role) OR (t.user_id = (select auth.uid())) OR (EXISTS ( SELECT 1
           FROM bookings b
          WHERE ((b.id = t.booking_id) AND ((b.customer_id = (select auth.uid())) OR (EXISTS ( SELECT 1
                   FROM providers p
                  WHERE ((p.id = b.provider_id) AND (p.profile_id = (select auth.uid()))))))))))))));
ALTER POLICY tx_admin_all ON public.transactions
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY roles_self_insert_provider ON public.user_roles
  WITH CHECK ((((select auth.uid()) = user_id) AND (role = 'provider'::app_role)));
ALTER POLICY roles_self_select ON public.user_roles
  USING ((((select auth.uid()) = user_id) OR has_role((select auth.uid()), 'admin'::app_role)));
ALTER POLICY vr_admin_all ON public.verification_records
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY vr_self_read ON public.verification_records
  USING ((EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = verification_records.provider_id) AND (p.profile_id = (select auth.uid()))))));
ALTER POLICY zone_providers_admin_all ON public.zone_providers
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY zone_services_admin_all ON public.zone_services
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY zones_admin_all ON public.zones
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));

-- ---------------------------------------------------------------------------
-- 2) Foreign-key covering indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_booking_cancellations_cancelled_by_user_id ON public.booking_cancellations (cancelled_by_user_id);
CREATE INDEX IF NOT EXISTS idx_booking_cancellations_reason_id ON public.booking_cancellations (reason_id);
CREATE INDEX IF NOT EXISTS idx_booking_family_member_snapshots_family_member_id ON public.booking_family_member_snapshots (family_member_id);
CREATE INDEX IF NOT EXISTS idx_booking_locations_address_id ON public.booking_locations (address_id);
CREATE INDEX IF NOT EXISTS idx_booking_locations_zone_id ON public.booking_locations (zone_id);
CREATE INDEX IF NOT EXISTS idx_booking_reminders_notification_id ON public.booking_reminders (notification_id);
CREATE INDEX IF NOT EXISTS idx_booking_requirement_selections_requirement_id ON public.booking_requirement_selections (requirement_id);
CREATE INDEX IF NOT EXISTS idx_booking_reschedule_requests_requested_by ON public.booking_reschedule_requests (requested_by);
CREATE INDEX IF NOT EXISTS idx_booking_reschedule_requests_responded_by ON public.booking_reschedule_requests (responded_by);
CREATE INDEX IF NOT EXISTS idx_booking_reschedule_requests_responds_to_id ON public.booking_reschedule_requests (responds_to_id);
CREATE INDEX IF NOT EXISTS idx_booking_status_history_changed_by ON public.booking_status_history (changed_by);
CREATE INDEX IF NOT EXISTS idx_bookings_address_id ON public.bookings (address_id);
CREATE INDEX IF NOT EXISTS idx_bookings_arrival_confirmed_by ON public.bookings (arrival_confirmed_by);
CREATE INDEX IF NOT EXISTS idx_bookings_cancelled_by ON public.bookings (cancelled_by);
CREATE INDEX IF NOT EXISTS idx_bookings_dispute_resolved_by ON public.bookings (dispute_resolved_by);
CREATE INDEX IF NOT EXISTS idx_bookings_family_member_id ON public.bookings (family_member_id);
CREATE INDEX IF NOT EXISTS idx_bookings_no_show_reported_by ON public.bookings (no_show_reported_by);
CREATE INDEX IF NOT EXISTS idx_bookings_promo_code_id ON public.bookings (promo_code_id);
CREATE INDEX IF NOT EXISTS idx_bookings_service_id ON public.bookings (service_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status_changed_by ON public.bookings (status_changed_by);
CREATE INDEX IF NOT EXISTS idx_bookings_teaching_capability_id ON public.bookings (teaching_capability_id);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_booking_id ON public.coupon_redemptions (booking_id);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_user_id ON public.coupon_redemptions (user_id);
CREATE INDEX IF NOT EXISTS idx_customer_education_profiles_education_curriculum_id ON public.customer_education_profiles (education_curriculum_id);
CREATE INDEX IF NOT EXISTS idx_customer_education_profiles_education_level_id ON public.customer_education_profiles (education_level_id);
CREATE INDEX IF NOT EXISTS idx_disputes_opened_by ON public.disputes (opened_by);
CREATE INDEX IF NOT EXISTS idx_disputes_resolved_by ON public.disputes (resolved_by);
CREATE INDEX IF NOT EXISTS idx_family_members_education_curriculum_id ON public.family_members (education_curriculum_id);
CREATE INDEX IF NOT EXISTS idx_family_members_education_level_id ON public.family_members (education_level_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON public.messages (sender_id);
CREATE INDEX IF NOT EXISTS idx_no_show_reports_reported_by ON public.no_show_reports (reported_by);
CREATE INDEX IF NOT EXISTS idx_no_show_reports_resolved_by ON public.no_show_reports (resolved_by);
CREATE INDEX IF NOT EXISTS idx_notification_campaigns_created_by ON public.notification_campaigns (created_by);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_notification_id ON public.notification_outbox (notification_id);
CREATE INDEX IF NOT EXISTS idx_notifications_campaign_id ON public.notifications (campaign_id);
CREATE INDEX IF NOT EXISTS idx_payments_customer_id ON public.payments (customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_payment_method_id ON public.payments (payment_method_id);
CREATE INDEX IF NOT EXISTS idx_payments_reviewed_by ON public.payments (reviewed_by);
CREATE INDEX IF NOT EXISTS idx_paymob_webhook_events_payment_id ON public.paymob_webhook_events (payment_id);
CREATE INDEX IF NOT EXISTS idx_promo_codes_created_by ON public.promo_codes (created_by);
CREATE INDEX IF NOT EXISTS idx_provider_age_group_capabilities_verified_by ON public.provider_age_group_capabilities (verified_by);
CREATE INDEX IF NOT EXISTS idx_provider_documents_reviewed_by ON public.provider_documents (reviewed_by);
CREATE INDEX IF NOT EXISTS idx_provider_incidents_booking_id ON public.provider_incidents (booking_id);
CREATE INDEX IF NOT EXISTS idx_provider_incidents_reported_by ON public.provider_incidents (reported_by);
CREATE INDEX IF NOT EXISTS idx_provider_incidents_resolved_by ON public.provider_incidents (resolved_by);
CREATE INDEX IF NOT EXISTS idx_provider_requirement_fulfillments_reviewed_by ON public.provider_requirement_fulfillments (reviewed_by);
CREATE INDEX IF NOT EXISTS idx_provider_teaching_capabilities_reviewed_by ON public.provider_teaching_capabilities (reviewed_by);
CREATE INDEX IF NOT EXISTS idx_reviews_customer_id ON public.reviews (customer_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_assigned_admin_id ON public.support_tickets (assigned_admin_id);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_author_id ON public.ticket_messages (author_id);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket_id ON public.ticket_messages (ticket_id);
CREATE INDEX IF NOT EXISTS idx_transactions_payment_id ON public.transactions (payment_id);
CREATE INDEX IF NOT EXISTS idx_verification_records_provider_id ON public.verification_records (provider_id);
CREATE INDEX IF NOT EXISTS idx_verification_records_reviewed_by ON public.verification_records (reviewed_by);
CREATE INDEX IF NOT EXISTS idx_verification_records_verified_by ON public.verification_records (verified_by);

COMMIT;
