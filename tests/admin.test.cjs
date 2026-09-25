// Run: NODE_PATH=/path/to/node_modules node --test tests/admin.test.cjs
// Optional real renderer smoke: KATEX_FIXTURE_DIR=/path/containing/shef-katex.js,+auto.js,+css
// All requests are intercepted. No real Supabase connection or writes are made.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { chromium } = require("playwright");
const originalHTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const html = originalHTML
  .replace(/<script src=[^>]*><\/script>/g, "")
  .replace(/<link[^>]*katex[^>]*>/g, "");
const fixture = {
  id: "11111111-1111-4111-8111-111111111111",
  integer_id: 42,
  statement: "What is $2+3$?\nKeep the whitespace. ",
  problem_type: "mc_single_select",
  choices: ["$4$", "$5$", "$6$"],
  correct_choice: "$5$",
  correct_value: null,
  fields: ["algebra"],
  themes: ["Addition, subtraction", "  Whitespace  "],
  hints: null,
  solution: ["Add $2$ and $3$."],
  note: "CMS: 22222222-2222-4222-8222-222222222222",
  rating_type: "single",
  single_value: 10,
  range_min: null,
  range_max: null,
  quality: 1,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};
const numeric = {
  ...fixture,
  id: "33333333-3333-4333-8333-333333333333",
  integer_id: 43,
  statement: "Find the number of solutions.",
  problem_type: "numeric_nonneg",
  correct_value: 0,
  choices: null,
  correct_choice: null,
  themes: [],
  hints: [],
  solution: null,
  note: "Legacy reference",
};
const asset = {
  id: "44444444-4444-4444-8444-444444444444",
  problem_id: fixture.id,
  asset_key: "diagram-1",
  cms_asset_id: null,
  bucket: "problem-images",
  storage_path: "sha256/abc.png",
  public_url: "https://example.test/diagram.png",
  content_type: "image/png",
  byte_size: 123,
  sha256: "a".repeat(64),
  width: 300,
  height: 200,
  created_at_utc: "2026-01-01T00:00:00Z",
};
let browser;
before(async () => (browser = await chromium.launch({ headless: true, channel: "chrome" })));
after(async () => browser?.close());
async function setup(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } }),
    page = await context.newPage();
  await page.route("**/*", (route) =>
    route.request().url() === "https://admin.test/"
      ? route.fulfill({ contentType: "text/html", body: html })
      : route.request().url().startsWith("https://example.test/")
        ? route.fulfill({
            contentType: "image/png",
            body: Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8r8AAAAASUVORK5CYII=",
              "base64",
            ),
          })
        : route.abort(),
  );
  await page.addInitScript(
    ({ fixture, numeric, asset, options }) => {
      const rows = [fixture, numeric],
        calls = [],
        assets = [asset];
      let listener;
      window.mock = {
        rows,
        calls,
        assets,
        failSave: false,
        authCallback: () => listener,
        downloads: [],
        retries: [],
        oauthCalls: [],
      };
      class Query {
        constructor(table) {
          this.table = table;
          this.filters = [];
          this.start = 0;
          this.end = 9999;
        }
        retry(enabled) {
          window.mock.retries.push(enabled);
          return this;
        }
        select() {
          return this;
        }
        order() {
          return this;
        }
        range(start, end) {
          this.start = start;
          this.end = end;
          return this;
        }
        eq(key, value) {
          this.filters.push((row) => row[key] === value);
          return this;
        }
        in(key, value) {
          this.filters.push((row) => value.includes(row[key]));
          return this;
        }
        update(patch) {
          this.patch = patch;
          return this;
        }
        async run() {
          if (this.table === "admin_accounts") {
            if (options.delayAdmin)
              await new Promise((resolve) => (window.mock.resolveAdmin = resolve));
            return {
              data: options.nonadmin
                ? null
                : { id: "admin-1", email: "admin@example.test", display_name: "Salko" },
              error: null,
            };
          }
          let found = (this.table === "problem_assets" ? assets : rows)
            .filter((row) => this.filters.every((fn) => fn(row)))
            .slice(this.start, this.end + 1);
          if (this.patch) {
            calls.push({
              operation: "update",
              patch: structuredClone(this.patch),
              id: found[0]?.id,
            });
            if (window.mock.failSave)
              return { data: null, error: { message: "Network unavailable" } };
            found.forEach((row) => Object.assign(row, this.patch));
          }
          return { data: structuredClone(found), error: null };
        }
        async single() {
          const result = await this.run();
          return { ...result, data: Array.isArray(result.data) ? result.data[0] : result.data };
        }
        maybeSingle() {
          return this.single();
        }
        then(resolve, reject) {
          return this.run().then(resolve, reject);
        }
      }
      window.supabase = {
        createClient: (url, key, config) => {
          window.mock.config = config;
          return {
            from: (table) => new Query(table),
            rpc: (name, { p_problem: p }) => {
              const result = (value) => ({
                retry: (enabled) => {
                  window.mock.retries.push(enabled);
                  return Promise.resolve(value);
                },
              });
              calls.push({ operation: "rpc", name, payload: structuredClone(p) });
              const match = rows.find(
                (row) => row.statement === p.statement || (p.note && row.note === p.note),
              );
              if (match)
                return result({
                  data: {
                    status: "skipped",
                    id: match.id,
                    integer_id: match.integer_id,
                    matched_by: "note",
                  },
                  error: null,
                });
              const row = {
                ...structuredClone(p),
                id: "new-" + rows.length,
                integer_id: 100 + rows.length,
              };
              rows.push(row);
              return result({
                data: {
                  status: "inserted",
                  id: row.id,
                  integer_id: row.integer_id,
                  matched_by: null,
                },
                error: null,
              });
            },
            auth: {
              getSession: async () => ({
                data: {
                  session: options.signedOut
                    ? null
                    : { user: { id: "admin-1", email: "admin@example.test" } },
                },
                error: null,
              }),
              onAuthStateChange: (fn) => {
                listener = fn;
              },
              signInWithOAuth: async (args) => {
                window.mock.oauthCalls.push(structuredClone(args));
                if (options.delayOAuth)
                  await new Promise((resolve) => (window.mock.resolveOAuth = resolve));
                return {
                  data: { provider: "google", url: "https://accounts.google.test/" },
                  error: options.oauthError ? { message: options.oauthError } : null,
                };
              },
              signInWithPassword: async () => ({
                data: { session: { user: { id: "admin-1" } } },
                error: null,
              }),
              signOut: async () => {
                listener("SIGNED_OUT", null);
                return { error: null };
              },
            },
          };
        },
      };
      const create = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (blob) => {
        blob.text().then((value) => window.mock.downloads.push(value));
        return create(blob);
      };
    },
    { fixture, numeric, asset, options },
  );
  await page.goto("https://admin.test/");
  if (!options.delayAdmin)
    await page.waitForSelector(
      options.signedOut ? "#loginView" : options.nonadmin ? "#message" : "#appView",
      { state: "visible" },
    );
  if (options.math && process.env.KATEX_FIXTURE_DIR) {
    const dir = process.env.KATEX_FIXTURE_DIR;
    await page.addStyleTag({ content: fs.readFileSync(path.join(dir, "shef-katex.css"), "utf8") });
    await page.addScriptTag({ content: fs.readFileSync(path.join(dir, "shef-katex.js"), "utf8") });
    await page.addScriptTag({
      content: fs.readFileSync(path.join(dir, "shef-katex-auto.js"), "utf8"),
    });
  }
  return { page, context };
}
async function open(page, number = 42) {
  await page.getByRole("button", { name: new RegExp("#" + number + " ") }).click();
  await page.locator("#editorForm").waitFor({ state: "visible" });
}
async function calls(page) {
  return page.evaluate(() => mock.calls);
}

