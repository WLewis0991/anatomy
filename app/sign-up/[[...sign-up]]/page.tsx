import { SignUp } from "@clerk/nextjs";

// Clerk's SignUp reads the current path, which is only available at runtime.
export const instant = false;

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <SignUp />
    </div>
  );
}

