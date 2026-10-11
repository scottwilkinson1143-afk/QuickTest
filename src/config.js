// Meridian RM Portal - connection settings
// ---------------------------------------------------------------------------
// mode: "qlik" reads everything from the Qlik Cloud app below.
//       "mock" reads the bundled data.json (no Qlik connection needed).
// Add ?mode=mock or ?mode=qlik to the page URL to override for one visit.
export const MODE = "qlik";

export const QLIK = {
  // Qlik Cloud tenant, without https://
  host: "ukdemosaas.eu.qlikcloud.com",

  // OAuth client (single-page app, interactive login). No client secret.
  clientId: "a6c0a95b5e3ad86f95aa94a9de35c610",

  // The demonstrator app loaded with rb_demo_load_script.qvs (v2)
  appId: "28e6bafe-14a0-4769-9960-eefd929bc87a",

  // Must match a redirect URL registered on the OAuth client exactly.
  // Default: oauth-callback.html next to this page, e.g. http://localhost:8080/oauth-callback.html
  redirectUri: new URL("oauth-callback.html", window.location.href).href,

  // Where the access token is kept between page loads: "session" or "local"
  accessTokenStorage: "session",
};

// @qlik/api build loaded from the CDN. Pin an exact version for demos if you prefer.
export const QLIK_API_URL = "https://cdn.jsdelivr.net/npm/@qlik/api@2/index.js";
