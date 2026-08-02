import {
  HunterDomainSearchError,
  normalizeHunterDomain,
  parseHunterDomainContacts,
  resolveHunterQuotaLimit,
  searchHunterDomainContacts,
  utcMonthStart,
} from "./hunter-domain-search.ts";

Deno.test("normalizes a Hunter company domain", () => {
  if (
    normalizeHunterDomain("https://www.Example.com/about") !== "example.com"
  ) {
    throw new Error("Expected a normalized apex domain");
  }
  if (normalizeHunterDomain("") !== null) {
    throw new Error("Expected an empty domain to be rejected");
  }
});

Deno.test("bounds recruiter-demo Hunter quota settings", () => {
  if (resolveHunterQuotaLimit(undefined, 2, 10) !== 2) {
    throw new Error("Expected the safe daily fallback");
  }
  if (resolveHunterQuotaLimit("200", 40, 50) !== 50) {
    throw new Error(
      "Expected configured limits to stay within the provider plan",
    );
  }
  if (resolveHunterQuotaLimit("invalid", 40, 50) !== 40) {
    throw new Error("Expected invalid configuration to use the safe fallback");
  }
});

Deno.test("computes the UTC Hunter quota month boundary", () => {
  const start = utcMonthStart(new Date("2026-08-31T23:59:59.000Z"));
  if (start.toISOString() !== "2026-08-01T00:00:00.000Z") {
    throw new Error("Expected a UTC calendar-month boundary");
  }
});

Deno.test("parses and ranks named personal Hunter contacts before generic addresses", () => {
  const contacts = parseHunterDomainContacts({
    data: {
      emails: [
        { value: "info@example.com", type: "generic", confidence: 90 },
        {
          value: "manager@example.com",
          type: "personal",
          first_name: "Mina",
          last_name: "Lee",
          position: "Sales Manager",
        },
        {
          value: "owner@example.com",
          type: "personal",
          first_name: "Omar",
          last_name: "Khan",
          position: "Founder & CEO",
        },
      ],
    },
  });

  if (
    contacts.map((contact) => contact.email).join(",") !==
      "owner@example.com,manager@example.com,info@example.com"
  ) {
    throw new Error("Expected executive personal contacts to rank first");
  }
});

Deno.test("calls the real Hunter domain-search endpoint without exposing its key in results", async () => {
  let requestedUrl: URL | null = null;
  const contacts = await searchHunterDomainContacts({
    apiKey: "hunter-secret",
    domain: "www.example.com",
    fetchImpl: (input) => {
      requestedUrl = new URL(String(input));
      return Promise.resolve(Response.json({
        data: {
          emails: [{
            value: "owner@example.com",
            type: "personal",
            first_name: "Omar",
            last_name: "Khan",
          }],
        },
      }));
    },
  });

  const observedUrl = requestedUrl as URL | null;
  if (!observedUrl || observedUrl.pathname !== "/v2/domain-search") {
    throw new Error("Expected the Hunter domain-search endpoint");
  }
  if (observedUrl.searchParams.get("api_key") !== "hunter-secret") {
    throw new Error("Expected the server-side Hunter credential");
  }
  if (
    observedUrl.searchParams.get("domain") !== "example.com" ||
    observedUrl.searchParams.get("limit") !== "5"
  ) {
    throw new Error("Expected the normalized domain and bounded result count");
  }
  if (JSON.stringify(contacts).includes("hunter-secret")) {
    throw new Error(
      "Hunter credentials must not enter persisted contact results",
    );
  }
});

Deno.test("classifies Hunter throttling as retryable", async () => {
  try {
    await searchHunterDomainContacts({
      apiKey: "hunter-secret",
      domain: "example.com",
      fetchImpl: () =>
        Promise.resolve(
          Response.json({ errors: [{ details: "rate limited" }] }, {
            status: 429,
          }),
        ),
    });
  } catch (error: unknown) {
    if (
      !(error instanceof HunterDomainSearchError) || error.statusCode !== 429 ||
      !error.retryable
    ) {
      throw new Error("Expected a retryable Hunter throttling error");
    }
    return;
  }
  throw new Error("Expected Hunter throttling to fail");
});
