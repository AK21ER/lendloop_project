
"use client";

import {
  Authenticated,
  Unauthenticated,
  AuthLoading,
  useQuery,
} from "convex/react";

import {
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs";

import { api } from "../convex/_generated/api";

function IdentityTest() {
  const identity = useQuery(
    api.authTest.getMyIdentity
  );

  if (!identity) {
    return <p>Loading verified identity...</p>;
  }

  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">
        Authentication successful
      </h2>

      <p>Clerk ID: {identity.clerkId}</p>
      <p>
        Convex verified:{" "}
        {String(identity.authenticated)}
      </p>

      <UserButton />
    </section>
  );
}

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="mb-6 text-3xl font-bold">
        LendLoop
      </h1>

      <p className="mb-8">
        Borrow what you need. Lend what you don't.
      </p>

      <AuthLoading>
        <p>Checking authentication...</p>
      </AuthLoading>

      <Unauthenticated>
        <div className="flex gap-4">
          <SignInButton mode="modal">
            <button className="rounded bg-black px-4 py-2 text-white">
              Sign in
            </button>
          </SignInButton>

          <SignUpButton mode="modal">
            <button className="rounded border px-4 py-2">
              Sign up
            </button>
          </SignUpButton>
        </div>
      </Unauthenticated>

      <Authenticated>
        <IdentityTest />
      </Authenticated>
    </main>
  );
}
