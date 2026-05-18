# Jewelry Dashboard Live Setup

## 1. Supabase setup

1. Open Supabase.
2. Create a project.
3. Go to SQL Editor.
4. Paste and run `supabase-setup.sql`.
5. Go to Authentication > Users and create users for admin and workers.
6. Go to Table Editor > profiles and add one row per user:

| id | full_name | role |
| --- | --- | --- |
| auth user id | Your Name | admin |
| auth user id | Worker Name | worker |

## 2. Add project keys

Open `config.js` and replace:

```js
url: "PASTE_SUPABASE_PROJECT_URL_HERE",
anonKey: "PASTE_SUPABASE_ANON_PUBLIC_KEY_HERE",
```

You can find these in Supabase > Project Settings > API.

## 3. Test locally

Open the dashboard and login with the Supabase email/password users.

If keys are not added yet, the app stays in demo mode.

## 4. Deploy free

1. Upload this folder to a GitHub repository.
2. Open Vercel.
3. Import the GitHub repository.
4. Deploy.
5. Open the Vercel URL and login.

This is a static app, so no build command is required.
