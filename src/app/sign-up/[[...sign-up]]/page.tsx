import { SignUp } from "@clerk/nextjs";

import { AuthShell } from "@/components/auth/auth-shell";

export default function SignUpPage() {
  return (
    <AuthShell
      eyebrow="Begin your journal"
      heading="Create your Mood & Moments account"
    >
      <SignUp
        fallbackRedirectUrl="/#moods"
        signInUrl="/sign-in"
        appearance={{
          variables: {
            colorBackground: "#211f21",
            colorForeground: "#f4eee8",
            colorInput: "#171517",
            colorInputForeground: "#f4eee8",
            colorPrimary: "#a45064",
            colorMutedForeground: "#aaa1a4",
            borderRadius: "0.25rem",
          },
        }}
      />
    </AuthShell>
  );
}
