const test = require("node:test");
const assert = require("node:assert/strict");

const { parseAuthLink } = require("../app.js");

test("accepts the project's magic-link token", () => {
  assert.deepEqual(
    parseAuthLink(
      "https://amijlzfjamcstxchwkud.supabase.co/auth/v1/verify?token=abc123&type=magiclink"
    ),
    { tokenHash: "abc123", type: "magiclink" }
  );
});

test("accepts an email token hash", () => {
  assert.deepEqual(
    parseAuthLink(
      "https://amijlzfjamcstxchwkud.supabase.co/auth/v1/verify?token_hash=hash456&type=email"
    ),
    { tokenHash: "hash456", type: "email" }
  );
});

test("rejects links outside the expected Supabase verification endpoint", () => {
  const invalidLinks = [
    "not a URL",
    "https://example.com/auth/v1/verify?token=abc&type=magiclink",
    "https://amijlzfjamcstxchwkud.supabase.co/other?token=abc&type=magiclink",
    "https://amijlzfjamcstxchwkud.supabase.co/auth/v1/verify?type=magiclink",
    "https://amijlzfjamcstxchwkud.supabase.co/auth/v1/verify?token=abc&type=recovery",
  ];

  for (const link of invalidLinks) {
    assert.equal(parseAuthLink(link), null);
  }
});
