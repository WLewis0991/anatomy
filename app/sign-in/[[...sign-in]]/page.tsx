import { SignIn } from "@clerk/nextjs";

// Clerk's SignIn reads the current path, which is only available at runtime.
export const instant = false;

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <SignIn />
    </div>
  );
}

