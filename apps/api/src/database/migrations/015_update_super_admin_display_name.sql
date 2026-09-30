-- Migration 015: Update Super Admin display name to Mr. Sparsh
UPDATE users
SET full_name = 'Mr. Sparsh', updated_at = NOW()
WHERE role = 'SUPER_ADMIN';
