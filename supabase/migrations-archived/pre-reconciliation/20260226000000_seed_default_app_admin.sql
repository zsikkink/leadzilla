-- Seed default admin so RLS policies using is_app_admin() return rows.
-- Inserts the first confirmed user as an admin. If no confirmed users exist
-- yet (e.g. fresh deploy), run this manually after creating the first user:
--   INSERT INTO public.app_admins (user_id) VALUES ('<your-user-uuid>') ON CONFLICT DO NOTHING;
INSERT INTO public.app_admins (user_id)
SELECT id FROM auth.users
WHERE email_confirmed_at IS NOT NULL
ORDER BY created_at ASC
LIMIT 1
ON CONFLICT DO NOTHING;
