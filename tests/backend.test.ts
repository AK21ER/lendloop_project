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
import * as requestsModule from "../convex/requests";
import * as loansModule from "../convex/loans";
import * as adminModule from "../convex/admin";
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

function getOffsetDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Addis_Ababa",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(d);
}

describe("LendLoop Phase 3.2: Borrow Request Backend", () => {
  // Setup helper for lender, borrower, and active tool
  async function setupLenderAndTool(db: MockConvexDb) {
    const lenderCtx = createMockContext(db, {
      subject: "clerk_lender",
      name: "Larry Lender",
    });
    const lender = (await callMutation(usersModule.ensureCurrentUser, lenderCtx, {})) as {
      _id: string;
    };

    const toolId = (await callMutation(toolsModule.create, lenderCtx, {
      name: "DeWalt Miter Saw",
      category: "Power Tools",
      condition: "good",
      description: "12-inch compound miter saw",
    })) as string;

    return { lenderCtx, lender, toolId };
  }

  // 1. Authenticated user can request another user's active tool
  it("Requirement 1: Authenticated user can request another user's active tool", async () => {
    const db = new MockConvexDb();
    const { toolId, lender } = await setupLenderAndTool(db);

    const borrowerCtx = createMockContext(db, {
      subject: "clerk_borrower",
      name: "Brenda Borrower",
    });
    const borrower = (await callMutation(usersModule.ensureCurrentUser, borrowerCtx, {})) as {
      _id: string;
    };

    const startDate = getOffsetDate(1);
    const endDate = getOffsetDate(3);

    const requestId = (await callMutation(requestsModule.create, borrowerCtx, {
      toolId: toolId as unknown as Id<"tools">,
      startDate,
      endDate,
    })) as string;

    assert.ok(requestId);
    const request = (await db.get(requestId))!;
    assert.equal(request.toolId, toolId);
    assert.equal(request.borrowerId, borrower._id);
    assert.equal(request.lenderId, lender._id);
    assert.equal(request.startDate, startDate);
    assert.equal(request.endDate, endDate);
    assert.equal(request.status, "pending");
  });

  // 2. Unauthenticated request creation is rejected
  it("Requirement 2: Unauthenticated request creation is rejected", async () => {
    const db = new MockConvexDb();
    const { toolId } = await setupLenderAndTool(db);
    const unauthCtx = createMockContext(db, null);

    await assert.rejects(
      async () => {
        await callMutation(requestsModule.create, unauthCtx, {
          toolId: toolId as unknown as Id<"tools">,
          startDate: getOffsetDate(1),
          endDate: getOffsetDate(3),
        });
      },
      {
        message: /Unauthenticated/i,
      }
    );
  });

  // 3. User cannot request their own tool
  it("Requirement 3: User cannot request to borrow their own tool", async () => {
    const db = new MockConvexDb();
    const { lenderCtx, toolId } = await setupLenderAndTool(db);

    await assert.rejects(
      async () => {
        await callMutation(requestsModule.create, lenderCtx, {
          toolId: toolId as unknown as Id<"tools">,
          startDate: getOffsetDate(1),
          endDate: getOffsetDate(2),
        });
      },
      {
        message: /Cannot request to borrow your own tool/i,
      }
    );
  });

  // 4. Inactive listing cannot be requested
  it("Requirement 4: Inactive listing cannot be requested", async () => {
    const db = new MockConvexDb();
    const { lenderCtx, toolId } = await setupLenderAndTool(db);

    // Set tool status to inactive
    await callMutation(toolsModule.update, lenderCtx, {
      toolId: toolId as unknown as Id<"tools">,
      status: "inactive",
    });

    const borrowerCtx = createMockContext(db, { subject: "clerk_b", name: "Borrower" });
    await callMutation(usersModule.ensureCurrentUser, borrowerCtx, {});

    await assert.rejects(
      async () => {
        await callMutation(requestsModule.create, borrowerCtx, {
          toolId: toolId as unknown as Id<"tools">,
          startDate: getOffsetDate(1),
          endDate: getOffsetDate(2),
        });
      },
      {
        message: /inactive/i,
      }
    );
  });

  // 5. Removed listing cannot be requested
  it("Requirement 5: Removed listing cannot be requested", async () => {
    const db = new MockConvexDb();
    const { lenderCtx, toolId } = await setupLenderAndTool(db);

    // Remove tool
    await callMutation(toolsModule.removeMine, lenderCtx, {
      toolId: toolId as unknown as Id<"tools">,
    });

    const borrowerCtx = createMockContext(db, { subject: "clerk_b", name: "Borrower" });
    await callMutation(usersModule.ensureCurrentUser, borrowerCtx, {});

    await assert.rejects(
      async () => {
        await callMutation(requestsModule.create, borrowerCtx, {
          toolId: toolId as unknown as Id<"tools">,
          startDate: getOffsetDate(1),
          endDate: getOffsetDate(2),
        });
      },
      {
        message: /removed/i,
      }
    );
  });

  // 6. Invalid date format is rejected
  it("Requirement 6: Invalid date format is rejected", async () => {
    const db = new MockConvexDb();
    const { toolId } = await setupLenderAndTool(db);

    const borrowerCtx = createMockContext(db, { subject: "clerk_b", name: "Borrower" });
    await callMutation(usersModule.ensureCurrentUser, borrowerCtx, {});

    await assert.rejects(
      async () => {
        await callMutation(requestsModule.create, borrowerCtx, {
          toolId: toolId as unknown as Id<"tools">,
          startDate: "2026/12/01",
          endDate: "2026-12-05",
        });
      },
      {
        message: /invalid/i,
      }
    );
  });

  // 7. Invalid calendar dates are rejected
  it("Requirement 7: Invalid calendar dates are rejected", async () => {
    const db = new MockConvexDb();
    const { toolId } = await setupLenderAndTool(db);

    const borrowerCtx = createMockContext(db, { subject: "clerk_b", name: "Borrower" });
    await callMutation(usersModule.ensureCurrentUser, borrowerCtx, {});

    // Feb 30th does not exist
    await assert.rejects(
      async () => {
        await callMutation(requestsModule.create, borrowerCtx, {
          toolId: toolId as unknown as Id<"tools">,
          startDate: "2027-02-30",
          endDate: "2027-03-02",
        });
      },
      {
        message: /not a valid calendar date/i,
      }
    );
  });

  // 8. End date before start date is rejected
  it("Requirement 8: End date before start date is rejected", async () => {
    const db = new MockConvexDb();
    const { toolId } = await setupLenderAndTool(db);

    const borrowerCtx = createMockContext(db, { subject: "clerk_b", name: "Borrower" });
    await callMutation(usersModule.ensureCurrentUser, borrowerCtx, {});

    await assert.rejects(
      async () => {
        await callMutation(requestsModule.create, borrowerCtx, {
          toolId: toolId as unknown as Id<"tools">,
          startDate: getOffsetDate(5),
          endDate: getOffsetDate(2),
        });
      },
      {
        message: /earlier than start date/i,
      }
    );
  });

  // 9. Past date range is rejected
  it("Requirement 9: Past date range is rejected", async () => {
    const db = new MockConvexDb();
    const { toolId } = await setupLenderAndTool(db);

    const borrowerCtx = createMockContext(db, { subject: "clerk_b", name: "Borrower" });
    await callMutation(usersModule.ensureCurrentUser, borrowerCtx, {});

    await assert.rejects(
      async () => {
        await callMutation(requestsModule.create, borrowerCtx, {
          toolId: toolId as unknown as Id<"tools">,
          startDate: "2020-01-01",
          endDate: "2020-01-05",
        });
      },
      {
        message: /cannot be in the past/i,
      }
    );
  });

  // 10. Duplicate equivalent pending requests are rejected
  it("Requirement 10: Duplicate equivalent pending requests by the same borrower are rejected", async () => {
    const db = new MockConvexDb();
    const { toolId } = await setupLenderAndTool(db);

    const borrowerCtx = createMockContext(db, { subject: "clerk_b", name: "Borrower" });
    await callMutation(usersModule.ensureCurrentUser, borrowerCtx, {});

    const startDate = getOffsetDate(2);
    const endDate = getOffsetDate(4);

    // First request succeeds
    await callMutation(requestsModule.create, borrowerCtx, {
      toolId: toolId as unknown as Id<"tools">,
      startDate,
      endDate,
    });

    // Duplicate request fails
    await assert.rejects(
      async () => {
        await callMutation(requestsModule.create, borrowerCtx, {
          toolId: toolId as unknown as Id<"tools">,
          startDate,
          endDate,
        });
      },
      {
        message: /pending request for this tool with the same date range already exists/i,
      }
    );
  });

  // 11. Two different borrowers can submit pending requests for the same period
  it("Requirement 11: Two different borrowers can submit pending requests for the same period", async () => {
    const db = new MockConvexDb();
    const { toolId } = await setupLenderAndTool(db);

    const b1Ctx = createMockContext(db, { subject: "clerk_b1", name: "Borrower 1" });
    await callMutation(usersModule.ensureCurrentUser, b1Ctx, {});

    const b2Ctx = createMockContext(db, { subject: "clerk_b2", name: "Borrower 2" });
    await callMutation(usersModule.ensureCurrentUser, b2Ctx, {});

    const startDate = getOffsetDate(2);
    const endDate = getOffsetDate(4);

    const req1 = await callMutation(requestsModule.create, b1Ctx, {
      toolId: toolId as unknown as Id<"tools">,
      startDate,
      endDate,
    });

    const req2 = await callMutation(requestsModule.create, b2Ctx, {
      toolId: toolId as unknown as Id<"tools">,
      startDate,
      endDate,
    });

    assert.ok(req1);
    assert.ok(req2);
    assert.notEqual(req1, req2);
  });

  // 12. Borrower sees only their own requests in listMine
  it("Requirement 12: Borrower sees only their own requests in listMine", async () => {
    const db = new MockConvexDb();
    const { toolId } = await setupLenderAndTool(db);

    const b1Ctx = createMockContext(db, { subject: "clerk_b1", name: "Borrower 1" });
    await callMutation(usersModule.ensureCurrentUser, b1Ctx, {});

    const b2Ctx = createMockContext(db, { subject: "clerk_b2", name: "Borrower 2" });
    await callMutation(usersModule.ensureCurrentUser, b2Ctx, {});

    await callMutation(requestsModule.create, b1Ctx, {
      toolId: toolId as unknown as Id<"tools">,
      startDate: getOffsetDate(1),
      endDate: getOffsetDate(2),
    });

    await callMutation(requestsModule.create, b2Ctx, {
      toolId: toolId as unknown as Id<"tools">,
      startDate: getOffsetDate(3),
      endDate: getOffsetDate(4),
    });

    const b1Requests = (await callQuery(requestsModule.listMine, b1Ctx, {})) as Array<{
      toolName: string;
    }>;
    assert.equal(b1Requests.length, 1);
    assert.equal(b1Requests[0].toolName, "DeWalt Miter Saw");

    const b2Requests = (await callQuery(requestsModule.listMine, b2Ctx, {})) as Array<{
      toolName: string;
    }>;
    assert.equal(b2Requests.length, 1);
  });

  // 13. Lender sees requests only for their own tools in listIncoming
  it("Requirement 13: Lender sees requests only for their own tools in listIncoming", async () => {
    const db = new MockConvexDb();
    const { toolId: tool1, lenderCtx: l1Ctx } = await setupLenderAndTool(db);

    // Lender 2
    const l2Ctx = createMockContext(db, { subject: "clerk_lender2", name: "Lender 2" });
    await callMutation(usersModule.ensureCurrentUser, l2Ctx, {});
    const tool2 = (await callMutation(toolsModule.create, l2Ctx, {
      name: "Pressure Washer",
      category: "Garden",
      condition: "good",
      description: "Electric pressure washer",
    })) as string;

    const borrowerCtx = createMockContext(db, { subject: "clerk_borrower", name: "Borrower" });
    await callMutation(usersModule.ensureCurrentUser, borrowerCtx, {});

    // Request tool 1
    await callMutation(requestsModule.create, borrowerCtx, {
      toolId: tool1 as unknown as Id<"tools">,
      startDate: getOffsetDate(1),
      endDate: getOffsetDate(2),
    });

    // Request tool 2
    await callMutation(requestsModule.create, borrowerCtx, {
      toolId: tool2 as unknown as Id<"tools">,
      startDate: getOffsetDate(3),
      endDate: getOffsetDate(4),
    });

    const l1Incoming = (await callQuery(requestsModule.listIncoming, l1Ctx, {})) as Array<{
      toolName: string;
      borrowerDisplayName: string;
    }>;
    assert.equal(l1Incoming.length, 1);
    assert.equal(l1Incoming[0].toolName, "DeWalt Miter Saw");
    assert.equal(l1Incoming[0].borrowerDisplayName, "Borrower");

    const l2Incoming = (await callQuery(requestsModule.listIncoming, l2Ctx, {})) as Array<{
      toolName: string;
    }>;
    assert.equal(l2Incoming.length, 1);
    assert.equal(l2Incoming[0].toolName, "Pressure Washer");
  });

  // 14. Unrelated user cannot access request details via getById
  it("Requirement 14: Unrelated user cannot access request details via getById", async () => {
    const db = new MockConvexDb();
    const { toolId, lenderCtx } = await setupLenderAndTool(db);

    const borrowerCtx = createMockContext(db, { subject: "clerk_b", name: "Borrower" });
    await callMutation(usersModule.ensureCurrentUser, borrowerCtx, {});

    const reqId = (await callMutation(requestsModule.create, borrowerCtx, {
      toolId: toolId as unknown as Id<"tools">,
      startDate: getOffsetDate(1),
      endDate: getOffsetDate(2),
    })) as string;

    // Borrower can access
    const borrowerReq = await callQuery(requestsModule.getById, borrowerCtx, {
      requestId: reqId as unknown as Id<"borrowRequests">,
    });
    assert.ok(borrowerReq);

    // Lender can access
    const lenderReq = await callQuery(requestsModule.getById, lenderCtx, {
      requestId: reqId as unknown as Id<"borrowRequests">,
    });
    assert.ok(lenderReq);

    // Unrelated user is rejected (returns null)
    const strangerCtx = createMockContext(db, { subject: "clerk_stranger", name: "Stranger" });
    await callMutation(usersModule.ensureCurrentUser, strangerCtx, {});

    const strangerReq = await callQuery(requestsModule.getById, strangerCtx, {
      requestId: reqId as unknown as Id<"borrowRequests">,
    });
    assert.equal(strangerReq, null, "Unrelated user must receive null");
  });

  // 15. User cannot spoof borrower identity or initial request status
  it("Requirement 15: User cannot spoof borrower identity or initial request status", async () => {
    const db = new MockConvexDb();
    const { toolId } = await setupLenderAndTool(db);

    const borrowerCtx = createMockContext(db, { subject: "clerk_b", name: "Borrower" });
    const b = (await callMutation(usersModule.ensureCurrentUser, borrowerCtx, {})) as {
      _id: string;
    };

    const reqId = (await callMutation(
      requestsModule.create,
      borrowerCtx,
      {
        toolId: toolId as unknown as Id<"tools">,
        startDate: getOffsetDate(1),
        endDate: getOffsetDate(2),
        status: "approved",
        borrowerId: "spoofed_id",
      } as unknown as Record<string, unknown>
    )) as string;

    const request = (await db.get(reqId))!;
    assert.equal(request.status, "pending", "Initial status must strictly be 'pending'");
    assert.equal(request.borrowerId, b._id, "Borrower ID must be derived from session");
  });

  // 16. Maximum duration constraint check
  it("Requirement 16: Borrowing period exceeding 30 days is rejected", async () => {
    const db = new MockConvexDb();
    const { toolId } = await setupLenderAndTool(db);

    const borrowerCtx = createMockContext(db, { subject: "clerk_b", name: "Borrower" });
    await callMutation(usersModule.ensureCurrentUser, borrowerCtx, {});

    await assert.rejects(
      async () => {
        await callMutation(requestsModule.create, borrowerCtx, {
          toolId: toolId as unknown as Id<"tools">,
          startDate: getOffsetDate(1),
          endDate: getOffsetDate(35), // 35 days exceeds 30
        });
      },
      {
        message: /cannot exceed 30 days/i,
      }
    );
  });
});

  // Setup helper for lender, borrower, and active tool
  async function setupLenderBorrowerAndRequest(db: MockConvexDb) {
    const lenderCtx = createMockContext(db, {
      subject: "clerk_lender_33",
      name: "Leo Lender",
    });
    const lender = (await callMutation(usersModule.ensureCurrentUser, lenderCtx, {})) as {
      _id: string;
    };

    const toolId = (await callMutation(toolsModule.create, lenderCtx, {
      name: "Table Saw",
      category: "Power Tools",
      condition: "new",
      description: "10-inch portable table saw",
    })) as string;

    const borrowerCtx = createMockContext(db, {
      subject: "clerk_borrower_33",
      name: "Bella Borrower",
    });
    const borrower = (await callMutation(usersModule.ensureCurrentUser, borrowerCtx, {})) as {
      _id: string;
    };

    const startDate = getOffsetDate(2);
    const endDate = getOffsetDate(5);

    const requestId = (await callMutation(requestsModule.create, borrowerCtx, {
      toolId: toolId as unknown as Id<"tools">,
      startDate,
      endDate,
    })) as string;

    return { lenderCtx, lender, borrowerCtx, borrower, toolId, requestId, startDate, endDate };
  }

