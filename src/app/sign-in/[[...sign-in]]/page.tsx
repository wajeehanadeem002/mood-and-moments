import { SignIn } from "@clerk/nextjs";

import { AuthShell } from "@/components/auth/auth-shell";

export default function SignInPage() {
  return (
    <AuthShell eyebrow="Welcome back" heading="Sign in to Mood & Moments">
      <SignIn
        fallbackRedirectUrl="/#moods"
        signUpUrl="/sign-up"
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
