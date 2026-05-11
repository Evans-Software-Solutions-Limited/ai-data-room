interface DisplayableUser {
  fullName: string | null;
  email: string | null;
}

export function formatUserDisplayName(user: DisplayableUser): string {
  const trimmed = user.fullName?.trim();
  if (trimmed && trimmed.length > 0) return trimmed;
  return user.email ?? "Unknown user";
}