describe("LendLoop Phase 3.3: Approval, Loan Creation & Returns", () => {

  // 1. Lender approves a pending request
  it("Requirement 1: Lender approves a pending request and creates a loan", async () => {
    const db = new MockConvexDb();
    const { lenderCtx, lender, borrower, toolId, requestId, startDate, endDate } =
      await setupLenderBorrowerAndRequest(db);

    const result = (await callMutation(requestsModule.approve, lenderCtx, {
      requestId: requestId as unknown as Id<"borrowRequests">,
    })) as { loanId: string; alreadyApproved: boolean };

    assert.ok(result.loanId);
    assert.equal(result.alreadyApproved, false);

    // Request is marked approved
    const request = (await db.get(requestId))!;
    assert.equal(request.status, "approved");
    assert.ok(request.decidedAt);
    assert.equal(request.decidedBy, lender._id);

    // Loan is created with status active
    const loan = (await db.get(result.loanId))!;
    assert.equal(loan.requestId, requestId);
    assert.equal(loan.toolId, toolId);
    assert.equal(loan.lenderId, lender._id);
    assert.equal(loan.borrowerId, borrower._id);
    assert.equal(loan.startDate, startDate);
    assert.equal(loan.dueDate, endDate);
    assert.equal(loan.status, "active");
  });

  // 2. Borrower cannot approve their own request
  it("Requirement 2: Borrower cannot approve their own request", async () => {
    const db = new MockConvexDb();
    const { borrowerCtx, requestId } = await setupLenderBorrowerAndRequest(db);

    await assert.rejects(
      async () => {
        await callMutation(requestsModule.approve, borrowerCtx, {
          requestId: requestId as unknown as Id<"borrowRequests">,
        });
      },
      {
        message: /Borrower cannot approve their own request/i,
      }
    );
  });

  // 3. Unrelated user cannot approve or decline
  it("Requirement 3: Unrelated user cannot approve or decline", async () => {
    const db = new MockConvexDb();
    const { requestId } = await setupLenderBorrowerAndRequest(db);

    const strangerCtx = createMockContext(db, {
      subject: "clerk_stranger_33",
      name: "Steve Stranger",
    });
    await callMutation(usersModule.ensureCurrentUser, strangerCtx, {});

    await assert.rejects(
      async () => {
        await callMutation(requestsModule.approve, strangerCtx, {
          requestId: requestId as unknown as Id<"borrowRequests">,
        });
      },
      {
        message: /Forbidden: Only the tool owner/i,
      }
    );

    await assert.rejects(
      async () => {
        await callMutation(requestsModule.decline, strangerCtx, {
          requestId: requestId as unknown as Id<"borrowRequests">,
        });
      },
      {
        message: /Forbidden: Only the tool owner/i,
      }
    );
  });

  // 4. Approval creates exactly one loan
  it("Requirement 4: Approval creates exactly one loan record", async () => {
    const db = new MockConvexDb();
    const { lenderCtx, requestId } = await setupLenderBorrowerAndRequest(db);

    await callMutation(requestsModule.approve, lenderCtx, {
      requestId: requestId as unknown as Id<"borrowRequests">,
    });

    const loans = await db.query("loans").collect();
    assert.equal(loans.length, 1);
  });

  // 5. Duplicate approval does not create a second loan (idempotent)
  it("Requirement 5: Duplicate approval does not create a second loan (idempotency)", async () => {
    const db = new MockConvexDb();
    const { lenderCtx, requestId } = await setupLenderBorrowerAndRequest(db);

    const res1 = (await callMutation(requestsModule.approve, lenderCtx, {
      requestId: requestId as unknown as Id<"borrowRequests">,
    })) as { loanId: string; alreadyApproved: boolean };

    const res2 = (await callMutation(requestsModule.approve, lenderCtx, {
      requestId: requestId as unknown as Id<"borrowRequests">,
    })) as { loanId: string; alreadyApproved: boolean };

    assert.equal(res1.alreadyApproved, false);
    assert.equal(res2.alreadyApproved, true);
    assert.equal(res1.loanId, res2.loanId);

    const allLoans = await db.query("loans").collect();
    assert.equal(allLoans.length, 1, "Must not create duplicate loans on retry");
  });

  // 6. Declining a pending request succeeds
  it("Requirement 6: Declining a pending request succeeds without creating a loan", async () => {
    const db = new MockConvexDb();
    const { lenderCtx, lender, requestId } = await setupLenderBorrowerAndRequest(db);

    const res = (await callMutation(requestsModule.decline, lenderCtx, {
      requestId: requestId as unknown as Id<"borrowRequests">,
    })) as { success: boolean; alreadyDeclined: boolean };

    assert.equal(res.success, true);
    assert.equal(res.alreadyDeclined, false);

    const req = (await db.get(requestId))!;
    assert.equal(req.status, "declined");
    assert.equal(req.decidedBy, lender._id);

    const loans = await db.query("loans").collect();
    assert.equal(loans.length, 0, "No loan should be created for declined request");
  });

  // 7. Declined request cannot be approved
  it("Requirement 7: Declined request cannot be approved", async () => {
    const db = new MockConvexDb();
    const { lenderCtx, requestId } = await setupLenderBorrowerAndRequest(db);

    await callMutation(requestsModule.decline, lenderCtx, {
      requestId: requestId as unknown as Id<"borrowRequests">,
    });

    await assert.rejects(
      async () => {
        await callMutation(requestsModule.approve, lenderCtx, {
          requestId: requestId as unknown as Id<"borrowRequests">,
        });
      },
      {
        message: /Cannot approve a declined request/i,
      }
    );
  });

  // 8. Approved request cannot be declined
  it("Requirement 8: Approved request cannot be declined", async () => {
    const db = new MockConvexDb();
    const { lenderCtx, requestId } = await setupLenderBorrowerAndRequest(db);

    await callMutation(requestsModule.approve, lenderCtx, {
      requestId: requestId as unknown as Id<"borrowRequests">,
    });

    await assert.rejects(
      async () => {
        await callMutation(requestsModule.decline, lenderCtx, {
          requestId: requestId as unknown as Id<"borrowRequests">,
        });
      },
      {
        message: /Cannot decline an already approved request/i,
      }
    );
  });

  // 9. Overlapping active loans cannot be approved
  it("Requirement 9: Overlapping active loans cannot be approved", async () => {
    const db = new MockConvexDb();
    const { lenderCtx, borrowerCtx, toolId } = await setupLenderBorrowerAndRequest(db);

    // Borrower 1 requests Day 5 to Day 10
    const req1 = (await callMutation(requestsModule.create, borrowerCtx, {
      toolId: toolId as unknown as Id<"tools">,
      startDate: getOffsetDate(5),
      endDate: getOffsetDate(10),
    })) as string;

    // Lender approves req1 -> Loan 1 created for Day 5 to Day 10
    await callMutation(requestsModule.approve, lenderCtx, {
      requestId: req1 as unknown as Id<"borrowRequests">,
    });

    // Borrower 2 requests Day 8 to Day 12 (overlaps with Day 5-10 on days 8, 9, 10)
    const b2Ctx = createMockContext(db, { subject: "clerk_b2_33", name: "Borrower 2" });
    await callMutation(usersModule.ensureCurrentUser, b2Ctx, {});
    const req2 = (await callMutation(requestsModule.create, b2Ctx, {
      toolId: toolId as unknown as Id<"tools">,
      startDate: getOffsetDate(8),
      endDate: getOffsetDate(12),
    })) as string;

    // Approval of req2 must fail due to overlap
    await assert.rejects(
      async () => {
        await callMutation(requestsModule.approve, lenderCtx, {
          requestId: req2 as unknown as Id<"borrowRequests">,
        });
      },
      {
        message: /Conflicts with an existing active loan/i,
      }
    );
  });

  // 10. Nonoverlapping date ranges can be approved
  it("Requirement 10: Nonoverlapping date ranges can be approved", async () => {
    const db = new MockConvexDb();
    const { lenderCtx, borrowerCtx, toolId } = await setupLenderBorrowerAndRequest(db);

    // Request 1: Day 2 to Day 4
    const req1 = (await callMutation(requestsModule.create, borrowerCtx, {
      toolId: toolId as unknown as Id<"tools">,
      startDate: getOffsetDate(2),
      endDate: getOffsetDate(4),
    })) as string;

    // Request 2: Day 6 to Day 8
    const b2Ctx = createMockContext(db, { subject: "clerk_b2_33", name: "Borrower 2" });
    await callMutation(usersModule.ensureCurrentUser, b2Ctx, {});
    const req2 = (await callMutation(requestsModule.create, b2Ctx, {
      toolId: toolId as unknown as Id<"tools">,
      startDate: getOffsetDate(6),
      endDate: getOffsetDate(8),
    })) as string;

    const res1 = (await callMutation(requestsModule.approve, lenderCtx, {
      requestId: req1 as unknown as Id<"borrowRequests">,
    })) as { loanId: string };

    const res2 = (await callMutation(requestsModule.approve, lenderCtx, {
      requestId: req2 as unknown as Id<"borrowRequests">,
    })) as { loanId: string };

    assert.ok(res1.loanId);
    assert.ok(res2.loanId);
    assert.notEqual(res1.loanId, res2.loanId);

    const loans = await db.query("loans").collect();
    assert.equal(loans.length, 2);
  });

  // 11. Adjacent inclusive date ranges follow the defined overlap policy
  it("Requirement 11: Adjacent inclusive date ranges follow defined overlap policy", async () => {
    const db = new MockConvexDb();
    const { lenderCtx, borrowerCtx, toolId } = await setupLenderBorrowerAndRequest(db);

    // Loan 1: Day 3 to Day 5
    const req1 = (await callMutation(requestsModule.create, borrowerCtx, {
      toolId: toolId as unknown as Id<"tools">,
      startDate: getOffsetDate(3),
      endDate: getOffsetDate(5),
    })) as string;
    await callMutation(requestsModule.approve, lenderCtx, {
      requestId: req1 as unknown as Id<"borrowRequests">,
    });

    const b2Ctx = createMockContext(db, { subject: "clerk_b2_33", name: "Borrower 2" });
    await callMutation(usersModule.ensureCurrentUser, b2Ctx, {});

    // Overlapping on inclusive boundary (Day 5 to Day 7) -> must be rejected
    const reqSameDay = (await callMutation(requestsModule.create, b2Ctx, {
      toolId: toolId as unknown as Id<"tools">,
      startDate: getOffsetDate(5),
      endDate: getOffsetDate(7),
    })) as string;

    await assert.rejects(
      async () => {
        await callMutation(requestsModule.approve, lenderCtx, {
          requestId: reqSameDay as unknown as Id<"borrowRequests">,
        });
      },
      {
        message: /Conflicts with an existing active loan/i,
      }
    );

    // Next day (Day 6 to Day 8) -> nonoverlapping, must succeed
    const reqNextDay = (await callMutation(requestsModule.create, b2Ctx, {
      toolId: toolId as unknown as Id<"tools">,
      startDate: getOffsetDate(6),
      endDate: getOffsetDate(8),
    })) as string;

    const res = (await callMutation(requestsModule.approve, lenderCtx, {
      requestId: reqNextDay as unknown as Id<"borrowRequests">,
    })) as { loanId: string };
    assert.ok(res.loanId);
  });

  // 12. Concurrent conflicting approvals cannot create overlapping loans
  it("Requirement 12: Concurrent conflicting approvals are safely serialized and rejected", async () => {
    const db = new MockConvexDb();
    const { lenderCtx, borrowerCtx, toolId } = await setupLenderBorrowerAndRequest(db);

    const b2Ctx = createMockContext(db, { subject: "clerk_b2_33", name: "Borrower 2" });
    await callMutation(usersModule.ensureCurrentUser, b2Ctx, {});

    // Two requests for identical dates
    const req1 = (await callMutation(requestsModule.create, borrowerCtx, {
      toolId: toolId as unknown as Id<"tools">,
      startDate: getOffsetDate(3),
      endDate: getOffsetDate(6),
    })) as string;

    const req2 = (await callMutation(requestsModule.create, b2Ctx, {
      toolId: toolId as unknown as Id<"tools">,
      startDate: getOffsetDate(3),
      endDate: getOffsetDate(6),
    })) as string;

    // Simulate concurrent approval execution
    const results = await Promise.allSettled([
      callMutation(requestsModule.approve, lenderCtx, {
        requestId: req1 as unknown as Id<"borrowRequests">,
      }),
      callMutation(requestsModule.approve, lenderCtx, {
        requestId: req2 as unknown as Id<"borrowRequests">,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    assert.equal(fulfilled.length, 1, "Exactly one approval must succeed");
    assert.equal(rejected.length, 1, "The conflicting approval must be rejected");

    const loans = await db.query("loans").collect();
    assert.equal(loans.length, 1);
  });

  // 13. Borrower and lender see only their authorized loans
  it("Requirement 13: Borrower and lender see only their authorized loans", async () => {
    const db = new MockConvexDb();
    const { lenderCtx, borrowerCtx, requestId } = await setupLenderBorrowerAndRequest(db);

    const approveRes = (await callMutation(requestsModule.approve, lenderCtx, {
      requestId: requestId as unknown as Id<"borrowRequests">,
    })) as { loanId: string };

    // Lender sees it
    const lenderLoans = (await callQuery(loansModule.listMine, lenderCtx, {})) as Array<{
      _id: string;
      isLender: boolean;
      toolName: string;
    }>;
    assert.equal(lenderLoans.length, 1);
    assert.equal(lenderLoans[0].isLender, true);
    assert.equal(lenderLoans[0].toolName, "Table Saw");

    // Borrower sees it
    const borrowerLoans = (await callQuery(loansModule.listMine, borrowerCtx, {})) as Array<{
      _id: string;
      isBorrower: boolean;
      toolName: string;
    }>;
    assert.equal(borrowerLoans.length, 1);
    assert.equal(borrowerLoans[0].isBorrower, true);

    // Unrelated stranger gets empty listMine and null getById
    const strangerCtx = createMockContext(db, { subject: "clerk_stranger_33", name: "Stranger" });
    await callMutation(usersModule.ensureCurrentUser, strangerCtx, {});

    const strangerLoans = (await callQuery(loansModule.listMine, strangerCtx, {})) as Array<unknown>;
    assert.equal(strangerLoans.length, 0);

    const strangerLoan = await callQuery(loansModule.getById, strangerCtx, {
      loanId: approveRes.loanId as unknown as Id<"loans">,
    });
    assert.equal(strangerLoan, null);
  });

  // 14. Only lender can mark a loan returned
  it("Requirement 14: Only lender can mark a loan returned", async () => {
    const db = new MockConvexDb();
    const { lenderCtx, borrowerCtx, requestId } = await setupLenderBorrowerAndRequest(db);

    const approveRes = (await callMutation(requestsModule.approve, lenderCtx, {
      requestId: requestId as unknown as Id<"borrowRequests">,
    })) as { loanId: string };

    // Borrower attempt to mark returned is rejected
    await assert.rejects(
      async () => {
        await callMutation(loansModule.markReturned, borrowerCtx, {
          loanId: approveRes.loanId as unknown as Id<"loans">,
        });
      },
      {
        message: /Forbidden: Only the tool lender/i,
      }
    );

    // Lender succeeds
    const returnRes = (await callMutation(loansModule.markReturned, lenderCtx, {
      loanId: approveRes.loanId as unknown as Id<"loans">,
    })) as { success: boolean; alreadyReturned: boolean };
    assert.equal(returnRes.success, true);
    assert.equal(returnRes.alreadyReturned, false);

    const loanInDb = (await db.get(approveRes.loanId))!;
    assert.equal(loanInDb.status, "returned");
    assert.ok(loanInDb.returnedAt);
  });

  // 15. Repeated return calls are safe (idempotent)
  it("Requirement 15: Repeated return calls are safe and idempotent", async () => {
    const db = new MockConvexDb();
    const { lenderCtx, requestId } = await setupLenderBorrowerAndRequest(db);

    const approveRes = (await callMutation(requestsModule.approve, lenderCtx, {
      requestId: requestId as unknown as Id<"borrowRequests">,
    })) as { loanId: string };

    const res1 = (await callMutation(loansModule.markReturned, lenderCtx, {
      loanId: approveRes.loanId as unknown as Id<"loans">,
    })) as { success: boolean; alreadyReturned: boolean };

    const res2 = (await callMutation(loansModule.markReturned, lenderCtx, {
      loanId: approveRes.loanId as unknown as Id<"loans">,
    })) as { success: boolean; alreadyReturned: boolean };

    assert.equal(res1.alreadyReturned, false);
    assert.equal(res2.alreadyReturned, true);
  });

  // 16. Returned loans are preserved and do not block subsequent loans
  it("Requirement 16: Returned loans are preserved and do not block subsequent requests for same dates", async () => {
    const db = new MockConvexDb();
    const { lenderCtx, toolId, requestId } = await setupLenderBorrowerAndRequest(db);

    const approveRes = (await callMutation(requestsModule.approve, lenderCtx, {
      requestId: requestId as unknown as Id<"borrowRequests">,
    })) as { loanId: string };

    // Mark loan returned early
    await callMutation(loansModule.markReturned, lenderCtx, {
      loanId: approveRes.loanId as unknown as Id<"loans">,
    });

    // Borrower 2 now requests the exact same dates
    const b2Ctx = createMockContext(db, { subject: "clerk_b2_33", name: "Borrower 2" });
    await callMutation(usersModule.ensureCurrentUser, b2Ctx, {});
    const req2 = (await callMutation(requestsModule.create, b2Ctx, {
      toolId: toolId as unknown as Id<"tools">,
      startDate: getOffsetDate(2),
      endDate: getOffsetDate(5),
    })) as string;

    // Approval now succeeds because the previous loan is 'returned', not 'active'!
    const approve2 = (await callMutation(requestsModule.approve, lenderCtx, {
      requestId: req2 as unknown as Id<"borrowRequests">,
    })) as { loanId: string };

    assert.ok(approve2.loanId);

    // Verify both loans exist in DB history
    const allLoans = await db.query("loans").collect();
    assert.equal(allLoans.length, 2);
  });

  // 17. Listing removal does not destroy approved loan history
  it("Requirement 17: Listing removal preserves approved loan history", async () => {
    const db = new MockConvexDb();
    const { lenderCtx, toolId, requestId } = await setupLenderBorrowerAndRequest(db);

    const approveRes = (await callMutation(requestsModule.approve, lenderCtx, {
      requestId: requestId as unknown as Id<"borrowRequests">,
    })) as { loanId: string };

    // Lender removes the tool listing
    await callMutation(toolsModule.removeMine, lenderCtx, {
      toolId: toolId as unknown as Id<"tools">,
    });

    // Tool status is removed
    const tool = (await db.get(toolId))!;
    assert.equal(tool.status, "removed");

    // Loan still exists in DB and can be queried and marked returned
    const loan = (await db.get(approveRes.loanId))!;
    assert.ok(loan);
    assert.equal(loan.status, "active");

    const returnRes = (await callMutation(loansModule.markReturned, lenderCtx, {
      loanId: approveRes.loanId as unknown as Id<"loans">,
    })) as { success: boolean };
    assert.equal(returnRes.success, true);
  });

  // 18. Availability query returns active booked dates
  it("Requirement 18: getToolAvailability returns active reserved dates", async () => {
    const db = new MockConvexDb();
    const { lenderCtx, toolId, requestId } = await setupLenderBorrowerAndRequest(db);

    // Before approval, availability is empty
    const unauthCtx = createMockContext(db, null);
    const beforeAvail = (await callQuery(loansModule.getToolAvailability, unauthCtx, {
      toolId: toolId as unknown as Id<"tools">,
    })) as Array<{ startDate: string; dueDate: string }>;
    assert.equal(beforeAvail.length, 0);

    // Approve loan
    await callMutation(requestsModule.approve, lenderCtx, {
      requestId: requestId as unknown as Id<"borrowRequests">,
    });

    // After approval, availability returns the booked range
    const afterAvail = (await callQuery(loansModule.getToolAvailability, unauthCtx, {
      toolId: toolId as unknown as Id<"tools">,
    })) as Array<{ startDate: string; dueDate: string }>;
    assert.equal(afterAvail.length, 1);
    assert.equal(afterAvail[0].startDate, getOffsetDate(2));
    assert.equal(afterAvail[0].dueDate, getOffsetDate(5));
  });
});

describe("LendLoop Phase 3.4: Admin Features, Audit Logs & Backend Hardening", () => {
  async function setupAdmin(db: MockConvexDb, name = "Platform Admin") {
    const adminCtx = createMockContext(db, {
      subject: `clerk_admin_${name.replace(/\s+/g, "_")}`,
      name,
    });
    const userRes = (await callMutation(usersModule.ensureCurrentUser, adminCtx, {})) as {
      _id: string;
      role: string;
    };
    await db.patch(userRes._id, { role: "admin" });
    return { adminCtx, adminUserId: userRes._id };
  }

  // 1. Normal user cannot access admin functions
  it("Requirement 1: Normal user cannot access admin functions", async () => {
    const db = new MockConvexDb();
    const normalCtx = createMockContext(db, { subject: "clerk_normal_1", name: "Normal User" });
    await callMutation(usersModule.ensureCurrentUser, normalCtx, {});

    // listAllLoans rejected
    await assert.rejects(
      async () => {
        await callQuery(adminModule.listAllLoans, normalCtx, {});
      },
      /Forbidden: Administrator privileges required/
    );

    // listLenders rejected
    await assert.rejects(
      async () => {
        await callQuery(adminModule.listLenders, normalCtx, {});
      },
      /Forbidden: Administrator privileges required/
    );

    // listAuditLogs rejected
    await assert.rejects(
      async () => {
        await callQuery(adminModule.listAuditLogs, normalCtx, {});
      },
      /Forbidden: Administrator privileges required/
    );

    // setTrustedLender rejected
    await assert.rejects(
      async () => {
        await callMutation(adminModule.setTrustedLender, normalCtx, {
          userId: "users_1" as unknown as Id<"users">,
          isTrusted: true,
        });
      },
      /Forbidden: Administrator privileges required/
    );

    // removeListing rejected
    await assert.rejects(
      async () => {
        await callMutation(adminModule.removeListing, normalCtx, {
          toolId: "tools_1" as unknown as Id<"tools">,
        });
      },
      /Forbidden: Administrator privileges required/
    );
  });

  // 2. Admin can view all loans
  it("Requirement 2: Admin can view all loans with tool, borrower, and lender info", async () => {
    const db = new MockConvexDb();
    const { lenderCtx, requestId } = await setupLenderBorrowerAndRequest(db);
    const { adminCtx } = await setupAdmin(db);

    // Approve loan
    await callMutation(requestsModule.approve, lenderCtx, {
      requestId: requestId as unknown as Id<"borrowRequests">,
    });

    const allLoans = (await callQuery(adminModule.listAllLoans, adminCtx, {})) as Array<{
      toolName: string;
      borrowerDisplayName: string;
      lenderDisplayName: string;
      status: string;
      isOverdue: boolean;
    }>;

    assert.equal(allLoans.length, 1);
    assert.equal(allLoans[0].toolName, "Table Saw");
    assert.equal(allLoans[0].borrowerDisplayName, "Bella Borrower");
    assert.equal(allLoans[0].lenderDisplayName, "Leo Lender");
    assert.equal(allLoans[0].status, "active");
    assert.equal(typeof allLoans[0].isOverdue, "boolean");

    // Status filtering works
    const activeLoans = (await callQuery(adminModule.listAllLoans, adminCtx, {
      status: "active",
    })) as Array<unknown>;
    assert.equal(activeLoans.length, 1);

    const returnedLoans = (await callQuery(adminModule.listAllLoans, adminCtx, {
      status: "returned",
    })) as Array<unknown>;
    assert.equal(returnedLoans.length, 0);
  });

  // 3. Admin can remove another user's listing
  it("Requirement 3: Admin can soft-remove another user's listing", async () => {
    const db = new MockConvexDb();
    const { toolId } = await setupLenderBorrowerAndRequest(db);
    const { adminCtx } = await setupAdmin(db);

    const removeRes = (await callMutation(adminModule.removeListing, adminCtx, {
      toolId: toolId as unknown as Id<"tools">,
    })) as { success: boolean; alreadyRemoved: boolean };

    assert.equal(removeRes.success, true);
    assert.equal(removeRes.alreadyRemoved, false);

    const tool = await db.get(toolId);
    assert.equal(tool?.status, "removed");
  });

  // 4. Admin removal preserves active loan records
  it("Requirement 4: Admin listing removal preserves approved active loan records", async () => {
    const db = new MockConvexDb();
    const { lenderCtx, toolId, requestId } = await setupLenderBorrowerAndRequest(db);
    const { adminCtx } = await setupAdmin(db);

    const approveRes = (await callMutation(requestsModule.approve, lenderCtx, {
      requestId: requestId as unknown as Id<"borrowRequests">,
    })) as { loanId: string };

    // Admin soft-removes the listing
    await callMutation(adminModule.removeListing, adminCtx, {
      toolId: toolId as unknown as Id<"tools">,
    });

    // Active loan is preserved in database
    const loan = await db.get(approveRes.loanId);
    assert.ok(loan);
    assert.equal(loan.status, "active");

    // Lender can still mark it returned
    const returnRes = (await callMutation(loansModule.markReturned, lenderCtx, {
      loanId: approveRes.loanId as unknown as Id<"loans">,
    })) as { success: boolean };
    assert.equal(returnRes.success, true);
  });

  // 5. Admin can set/unset trusted status without altering role
  it("Requirement 5: Admin can set and unset trusted lender status without altering role", async () => {
    const db = new MockConvexDb();
    const userCtx = createMockContext(db, { subject: "clerk_target_user", name: "Target Neighbor" });
    const userRes = (await callMutation(usersModule.ensureCurrentUser, userCtx, {})) as {
      _id: string;
      role: string;
      isTrustedLender: boolean;
    };
    const targetUserId = userRes._id;

    assert.equal(userRes.isTrustedLender, false);
    assert.equal(userRes.role, "user");

    const { adminCtx } = await setupAdmin(db);

    // Promote to trusted lender
    const res1 = (await callMutation(adminModule.setTrustedLender, adminCtx, {
      userId: targetUserId as unknown as Id<"users">,
      isTrusted: true,
    })) as { success: boolean; changed: boolean; isTrustedLender: boolean };

    assert.equal(res1.success, true);
    assert.equal(res1.changed, true);
    assert.equal(res1.isTrustedLender, true);

    // Verify user role is NOT changed
    const userAfter1 = await db.get(targetUserId);
    assert.equal(userAfter1?.isTrustedLender, true);
    assert.equal(userAfter1?.role, "user");

    // Repeated call is safe and idempotent
    const resDuplicate = (await callMutation(adminModule.setTrustedLender, adminCtx, {
      userId: targetUserId as unknown as Id<"users">,
      isTrusted: true,
    })) as { success: boolean; changed: boolean };
    assert.equal(resDuplicate.changed, false);

    // Unset trusted lender
    const res2 = (await callMutation(adminModule.setTrustedLender, adminCtx, {
      userId: targetUserId as unknown as Id<"users">,
      isTrusted: false,
    })) as { success: boolean; changed: boolean; isTrustedLender: boolean };
    assert.equal(res2.isTrustedLender, false);

    const userAfter2 = await db.get(targetUserId);
    assert.equal(userAfter2?.isTrustedLender, false);
    assert.equal(userAfter2?.role, "user");
  });

  // 6. User cannot change their own role or trusted flag
  it("Requirement 6: User cannot change their own role or trusted flag", async () => {
    const db = new MockConvexDb();
    const userCtx = createMockContext(db, { subject: "clerk_sneaky", name: "Sneaky User" });
    await callMutation(usersModule.ensureCurrentUser, userCtx, {});

    // Calling ensureCurrentUser repeatedly preserves role and trusted flag
    const secondCall = (await callMutation(usersModule.ensureCurrentUser, userCtx, {
      role: "admin",
      isTrustedLender: true,
    })) as { role: string; isTrustedLender: boolean };

    assert.equal(secondCall.role, "user");
    assert.equal(secondCall.isTrustedLender, false);
  });

  // 7. Unauthorized caller cannot exploit duplicate approval to obtain another user's loan ID
  it("Requirement 7: Unauthorized caller cannot exploit duplicate approval to obtain another user's loan ID", async () => {
    const db = new MockConvexDb();
    const { lenderCtx, borrowerCtx, requestId } = await setupLenderBorrowerAndRequest(db);

    // Lender approves the request
    const approveRes = (await callMutation(requestsModule.approve, lenderCtx, {
      requestId: requestId as unknown as Id<"borrowRequests">,
    })) as { loanId: string; alreadyApproved: boolean };
    assert.ok(approveRes.loanId);

    // Borrower calls approve on already approved request -> must be rejected with authorization error
    await assert.rejects(
      async () => {
        await callMutation(requestsModule.approve, borrowerCtx, {
          requestId: requestId as unknown as Id<"borrowRequests">,
        });
      },
      /Borrower cannot approve their own request/
    );

    // Unrelated third-party user calls approve on already approved request -> rejected with forbidden error
    const thirdPartyCtx = createMockContext(db, { subject: "clerk_stranger", name: "Stranger" });
    await callMutation(usersModule.ensureCurrentUser, thirdPartyCtx, {});

    await assert.rejects(
      async () => {
        await callMutation(requestsModule.approve, thirdPartyCtx, {
          requestId: requestId as unknown as Id<"borrowRequests">,
        });
      },
      /Forbidden: Only the tool owner can approve this request/
    );

    // Safe repeated call by the actual verified lender succeeds and returns loanId
    const repeatApprove = (await callMutation(requestsModule.approve, lenderCtx, {
      requestId: requestId as unknown as Id<"borrowRequests">,
    })) as { loanId: string; alreadyApproved: boolean };
    assert.equal(repeatApprove.loanId, approveRes.loanId);
    assert.equal(repeatApprove.alreadyApproved, true);
  });

  // 8. Audit events are created for significant changes
  it("Requirement 8: Audit events are created for significant mutations", async () => {
    const db = new MockConvexDb();
    const { lenderCtx, toolId, requestId } = await setupLenderBorrowerAndRequest(db);
    const { adminCtx } = await setupAdmin(db);

    // Check audit logs table
    const auditLogsBefore = await db.query("auditLogs").collect();
    // Should have: tool.create, request.create
    const actionsBefore = auditLogsBefore.map((l) => l.action);
    assert.ok(actionsBefore.includes("tool.create"));
    assert.ok(actionsBefore.includes("request.create"));

    // Approve request
    const approveRes = (await callMutation(requestsModule.approve, lenderCtx, {
      requestId: requestId as unknown as Id<"borrowRequests">,
    })) as { loanId: string };

    // Return loan
    await callMutation(loansModule.markReturned, lenderCtx, {
      loanId: approveRes.loanId as unknown as Id<"loans">,
    });

    // Admin removes listing
    await callMutation(adminModule.removeListing, adminCtx, {
      toolId: toolId as unknown as Id<"tools">,
    });

    const allAuditLogs = await db.query("auditLogs").collect();
    const allActions = allAuditLogs.map((l) => l.action);

    assert.ok(allActions.includes("tool.create"));
    assert.ok(allActions.includes("request.create"));
    assert.ok(allActions.includes("request.approve"));
    assert.ok(allActions.includes("loan.return"));
    assert.ok(allActions.includes("admin.tool.remove"));

    // Admin can query audit logs
    const queriedLogs = (await callQuery(adminModule.listAuditLogs, adminCtx, {})) as Array<{
      action: string;
      actorDisplayName: string;
    }>;
    assert.ok(queriedLogs.length >= 5);
  });

  // 9. Audit logs do not contain secrets
  it("Requirement 9: Audit logs do not contain secrets or sensitive tokens", async () => {
    const db = new MockConvexDb();
    const { lenderCtx, requestId } = await setupLenderBorrowerAndRequest(db);

    await callMutation(requestsModule.approve, lenderCtx, {
      requestId: requestId as unknown as Id<"borrowRequests">,
    });

    const allAuditLogs = await db.query("auditLogs").collect();
    for (const log of allAuditLogs) {
      const serialized = JSON.stringify(log);
      assert.equal(serialized.includes("clerk_secret"), false);
      assert.equal(serialized.includes("token_"), false);
      assert.equal(serialized.includes("password"), false);
    }
  });

  // 10. Failed mutations do not leave partial audit records
  it("Requirement 10: Failed mutations do not leave partial audit records", async () => {
    const db = new MockConvexDb();
    const { borrowerCtx, requestId } = await setupLenderBorrowerAndRequest(db);

    const logsCountBefore = (await db.query("auditLogs").collect()).length;

    // Malicious borrower tries to approve -> throws error
    await assert.rejects(
      async () => {
        await callMutation(requestsModule.approve, borrowerCtx, {
          requestId: requestId as unknown as Id<"borrowRequests">,
        });
      },
      /Borrower cannot approve their own request/
    );

    // No new audit log record should have been committed for the failed approval
    const logsAfter = await db.query("auditLogs").collect();
    assert.equal(logsAfter.length, logsCountBefore);
    assert.equal(logsAfter.some((l) => l.action === "request.approve"), false);
  });

  // 11. Duplicate admin operations remain safe
  it("Requirement 11: Duplicate admin operations remain safe and idempotent", async () => {
    const db = new MockConvexDb();
    const { toolId } = await setupLenderBorrowerAndRequest(db);
    const { adminCtx } = await setupAdmin(db);

    // First removal
    const res1 = (await callMutation(adminModule.removeListing, adminCtx, {
      toolId: toolId as unknown as Id<"tools">,
    })) as { success: boolean; alreadyRemoved: boolean };
    assert.equal(res1.alreadyRemoved, false);

    // Second removal
    const res2 = (await callMutation(adminModule.removeListing, adminCtx, {
      toolId: toolId as unknown as Id<"tools">,
    })) as { success: boolean; alreadyRemoved: boolean };
    assert.equal(res2.alreadyRemoved, true);
  });

  // 12. Security: Elimination of browser-callable admin provisioning & operator-only internal provisioning
  it("Requirement 12: No public function exposes admin provisioning and fresh deployment cannot be claimed by arbitrary users", async () => {
    const db = new MockConvexDb();

    // 1. Verify no public admin provisioning function is exported
    assert.equal(
      (adminModule as Record<string, unknown>).provisionInitialAdmin,
      undefined,
      "public provisionInitialAdmin must not exist"
    );

    // 2. On a fresh deployment with 0 admins, ordinary user cannot claim admin
    const user1Ctx = createMockContext(db, { subject: "clerk_u1_fresh", name: "First User" });
    const user1 = (await callMutation(usersModule.ensureCurrentUser, user1Ctx, {
      role: "admin", // Malicious payload attempted
    })) as { _id: string; role: string };

    assert.equal(user1.role, "user", "First user on fresh deployment must remain 'user'");

    // 3. Operator executes controlled internal provisioning (simulating CLI: npx convex run admin:provisionAdminInternal)
    const operatorCtx = createMockContext(db, null); // Internal/CLI execution context
    const cliRes = (await callMutation(adminModule.provisionAdminInternal, operatorCtx, {
      clerkId: "clerk_u1_fresh",
    })) as { success: boolean; alreadyAdmin: boolean; role: string; userId: string };

    assert.equal(cliRes.success, true);
    assert.equal(cliRes.alreadyAdmin, false);
    assert.equal(cliRes.role, "admin");

    const u1Db = await db.get(user1._id);
    assert.equal(u1Db?.role, "admin");

    // 4. Repeated operator call is safe and idempotent
    const repeatRes = (await callMutation(adminModule.provisionAdminInternal, operatorCtx, {
      userId: user1._id as unknown as Id<"users">,
    })) as { success: boolean; alreadyAdmin: boolean; role: string };
    assert.equal(repeatRes.alreadyAdmin, true);
    assert.equal(repeatRes.role, "admin");

    // 5. Audit log recorded without secrets
    const auditLogs = await db.query("auditLogs").collect();
    const provisionLog = auditLogs.find((l) => l.action === "admin.provisioned");
    assert.ok(provisionLog);
    assert.equal(provisionLog.targetId, user1._id);
    assert.deepEqual(provisionLog.metadata, { method: "operator_internal" });

    // 6. Provisioned admin can immediately access administrative functions
    const adminLoans = (await callQuery(adminModule.listAllLoans, user1Ctx, {})) as Array<unknown>;
    assert.ok(Array.isArray(adminLoans));
  });
});



