# FlatMate — Netlify + Supabase deployment

## Architecture

- Netlify hosts the unchanged HTML/CSS UI, the JavaScript application, the 100-profile JSON dataset and the compiled C++ WebAssembly module.
- Supabase Auth manages real shared user accounts.
- Supabase Postgres stores registered profiles and likes across devices/users.
- `matching_core.cpp` contains the C++ OOP matching strategy/service compiled to WebAssembly. Compatibility calculations and city-first sorting remain in C++.
- `main.cpp` is retained as the original native C++ HTTP-server version for local/native execution. Netlify does not run that long-lived HTTP server.

## 1. Create Supabase project

1. Create a project at https://supabase.com/.
2. Open SQL Editor.
3. Run the complete `supabase/schema.sql`.
4. Open Project Settings → API.
5. Copy the Project URL and the `anon` / publishable public key.
6. Open Authentication → Providers → Email. You may keep email confirmation enabled: the app now shows a confirmation message and lets the user log in after confirming. If confirmation is disabled, registration signs the user in immediately.

## 2. Configure the browser client

Edit `supabase-config.js`:

```js
window.FLATMATE_SUPABASE_URL = "https://YOUR_PROJECT.supabase.co";
window.FLATMATE_SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY";
```

Use only the anon/publishable key. Never expose a `service_role` key in frontend files.

## 3. Deploy to Netlify

1. Push the complete folder to a GitHub repository.
2. In Netlify, choose Add new site → Import an existing project.
3. Select the repository.
4. Netlify reads `netlify.toml`; build command is `bash scripts/build-wasm.sh` and publish directory is `.`.
5. Deploy. The build script downloads Emscripten and compiles `matching_core.cpp` into `matching.js` and `matching.wasm`.
6. Open the deployed site and register a new account.

## 4. What is shared and persistent

- Authentication: Supabase Auth.
- User name, bio and preferences: Supabase `profiles`.
- Likes/saved profiles: Supabase `likes`.
- Demo profiles: shared read-only `demo_profiles.json` (100 records).
- Profile photos: remain browser-local in this version, as in the original project. They are not synchronized between devices.
- Profile visibility: a profile is private to its owner until the questionnaire is saved. Saving sets `has_profile = true`; completed profiles then become discoverable by other authenticated FlatMate users under the `profiles` table RLS policy. Email addresses are not included in public profile objects.
- Questionnaire: city, budget, routine, lifestyle and living-preference answers are saved to the owner's `profiles.preferences` JSONB field. Editing and saving the questionnaire updates the same profile and keeps it discoverable.
- Login and registration do not require the C++ WebAssembly module or demo dataset to load. Those assets are initialized only when Discover is opened, so a matching-engine build problem cannot disable the authentication form.

## 5. Important notes

- `main.cpp` remains available as the original native server source, but Netlify cannot host its always-running HTTP listener. Netlify executes the C++ matching engine as WebAssembly in the browser. This keeps the matching algorithm in C++ OOP while Supabase provides shared persistence.
- There are no Netlify Functions or separate C++ API server in this architecture.
- The first Emscripten build can take several minutes because the SDK is downloaded during the build.
- Existing `accounts.json` passwords are not imported. Create accounts through Supabase Auth. The old hard-coded Aarav/Ishita demo login buttons now explain that demo profiles are discovered after registration; they are not real shared auth accounts.
- Passwords are managed by Supabase Auth and are not stored in the `profiles` table.
- Do not commit private Supabase service-role credentials.
