import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MockConvexDb,
  createMockContext,
  callMutation,
  callQuery,
} from "./test-harness";

import * as usersModule from "../convex/users";
import * as toolsModule from "../convex/tools";
import * as authTestModule from "../convex/authTest";
import { requireAdmin, requireToolOwner } from "../convex/lib/permissions";
import { requireAuthenticatedUser } from "../convex/lib/auth";
import type { QueryCtx } from "../convex/_generated/server";
import type { Id } from "../convex/_generated/dataModel";

describe("LendLoop Phase 3.1: Users & Tool Listings Backend", () => {
  // 1. Unauthenticated users cannot create listings
  it("Requirement 1: Unauthenticated users cannot create listings", async () => {
    const db = new MockConvexDb();
    const unauthCtx = createMockContext(db, null);

    await assert.rejects(
      async () => {
        await callMutation(toolsModule.create, unauthCtx, {
          name: "Cordless Drill",
          category: "Power Tools",
          condition: "good",
          description: "Reliable 18V drill",
        });
      },
      {
        message: /Unauthenticated/i,
      }
    );
  });

  // 2. A new authenticated user is created with the user role
  it("Requirement 2: A new authenticated user is created with the 'user' role and isTrustedLender: false", async () => {
    const db = new MockConvexDb();
    const aliceIdentity = {
      subject: "clerk_alice_123",
      name: "Alice Builder",
      email: "alice@example.com",
    };
    const ctx = createMockContext(db, aliceIdentity);

    const user = (await callMutation(usersModule.ensureCurrentUser, ctx, {})) as {
      _id: string;
      clerkId: string;
      displayName: string;
      role: string;
      isTrustedLender: boolean;
    };

    assert.ok(user._id, "User should have an ID");
    assert.equal(user.clerkId, "clerk_alice_123");
    assert.equal(user.displayName, "Alice Builder");
    assert.equal(user.role, "user", "Default role must be 'user'");
    assert.equal(user.isTrustedLender, false, "Default isTrustedLender must be false");

    // Also check getMe
    const me = await callQuery(usersModule.getMe, ctx, {});
    assert.deepEqual(me, user);
  });

  // 3. Calling ensureCurrentUser repeatedly doesn't create duplicate users
  it("Requirement 3: Calling ensureCurrentUser repeatedly doesn't create duplicate users", async () => {
    const db = new MockConvexDb();
    const bobIdentity = {
      subject: "clerk_bob_456",
      name: "Bob Crafter",
    };
    const ctx = createMockContext(db, bobIdentity);

    // Call 1
    const user1 = (await callMutation(usersModule.ensureCurrentUser, ctx, {})) as { _id: string };
    // Call 2
    const user2 = (await callMutation(usersModule.ensureCurrentUser, ctx, {})) as { _id: string };
    // Call 3
    const user3 = (await callMutation(usersModule.ensureCurrentUser, ctx, {})) as { _id: string };

    assert.equal(user1._id, user2._id);
    assert.equal(user2._id, user3._id);

    const allUsers = await db.query("users").collect();
    assert.equal(allUsers.length, 1, "There should be exactly one user record in the database");
  });

  // Concurrent user synchronization simulation
  it("Requirement 3 (Extended): Concurrent user calls safely resolve existing record without duplicate insertion", async () => {
    const db = new MockConvexDb();
    const charlieIdentity = {
      subject: "clerk_charlie_789",
      name: "Charlie Woodworker",
    };
    const ctx = createMockContext(db, charlieIdentity);

    // Run parallel calls
    const [res1, res2] = (await Promise.all([
      callMutation(usersModule.ensureCurrentUser, ctx, {}),
      callMutation(usersModule.ensureCurrentUser, ctx, {}),
    ])) as Array<{ _id: string }>;

    assert.equal(res1._id, res2._id);
    const usersInDb = await db.query("users").collect();
    assert.equal(usersInDb.length, 1);
  });

  // 4. A normal user cannot promote themselves to admin
  it("Requirement 4: A normal user cannot promote themselves to admin and client role arguments are ignored/prohibited", async () => {
    const db = new MockConvexDb();
    const ctx = createMockContext(db, {
      subject: "clerk_hacker",
      name: "Malicious User",
    });

    // Ensure user creation with client-supplied arguments attempted
    const user = (await callMutation(
      usersModule.ensureCurrentUser,
      ctx,
      {
        role: "admin",
        isTrustedLender: true,
      } as unknown as Record<string, unknown>
    )) as { role: string; isTrustedLender: boolean };

    assert.equal(user.role, "user", "Role must strictly remain 'user'");
    assert.equal(user.isTrustedLender, false);

    // Verify requireAdmin denies access
    await assert.rejects(
      async () => {
        await requireAdmin(ctx as unknown as QueryCtx);
      },
      {
        message: /Administrator privileges required/i,
      }
    );
  });

  // 5. A user can create their own listing
  it("Requirement 5: An authenticated user can create their own listing with server-enforced ownerId", async () => {
    const db = new MockConvexDb();
    const ctx = createMockContext(db, {
      subject: "clerk_alice",
      name: "Alice",
    });

    const alice = (await callMutation(usersModule.ensureCurrentUser, ctx, {})) as { _id: string };

    const toolId = (await callMutation(toolsModule.create, ctx, {
      name: "Circular Saw",
      category: "Power Tools",
      condition: "new",
      description: "Brand new 7-1/4 inch circular saw with laser guide.",
    })) as string;

    assert.ok(toolId);
    const tool = (await db.get(toolId))!;
    assert.equal(tool.ownerId, alice._id, "Owner ID must be derived from authenticated user");
    assert.equal(tool.status, "active", "Default status must be active");
    assert.equal(tool.name, "Circular Saw");
    assert.equal(tool.category, "Power Tools");
    assert.equal(tool.condition, "new");
    assert.ok(typeof tool.updatedAt === "number", "updatedAt must be a server timestamp");

    // Check listMine returns it
    const myListings = (await callQuery(toolsModule.listMine, ctx, {})) as Array<{ _id: string }>;
    assert.equal(myListings.length, 1);
    assert.equal(myListings[0]._id, toolId);

    // Verify helper requireToolOwner and requireAuthenticatedUser succeed
    const ownerCheck = await requireToolOwner(
      ctx as unknown as QueryCtx,
      toolId as unknown as Id<"tools">
    );
    assert.equal(ownerCheck.user._id, alice._id);
    const authCheck = await requireAuthenticatedUser(ctx as unknown as QueryCtx);
    assert.equal(authCheck.user._id, alice._id);
  });

  // 6. A user cannot edit or remove another user's listing
  it("Requirement 6: A user cannot edit or remove another user's listing", async () => {
    const db = new MockConvexDb();

    // User A creates a tool
    const ctxA = createMockContext(db, { subject: "clerk_alice", name: "Alice" });
    await callMutation(usersModule.ensureCurrentUser, ctxA, {});
    const toolId = (await callMutation(toolsModule.create, ctxA, {
      name: "Lawn Mower",
      category: "Garden",
      condition: "good",
      description: "Gas powered mower",
    })) as string;

    // User B tries to update User A's tool
    const ctxB = createMockContext(db, { subject: "clerk_bob", name: "Bob" });
    await callMutation(usersModule.ensureCurrentUser, ctxB, {});

    await assert.rejects(
      async () => {
        await callMutation(toolsModule.update, ctxB, {
          toolId: toolId as unknown as Id<"tools">,
          name: "Stolen Lawn Mower",
        });
      },
      {
        message: /Forbidden|permission/i,
      }
    );

    // User B tries to remove User A's tool
    await assert.rejects(
      async () => {
        await callMutation(toolsModule.removeMine, ctxB, {
          toolId: toolId as unknown as Id<"tools">,
        });
      },
      {
        message: /Forbidden|permission/i,
      }
    );

    // Verify User A's tool was unmodified
    const toolInDb = (await db.get(toolId))!;
    assert.equal(toolInDb.name, "Lawn Mower");
    assert.equal(toolInDb.status, "active");
  });

  // 7. Public listing responses contain only permitted fields
  it("Requirement 7: Public listing responses contain only permitted fields (name and category)", async () => {
    const db = new MockConvexDb();
    const ctx = createMockContext(db, { subject: "clerk_alice", name: "Alice" });
    await callMutation(usersModule.ensureCurrentUser, ctx, {});

    await callMutation(toolsModule.create, ctx, {
      name: "Tent 4-Person",
      category: "Camping",
      condition: "fair",
      description: "Waterproof dome tent with rainfly.",
    });

    const unauthCtx = createMockContext(db, null);
    const publicListings = (await callQuery(toolsModule.listPublic, unauthCtx, {})) as Array<{
      name: string;
      category: string;
    }>;

    assert.equal(publicListings.length, 1);
    const listing = publicListings[0];

    // Permitted fields strictly check:
    assert.equal(listing.name, "Tent 4-Person");
    assert.equal(listing.category, "Camping");
    assert.equal(
      Object.keys(listing).length,
      2,
      "Public listing must contain exactly permitted fields (name, category)"
    );
    const record = listing as Record<string, unknown>;
    assert.equal(record.ownerId, undefined, "ownerId must NOT be exposed");
    assert.equal(record.description, undefined, "description must NOT be exposed in public listing");
    assert.equal(record.condition, undefined, "condition must NOT be exposed in public listing");
  });

  // 8. Removed listings are excluded from public queries
  it("Requirement 8: Removed listings are excluded from public queries and soft-deleted", async () => {
    const db = new MockConvexDb();
    const ctx = createMockContext(db, { subject: "clerk_alice", name: "Alice" });
    await callMutation(usersModule.ensureCurrentUser, ctx, {});

    const tool1 = (await callMutation(toolsModule.create, ctx, {
      name: "Shovel",
      category: "Garden",
      condition: "good",
      description: "Pointed garden spade",
    })) as string;

    const tool2 = (await callMutation(toolsModule.create, ctx, {
      name: "Rake",
      category: "Garden",
      condition: "good",
      description: "Leaf rake",
    })) as string;

    assert.ok(tool2, "Second tool created");

    // Remove tool1
    const removeRes = (await callMutation(toolsModule.removeMine, ctx, {
      toolId: tool1 as unknown as Id<"tools">,
    })) as { success: boolean };
    assert.equal(removeRes.success, true);

    // Verify soft-deleted in DB (record still physically exists with status: 'removed')
    const rawTool1 = (await db.get(tool1))!;
    assert.ok(rawTool1, "Record must not be physically deleted");
    assert.equal(rawTool1.status, "removed");

    // Public listings check: tool1 must NOT be in public results
    const unauthCtx = createMockContext(db, null);
    const publicTools = (await callQuery(toolsModule.listPublic, unauthCtx, {})) as Array<{
      name: string;
    }>;
    assert.equal(publicTools.length, 1);
    assert.equal(publicTools[0].name, "Rake");

    // Authenticated listAll check: tool1 must NOT be in browseable results
    const browseable = (await callQuery(toolsModule.listAll, ctx, {})) as Array<{
      name: string;
    }>;
    assert.equal(browseable.length, 1);
    assert.equal(browseable[0].name, "Rake");

    // Already removed tool cannot be edited
    await assert.rejects(
      async () => {
        await callMutation(toolsModule.update, ctx, {
          toolId: tool1 as unknown as Id<"tools">,
          name: "Attempt update",
        });
      },
      {
        message: /Cannot edit a removed/i,
      }
    );

    // Already removed tool cannot be removed again
    await assert.rejects(
      async () => {
        await callMutation(toolsModule.removeMine, ctx, {
          toolId: tool1 as unknown as Id<"tools">,
        });
      },
      {
        message: /already removed/i,
      }
    );
  });

  // 9. Invalid categories and blank names are rejected
  it("Requirement 9: Invalid categories, blank names, and invalid lengths are rejected", async () => {
    const db = new MockConvexDb();
    const ctx = createMockContext(db, { subject: "clerk_alice", name: "Alice" });
    await callMutation(usersModule.ensureCurrentUser, ctx, {});

    // Blank name
    await assert.rejects(
      async () => {
        await callMutation(toolsModule.create, ctx, {
          name: "    ",
          category: "Hand Tools",
          condition: "good",
          description: "A tool",
        });
      },
      {
        message: /cannot be empty|blank/i,
      }
    );

    // Invalid category
    await assert.rejects(
      async () => {
        await callMutation(toolsModule.create, ctx, {
          name: "Hammer",
          category: "Heavy Industrial Machinery",
          condition: "good",
          description: "A hammer",
        });
      },
      {
        message: /Invalid tool category/i,
      }
    );

    // Invalid condition
    await assert.rejects(
      async () => {
        await callMutation(toolsModule.create, ctx, {
          name: "Hammer",
          category: "Hand Tools",
          condition: "broken",
          description: "A hammer",
        });
      },
      {
        message: /Invalid tool condition/i,
      }
    );

    // Name exceeding 100 characters
    await assert.rejects(
      async () => {
        await callMutation(toolsModule.create, ctx, {
          name: "A".repeat(101),
          category: "Hand Tools",
          condition: "new",
          description: "A hammer",
        });
      },
      {
        message: /cannot exceed 100 characters/i,
      }
    );

    // Description exceeding 500 characters
    await assert.rejects(
      async () => {
        await callMutation(toolsModule.create, ctx, {
          name: "Wrench",
          category: "Hand Tools",
          condition: "new",
          description: "D".repeat(501),
        });
      },
      {
        message: /cannot exceed 500 characters/i,
      }
    );
  });

  // 10. Existing authentication still works
  it("Requirement 10: Existing authentication still works (authTest.getMyIdentity)", async () => {
    const db = new MockConvexDb();
    const aliceIdentity = {
      subject: "clerk_alice_identity_test",
      name: "Alice Tester",
    };
    const authCtx = createMockContext(db, aliceIdentity);
    const unauthCtx = createMockContext(db, null);

    // Authenticated identity returns subject
    const identityResult = (await callQuery(
      authTestModule.getMyIdentity,
      authCtx,
      {}
    )) as { clerkId: string; authenticated: boolean };
    assert.equal(identityResult.clerkId, "clerk_alice_identity_test");
    assert.equal(identityResult.authenticated, true);

    // Unauthenticated throws UNAUTHENTICATED as in existing authTest.ts
    await assert.rejects(
      async () => {
        await callQuery(authTestModule.getMyIdentity, unauthCtx, {});
      },
      {
        message: /UNAUTHENTICATED/,
      }
    );
  });
});
