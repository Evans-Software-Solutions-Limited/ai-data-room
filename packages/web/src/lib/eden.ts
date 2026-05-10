import { treaty } from "@elysiajs/eden";
import { type CoreApi } from "@ai-data-room/core";

import { CORE_API_URL } from "@/constants/api";

// `credentials: "include"` is required for the `HttpOnly`
// `wos_session` cookie to ride along with authenticated XHRs —
// `fetch`'s default `same-origin` mode strips cookies even on
// same-origin requests when the URL doesn't exactly match the page
// origin including scheme.
export const api = {
  core: treaty<CoreApi>(CORE_API_URL, {
    fetch: {
      credentials: "include",
    },
  }),
};
