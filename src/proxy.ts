import { clerkMiddleware } from "@clerk/nextjs/server";

const localAuthorizedParties = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

function invalidAuthorizedParties(message: string) {
  return new Error(`Invalid CLERK_AUTHORIZED_PARTIES: ${message}`);
}

function resolveAuthorizedParties(value: string | undefined) {
  if (value === undefined) return localAuthorizedParties;

  const entries = value.split(",");
  if (entries.length === 0 || entries.some((entry) => entry.trim() === "")) {
    throw invalidAuthorizedParties("provide one or more comma-separated origins.");
  }

  const origins = entries.map((entry, index) => {
    const candidate = entry.trim();
    if (!/^https?:\/\/[^/?#\\@\s]+\/?$/i.test(candidate)) {
      throw invalidAuthorizedParties(
        `entry ${index + 1} must be an exact URL origin.`,
      );
    }

    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      throw invalidAuthorizedParties(`entry ${index + 1} is not an absolute URL origin.`);
    }

    const isLoopbackHttp =
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    if (url.protocol !== "https:" && !isLoopbackHttp) {
      throw invalidAuthorizedParties(
        `entry ${index + 1} must use HTTPS unless it is a local loopback origin.`,
      );
    }
    if (url.hostname.includes("*")) {
      throw invalidAuthorizedParties(`entry ${index + 1} cannot contain a wildcard.`);
    }
    if (url.username || url.password) {
      throw invalidAuthorizedParties(`entry ${index + 1} cannot contain credentials.`);
    }
    if (url.pathname !== "/" || url.search || url.hash) {
      throw invalidAuthorizedParties(
        `entry ${index + 1} must not contain a path, query, or fragment.`,
      );
    }

    return url.origin;
  });

  return [...new Set(origins)];
}

export default clerkMiddleware({
  authorizedParties: resolveAuthorizedParties(
    process.env.CLERK_AUTHORIZED_PARTIES,
  ),
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
