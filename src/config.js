// Meridian RM Portal - connection settings
// ---------------------------------------------------------------------------
// MODE: "qlik" reads everything from a Qlik Cloud app.
//       "mock" reads the bundled data.json (no Qlik connection needed).
// Add ?mode=mock or ?mode=qlik to the page URL to override for one visit.
export const MODE = "qlik";

// Which Qlik Cloud tenant the portal reads from. Add ?tenant=anonymous or
// ?tenant=ukdemosaas to the page URL to override for one visit.
export const TENANT = "ukdemosaas";

const TENANTS = {
  // Signed-in access: each visitor logs in to Qlik Cloud (OAuth single-page app)
  ukdemosaas: {
    authType: "oauth2",
    host: "ukdemosaas.eu.qlikcloud.com",                 // tenant, without https://
    clientId: "a6c0a95b5e3ad86f95aa94a9de35c610",        // OAuth client (single-page app). No client secret.
    appId: "28e6bafe-14a0-4769-9960-eefd929bc87a",       // app loaded with rb_demo_load_script.qvs
    // Must match a redirect URL registered on the OAuth client exactly.
    redirectUri: new URL("oauth-callback.html", window.location.href).href,
    accessTokenStorage: "session",                       // "session" or "local"
  },

  // Anonymous access: no sign-in. Fill in the three values below.
  //  - host:       the anonymous tenant, e.g. "yourtenant.se.qlikcloud.com"
  //  - clientId:   the "Anonymous embed" OAuth client (its allowed origins must
  //                include the address this page is served from)
  //  - accessCode: from the app's Share dialog > Anyone with the link > cog > embed code
  //  - appId:      the PUBLISHED app in the managed space (not the original)
  // The access code is visible to anyone who opens the page; that is how
  // anonymous access works, so only use it for demo data.
  anonymous: {
    authType: "anonymous",
    host: "uk-presales-anon.se.qlikcloud.com",   // alias of 95ysr3wwvgfgc79.se.qlikcloud.com
    clientId: "01a144b83e5e8c200901d7edaab5eef9",
    accessCode: "30745a81-f464-450b-bddf-a077723e6a96.I0dP7KN0_hZ2GstcBUiS9NYpTmhMJ3QAvPU4Sbm7Z-A",
    appId: "9ec45352-fa31-4d97-b2bb-6945fa666183",
  },
};

const urlTenant = new URLSearchParams(window.location.search).get("tenant");
export const QLIK = TENANTS[urlTenant in TENANTS ? urlTenant : TENANT];

// @qlik/api build loaded from the CDN. Pin an exact version for demos if you prefer.
export const QLIK_API_URL = "https://cdn.jsdelivr.net/npm/@qlik/api@2/index.js";
