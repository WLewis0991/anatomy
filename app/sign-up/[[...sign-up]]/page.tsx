import { SignUp } from "@clerk/nextjs";
import { Suspense } from "react";

// Clerk's SignUp reads the current path, which is only available at runtime.
export const instant = false;

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      {/* Clerk asks for the browser during the server render. */}
      <Suspense>
        <SignUp />
      </Suspense>
    </div>
  );
}
