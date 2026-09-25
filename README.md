# Shef Admin

A small, single-file editor for the Shef Math Dev problem database.

Open a problem, edit it, and press **Save**. Save updates the existing database row immediately. There is no draft/review workflow, undo feature, automatic write retry or background sync.

## Setup

Serve `index.html` with any static web server (or GitHub Pages). There is no build step. The page uses pinned Supabase and KaTeX browser libraries.

The page targets Shef Math Dev (`vgywfubjrdvwkovvrant`). Its public client key is safe to include in the HTML; access is controlled by Supabase Auth and database row-level policies. Never replace it with a service-role or secret key.

Install the `simple_problem_admin` migration supplied in the mobile repository's `supabase/migrations` directory. An operator must add the intended existing Dev Auth account to `public.admin_accounts`; signing in alone does not grant editing access. Admin membership is never editable through this page.

## Sign in and grant admin access

Use **Continue with Google** with the same Google account you use in the Dev mobile app. Email/password sign-in remains available for Dev accounts that already have a password. There is no separate admin signup form.

Signing in identifies your Dev account; it does not make the account an admin. An operator grants access once in the Dev Supabase dashboard:

1. Find the intended account under **Authentication → Users** and copy its user UUID.
2. Under **Table Editor → public.admin_accounts**, add a row with that UUID as `id`, the account's email, and an optional `display_name`. Let `created_at` use its default.
3. Sign in again to the panel. Accounts without a matching admin row cannot open the editor.

For hosting, enable the Google provider and include the panel's exact URL in Supabase **Authentication → URL Configuration → Redirect URLs**. For the local preview, allow `http://127.0.0.1:8866/`; when hosted, allow its exact deployed URL. The button returns to the current origin and path (without query parameters or the hash). Serve the file over HTTP locally or HTTPS when hosted.

## Editing

Search for a problem by its integer ID, text or note/reference. Existing UUIDs, integer IDs and creation timestamps are preserved. MCQ correct answers are stored as the selected choice's text. A numeric answer of `0` is valid; a blank answer is not.

The CMS reference in a note (`CMS: <UUID>`) stays protected. Existing images and diagram source are preserved. The preview displays supported math and existing images; it is not a diagram compiler or a substitute for checking unusual content on the mobile app.

A save sends only changed fields in one update. A failed request displays an error and is not retried. If the connection fails after the server may have saved, reload the problem to inspect its current contents.

## Export to CMS

Select saved problems and export their JSON, or export the problem currently open. Save any corrections first. Each export/import file can contain at most **2,000 problems**; split larger selections into smaller files. The file uses `shef-mobile-corrections-v1` and contains the source project, export time, actual saved problem fields and existing image metadata. It contains no authentication credentials.

In the CMS Import screen, choose the mobile corrections file and use its single Import action. A recognized `CMS: <UUID>` updates the corresponding problem. The receiver preserves CMS-only editorial information and existing child identities. Unknown images or ambiguous changed hint/solution shapes report an item error rather than replacing unrelated CMS content. This receiver requires its accompanying CMS migration and reviewer access.

## Import missing problems

The page can receive its own Dev JSON exports. Import skips records whose statement or nonempty reference/note already exists; it does not overwrite them. To correct an existing problem, open it and use Save. Imported images must already exist in Dev Storage; this utility does not copy images between environments.

The existing CMS ZIP-to-mobile operator importer remains available in the mobile repository for full CMS exports and image transfers.

## Development

The runtime application is only `index.html`. Tests and database migrations are development/setup files; they are not a frontend build system.

The browser regression suite requires Node.js 22+ and Google Chrome. It intercepts every request and uses a fake database; it cannot change live problems. Install test dependencies in a temporary directory, then run from this repository:

```sh
test_deps="$(mktemp -d)"
npm install --prefix "$test_deps" --no-save --package-lock=false playwright@1.62.1
NODE_PATH="$test_deps/node_modules" node --test tests/admin.test.cjs
```

One optional smoke test uses the real pinned KaTeX renderer. Download its public files into a temporary directory with these filenames:

```sh
math_fixtures="$(mktemp -d)"
curl -fsSL https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.js -o "$math_fixtures/shef-katex.js"
curl -fsSL https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/contrib/auto-render.min.js -o "$math_fixtures/shef-katex-auto.js"
curl -fsSL https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css -o "$math_fixtures/shef-katex.css"
KATEX_FIXTURE_DIR="$math_fixtures" NODE_PATH="$test_deps/node_modules" node --test tests/admin.test.cjs
```

Without `KATEX_FIXTURE_DIR`, only the renderer smoke test is skipped. Desktop and narrow screenshots are written to the operating system's temporary directory as `shef-admin-desktop.png` and `shef-admin-mobile.png`. Test dependencies and fixtures are not deployed with the page.