test("direct save sends only the changed field; notes, arrays, whitespace and identity stay intact", async () => {
  const { page, context } = await setup();
  await open(page);
  assert.equal(await page.locator("#note").getAttribute("readonly"), "");
  await page.locator("#statement").fill("Corrected $2+3$.  ");
  await page.locator("#save").click();
  await page.getByText("Problem #42 saved to Dev.").waitFor();
  assert.deepEqual(await calls(page), [
    { operation: "update", patch: { statement: "Corrected $2+3$.  " }, id: fixture.id },
  ]);
  assert.deepEqual(await page.evaluate(() => mock.rows[0].themes), fixture.themes);
  assert.equal(await page.evaluate(() => mock.rows[0].hints), null);
  assert.equal(
    await page.evaluate(
      () => mock.retries.length > 0 && mock.retries.every((value) => value === false),
    ),
    true,
  );
  await context.close();
});
test("editing and reordering the correct choice keeps the same row selected", async () => {
  const { page, context } = await setup();
  await open(page);
  await page.locator("#choices textarea").nth(1).fill("$7$");
  await page
    .locator("#choices .repeat-row")
    .nth(1)
    .getByRole("button", { name: "Move up" })
    .click();
  assert.equal(
    await page.locator("#choices .repeat-row").first().locator("input[type=radio]").isChecked(),
    true,
  );
  await page.locator("#save").click();
  await page.getByText("Problem #42 saved to Dev.").waitFor();
  const log = await calls(page);
  assert.deepEqual(log[0].patch, { choices: ["$7$", "$4$", "$6$"], correct_choice: "$7$" });
  await context.close();
});
test("removing the correct choice requires an explicit replacement, never silently picks first", async () => {
  const { page, context } = await setup();
  await open(page);
  await page
    .locator("#choices .repeat-row")
    .nth(1)
    .getByRole("button", { name: "Remove row" })
    .click();
  await page.locator("#save").click();
  await page.getByText("Select the correct answer.").waitFor();
  assert.equal((await calls(page)).length, 0);
  await context.close();
});
test("numeric blank is rejected, zero accepted, and adding never updates the previously opened ID", async () => {
  const { page, context } = await setup();
  await open(page, 43);
  await page.locator("#correctValue").fill("");
  await page.locator("#save").click();
  await page.getByText("Correct answer must be an integer from 0 to 2147483647.").waitFor();
  assert.equal((await calls(page)).length, 0);
  await page.locator("#closeEditor").click();
  await page.locator("#addProblem").click();
  await page.locator("#problemType").selectOption("numeric_nonneg");
  await page.locator("#statement").fill("New numeric problem");
  await page.locator("#fields input[value=algebra]").check();
  await page.locator("#correctValue").fill("0");
  await page.locator("#save").click();
  await page.getByText("Problem #102 saved to Dev.").waitFor();
  const log = await calls(page);
  assert.equal(log.length, 1);
  assert.equal(log[0].operation, "rpc");
  assert.equal(log[0].payload.correct_value, 0);
  assert.equal(log[0].payload.id, undefined);
  await context.close();
});
test("failed save stays editable and submits just once", async () => {
  const { page, context } = await setup();
  await open(page);
  await page.evaluate(() => (mock.failSave = true));
  await page.locator("#statement").fill("Unsaved correction");
  await page.locator("#save").click();
  await page.getByText("Save failed: Network unavailable").waitFor();
  assert.equal((await calls(page)).length, 1);
  assert.equal(await page.locator("#statement").inputValue(), "Unsaved correction");
  assert.equal(await page.locator("#statement").isEnabled(), true);
  await context.close();
});
test("selected export contains original database identity and complete assets", async () => {
  const { page, context } = await setup();
  await page.getByRole("checkbox", { name: "Select problem 42", exact: true }).check();
  await page.locator("#exportSelected").click();
  await page.getByText("Exported 1 saved problem for the CMS.").waitFor();
  await page.waitForFunction(() => mock.downloads.length === 1);
  const pack = JSON.parse(await page.evaluate(() => mock.downloads[0]));
  assert.equal(pack.format, "shef-mobile-corrections-v1");
  assert.equal(pack.source_project, "vgywfubjrdvwkovvrant");
  assert.deepEqual(pack.problems, [{ ...fixture, assets: [asset] }]);
  await context.close();
});
test("import strips problem and asset identity, skips duplicates and rejects foreign project files", async () => {
  const { page, context } = await setup();
  const pack = {
    format: "shef-mobile-corrections-v1",
    source_project: "vgywfubjrdvwkovvrant",
    problems: [
      { ...fixture, assets: [asset] },
      { ...numeric, statement: "Unique import", note: "different note" },
    ],
  };
  await page.locator("#importFile").setInputFiles({
    name: "problems.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(pack)),
  });
  await page.getByText("Import complete: 1 added, 1 duplicates skipped.").waitFor();
  const log = await calls(page);
  assert.equal(log.length, 2);
  assert.equal(log[0].payload.id, undefined);
  assert.equal(log[0].payload.integer_id, undefined);
  assert.equal(log[0].payload.assets[0].id, undefined);
  assert.equal(log[0].payload.assets[0].problem_id, undefined);
  assert.equal(log[0].payload.assets[0].created_at_utc, undefined);
  assert.equal(log[0].payload.assets[0].asset_key, "diagram-1");
  pack.source_project = "other";
  await page.locator("#importFile").setInputFiles({
    name: "wrong.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(pack)),
  });
  await page
    .getByText("Import failed: This file is not from the Shef Math Dev database.")
    .waitFor();
  assert.equal((await calls(page)).length, 2);
  await context.close();
});
test("untrusted text stays text and both image conventions accept only HTTPS", async () => {
  const { page, context } = await setup();
  await open(page);
  await page
    .locator("#statement")
    .fill(
      "<img src=x onerror=window.pwned=1> \\includegraphics{https://example.test/figure.png} \\begin{asy}[png=https://example.test/asy.png]code\\end{asy} \\includegraphics{javascript:alert(1)}",
    );
  assert.equal(await page.evaluate(() => window.pwned), undefined);
  assert.equal(await page.locator("#preview img").count(), 2);
  assert.equal(
    await page
      .locator("#preview")
      .textContent()
      .then((v) => v.includes("<img src=x")),
    true,
  );
  assert.equal(
    await page
      .locator("#preview")
      .textContent()
      .then((v) => v.includes("Diagram URL cannot be previewed.")),
    true,
  );
  await context.close();
});
test("non-admin never sees the editor", async () => {
  const { page, context } = await setup({ nonadmin: true });
  assert.equal(await page.locator("#appView").isVisible(), false);
  assert.equal((await calls(page)).length, 0);
  await context.close();
});
test("signout cancels a pending admin lookup", async () => {
  const { page, context } = await setup({ delayAdmin: true });
  await page.waitForFunction(() => Boolean(mock.resolveAdmin));
  await page.evaluate(() => {
    mock.authCallback()("SIGNED_OUT", null);
    mock.resolveAdmin();
  });
  await page.locator("#loginView").waitFor({ state: "visible" });
  assert.equal(await page.locator("#appView").isVisible(), false);
  await context.close();
});
test("desktop and narrow views have no horizontal overflow", async () => {
  const { page, context } = await setup({ math: true });
  await open(page);
  await page.locator("#hintsDetails").evaluate((n) => (n.open = true));
  await page.screenshot({ path: path.join(os.tmpdir(), "shef-admin-desktop.png"), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(os.tmpdir(), "shef-admin-mobile.png"), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await context.close();
});

test(
  "real pinned KaTeX renders edits while preserving source",
  { skip: !process.env.KATEX_FIXTURE_DIR },
  async () => {
    const { page, context } = await setup({ math: true });
    await open(page);
    await page.locator("#statement").fill("Find $x^2$ when $x=3$.");
    assert.equal((await page.locator("#preview .katex").count()) > 1, true);
    assert.equal(await page.locator("#statement").inputValue(), "Find $x^2$ when $x=3$.");
    await context.close();
  },
);

test("export blocks unsaved corrections after a failed save", async () => {
  const { page, context } = await setup();
  await open(page);
  await page.getByRole("checkbox", { name: "Select problem 42", exact: true }).check();
  await page.evaluate(() => (mock.failSave = true));
  await page.locator("#statement").fill("Correction awaiting save");
  await page.locator("#save").click();
  await page.getByText("Save failed: Network unavailable").waitFor();
  await page.locator("#exportSelected").click();
  await page.getByText("Save this problem before exporting its corrections.").waitFor();
  assert.equal(await page.evaluate(() => mock.downloads.length), 0);
  assert.equal(await page.locator("#statement").inputValue(), "Correction awaiting save");
  assert.equal((await calls(page)).length, 1);
  await context.close();
});
test("import and export reject more than 2,000 problems before any transfer", async () => {
  const { page, context } = await setup();
  await page.evaluate(() => exportProblems(Array(2001).fill("unused")));
  await page
    .getByText("Export at most 2,000 problems at a time. Split your selection into smaller files.")
    .waitFor();
  const pack = {
    format: "shef-mobile-corrections-v1",
    source_project: "vgywfubjrdvwkovvrant",
    problems: Array(2001).fill(fixture),
  };
  await page.locator("#importFile").setInputFiles({
    name: "too-many.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(pack)),
  });
  await page.getByText("Import failed: Import at most 2,000 problems at a time.").waitFor();
  assert.equal((await calls(page)).length, 0);
  assert.equal(await page.evaluate(() => mock.downloads.length), 0);
  await context.close();
});

test("Google sign in requests the exact current-page callback once", async () => {
  const { page, context } = await setup({ signedOut: true, delayOAuth: true });
  await page.evaluate(() =>
    history.replaceState({}, "", "/admin/index.html?ignore=this#ignore-this"),
  );
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await page.waitForFunction(() => Boolean(mock.resolveOAuth));
  assert.equal(await page.locator("#googleSignIn").isDisabled(), true);
  assert.equal(await page.locator("#signIn").isDisabled(), true);
  await page.evaluate(() => {
    document.getElementById("googleSignIn").click();
    document.getElementById("loginForm").dispatchEvent(new Event("submit", { cancelable: true }));
  });
  assert.deepEqual(await page.evaluate(() => mock.oauthCalls), [
    { provider: "google", options: { redirectTo: "https://admin.test/admin/index.html" } },
  ]);
  assert.equal((await calls(page)).length, 0);
  assert.equal(await page.locator("#appView").isVisible(), false);
  await page.evaluate(() => mock.resolveOAuth());
  await page.getByRole("button", { name: "Continue with Google", exact: true }).waitFor();
  assert.equal(await page.locator("#appView").isVisible(), false);
  await context.close();
});
test("Google sign in error re-enables login without retrying or granting access", async () => {
  const { page, context } = await setup({ signedOut: true, oauthError: "Provider unavailable" });
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await page.getByText("Google sign in failed: Provider unavailable").waitFor();
  assert.equal(await page.locator("#googleSignIn").isEnabled(), true);
  assert.equal(await page.locator("#signIn").isEnabled(), true);
  assert.equal(await page.evaluate(() => mock.oauthCalls.length), 1);
  assert.equal((await calls(page)).length, 0);
  assert.equal(await page.locator("#appView").isVisible(), false);
  await context.close();
});
