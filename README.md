This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Authentication and database foundation

Clerk provides application authentication. The Supabase foundation uses Clerk's native third-party authentication integration so PostgreSQL and Storage policies can authorize the current Clerk session through its `sub` claim.

Configure these application variables in the repository-root `.env.local` file for local Next.js development and in the corresponding Vercel project environment settings for deployed environments:

```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
CLERK_AUTHORIZED_PARTIES=http://localhost:3000,http://127.0.0.1:3000
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
```

`SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are intentionally server-only. Normal user operations must not use a Supabase secret or service-role key because those credentials bypass Row Level Security.

`CLERK_AUTHORIZED_PARTIES` is a server-only, non-secret comma-separated allowlist of exact application origins used to validate Clerk's session-token `azp` claim. Wildcards, public HTTP origins, credentials, paths, queries, and fragments are rejected. When the variable is absent, the proxy permits only `http://localhost:3000` and `http://127.0.0.1:3000`; every deployed environment must set its own exact HTTPS origin before it can authenticate users.

Complete the native provider connection before exercising authenticated Supabase requests:

1. Activate the Supabase integration for the Clerk instance and copy its Clerk domain.
2. Add Clerk as a third-party authentication provider in the Supabase dashboard using that domain.
3. Set `CLERK_DOMAIN` in the shell environment when running the local Supabase stack. `supabase/config.toml` reads this value without committing an instance-specific domain.

The local database test workflow requires Docker Desktop or Podman:

```bash
pnpm exec supabase start
pnpm test:db
```

Authenticated Moment CRUD uses server-mediated Route Handlers, the RLS-backed Supabase PostgreSQL repository, and private Supabase Storage image lifecycle through an authenticated same-origin image proxy. Signed-in users may explicitly review and import legacy Moments from `mood-and-moments.moments.v1`; the app never reads that source on sign-in and never removes local records without a separate confirmation. Durable owner-scoped import identity makes retries safe, while malformed, failed, conflicted, changed, or image-incomplete records remain local for review.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
