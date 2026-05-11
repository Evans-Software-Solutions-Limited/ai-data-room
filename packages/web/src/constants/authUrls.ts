// Used as `<a href>` / `window.location.assign` targets, never as
// `fetch` URLs — each redirect chain ends with a `Set-Cookie` from
// our API that only sticks if the browser performs the navigation.

import { CORE_API_URL } from "@/constants/api";

export function getAuthSignInHref(): string {
  return `${CORE_API_URL}/auth/sign-in`;
}

export function getAuthSignUpHref(): string {
  return `${CORE_API_URL}/auth/sign-up`;
}

export function getAuthSignOutHref(): string {
  return `${CORE_API_URL}/auth/sign-out`;
}
