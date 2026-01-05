const AUTH_WALL_MARKERS = [
  "auth_wall",
  "authwall",
  "join linkedin",
  "sign up",
  "sign in",
  "linkedin is better on the app",
];

export const isAuthWall = (html: string, text: string) => {
  const haystack = `${html}\n${text}`.toLowerCase();
  return AUTH_WALL_MARKERS.some((marker) => haystack.includes(marker));
};
