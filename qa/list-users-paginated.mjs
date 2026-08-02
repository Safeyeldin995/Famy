// Paginated auth.admin.listUsers helper for QA harnesses.

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {(user: { id: string; email?: string; phone?: string }) => boolean} [predicate]
 */
export async function listAllAuthUsers(admin, predicate = () => true) {
  const matched = [];
  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const batch = data.users ?? [];
    for (const user of batch) {
      if (predicate(user)) matched.push(user);
    }
    if (batch.length < perPage) break;
    page += 1;
  }

  return matched;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} phone E.164 or local digits
 */
export async function findAuthUserByPhone(admin, phone) {
  const normalized = phone.replace(/\D/g, "");
  const users = await listAllAuthUsers(admin, (user) => {
    const userPhone = (user.phone ?? "").replace(/\D/g, "");
    return userPhone === normalized || userPhone === normalized.replace(/^20/, "");
  });
  return users[0] ?? null;
}
