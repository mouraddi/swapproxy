// ---------------------------------------------------------------------------
// ANTI-DETECTION – rotate fingerprints per request
// ---------------------------------------------------------------------------

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0",
];

const ACCEPT_LANGUAGES = [
  "en-US,en;q=0.9",
  "en-GB,en;q=0.8",
  "en-US,en;q=0.9,ar;q=0.8",
  "en;q=0.9",
];

const SEC_CH_UA = [
  '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
  '"Google Chrome";v="124", "Chromium";v="124", "Not.A/Brand";v="24"',
  '"Chromium";v="125", "Google Chrome";v="125", "Not.A/Brand";v="24"',
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function forgeHeaders(incoming) {
  const headers = { ...incoming };

  // Override user-agent
  headers["user-agent"] = pickRandom(USER_AGENTS);

  // Set accept-language if missing
  if (!headers["accept-language"]) {
    headers["accept-language"] = pickRandom(ACCEPT_LANGUAGES);
  }

  // Set sec-ch-ua for Chrome-like fingerprint
  if (!headers["sec-ch-ua"]) {
    headers["sec-ch-ua"] = pickRandom(SEC_CH_UA);
  }

  // Mask as Chrome
  if (!headers["sec-ch-ua-mobile"]) {
    headers["sec-ch-ua-mobile"] = "?0";
  }
  if (!headers["sec-ch-ua-platform"]) {
    headers["sec-ch-ua-platform"] = '"Windows"';
  }

  // DNT
  if (!headers["dnt"]) {
    headers["dnt"] = "1";
  }

  return headers;
}

module.exports = { forgeHeaders, USER_AGENTS };
