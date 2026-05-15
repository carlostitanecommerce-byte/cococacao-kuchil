
-- Add username column to profiles
ALTER TABLE public.profiles ADD COLUMN username text UNIQUE;
