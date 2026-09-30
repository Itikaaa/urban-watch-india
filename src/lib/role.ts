export type AppRole = "user" | "authority";

const ROLE_KEY = "sadak-role";

export function sessionRole(): AppRole {
  if (typeof window === "undefined") return "user";
  return localStorage.getItem(ROLE_KEY) === "authority" ? "authority" : "user";
}

export function setSessionRole(role: AppRole) {
  localStorage.setItem(ROLE_KEY, role);
}

export function clearSessionRole() {
  localStorage.removeItem(ROLE_KEY);
}
