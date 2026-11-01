"use client";

import { useState, useEffect } from "react";
import {
  Authenticated,
  Unauthenticated,
  AuthLoading,
  useQuery,
  useMutation,
} from "convex/react";
import {
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { TOOL_CATEGORIES, TOOL_CONDITIONS } from "../convex/constants";

function UserProfileAndTools() {
  const identity = useQuery(api.authTest.getMyIdentity, {});
  const me = useQuery(api.users.getMe, {});
  const ensureUser = useMutation(api.users.ensureCurrentUser);

  const myListings = useQuery(api.tools.listMine, me ? {} : "skip");
  const createTool = useMutation(api.tools.create);
  const updateTool = useMutation(api.tools.update);
  const removeMine = useMutation(api.tools.removeMine);

  const [createForm, setCreateForm] = useState({
    name: "",
    category: TOOL_CATEGORIES[0] as string,
    condition: TOOL_CONDITIONS[0] as string,
    description: "",
  });
  const [createStatus, setCreateStatus] = useState<string | null>(null);

  const [editingToolId, setEditingToolId] = useState<Id<"tools"> | null>(null);
  const [editName, setEditName] = useState("");
  const [editCondition, setEditCondition] = useState("");
  const [editDesc, setEditDesc] = useState("");

  // Auto-sync profile on mount
  useEffect(() => {
    ensureUser().catch((err) => {
      console.error("Failed to sync user profile:", err);
    });
  }, [ensureUser]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateStatus("Creating...");
    try {
      await createTool({
        name: createForm.name,
        category: createForm.category,
        condition: createForm.condition,
        description: createForm.description,
      });
      setCreateForm({
        name: "",
        category: TOOL_CATEGORIES[0],
        condition: TOOL_CONDITIONS[0],
        description: "",
      });
      setCreateStatus("Listing created successfully!");
      setTimeout(() => setCreateStatus(null), 3000);
    } catch (err: unknown) {
      setCreateStatus(err instanceof Error ? err.message : "Failed to create listing");
    }
  };

  const handleStartEdit = (tool: {
    _id: Id<"tools">;
    name: string;
    condition: string;
    description: string;
  }) => {
    setEditingToolId(tool._id);
    setEditName(tool.name);
    setEditCondition(tool.condition);
    setEditDesc(tool.description);
  };

  const handleSaveEdit = async (toolId: Id<"tools">) => {
    try {
      await updateTool({
        toolId,
        name: editName,
        condition: editCondition,
        description: editDesc,
      });
      setEditingToolId(null);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to update tool");
    }
  };

  const handleRemove = async (toolId: Id<"tools">) => {
    if (!confirm("Are you sure you want to remove this tool listing?")) return;
    try {
      await removeMine({ toolId });
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to remove tool");
    }
  };

  return (
    <div className="space-y-8">
      {/* Profile Section */}
      <section className="rounded-lg border bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">User Profile</h2>
          <UserButton />
        </div>
        <div className="mt-4 space-y-1 text-sm text-gray-700">
          <p>
            <span className="font-semibold">Display Name:</span>{" "}
            {me?.displayName ?? "Syncing..."}
          </p>
          <p>
            <span className="font-semibold">Role:</span>{" "}
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium">
              {me?.role ?? "..."}
            </span>
          </p>
          <p>
            <span className="font-semibold">Trusted Lender:</span>{" "}
            {me?.isTrustedLender ? "Yes" : "No"}
          </p>
          <p>
            <span className="font-semibold">Clerk Subject:</span>{" "}
            <code className="text-xs">{identity?.clerkId ?? me?.clerkId}</code>
          </p>
        </div>
      </section>

      {/* Create Listing Section */}
      <section className="rounded-lg border bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold mb-4">Create Tool Listing</h2>
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Tool Name</label>
            <input
              type="text"
              required
              maxLength={100}
              value={createForm.name}
              onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              placeholder="e.g. Cordless Drill"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Category</label>
              <select
                value={createForm.category}
                onChange={(e) => setCreateForm({ ...createForm, category: e.target.value })}
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
              >
                {TOOL_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Condition</label>
              <select
                value={createForm.condition}
                onChange={(e) => setCreateForm({ ...createForm, condition: e.target.value })}
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
              >
                {TOOL_CONDITIONS.map((cond) => (
                  <option key={cond} value={cond}>
                    {cond}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Description</label>
            <textarea
              maxLength={500}
              rows={3}
              value={createForm.description}
              onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              placeholder="Details about the tool and loan terms..."
            />
          </div>

          <button
            type="submit"
            className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Create Listing
          </button>

          {createStatus && (
            <p className="text-sm font-medium text-blue-600 mt-2">{createStatus}</p>
          )}
        </form>
      </section>

      {/* My Listings Section */}
      <section className="rounded-lg border bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold mb-4">My Listings ({myListings?.length ?? 0})</h2>
        {myListings === undefined ? (
          <p className="text-sm text-gray-500">Loading listings...</p>
        ) : myListings.length === 0 ? (
          <p className="text-sm text-gray-500">You have no listings yet.</p>
        ) : (
          <div className="divide-y">
            {myListings.map((tool) => (
              <div key={tool._id} className="py-4 space-y-2">
                {editingToolId === tool._id ? (
                  <div className="space-y-3 rounded bg-gray-50 p-3">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full rounded border p-1 text-sm font-medium"
                    />
                    <select
                      value={editCondition}
                      onChange={(e) => setEditCondition(e.target.value)}
                      className="rounded border p-1 text-sm"
                    >
                      {TOOL_CONDITIONS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <textarea
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      className="w-full rounded border p-1 text-sm"
                      rows={2}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleSaveEdit(tool._id)}
                        className="rounded bg-green-600 px-3 py-1 text-xs text-white"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingToolId(null)}
                        className="rounded border px-3 py-1 text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-gray-900">{tool.name}</h3>
                      <p className="text-xs text-gray-500">
                        Category: <span className="font-medium text-gray-700">{tool.category}</span> | Condition: <span className="font-medium text-gray-700">{tool.condition}</span> | Status: <span className="font-medium text-gray-700">{tool.status}</span>
                      </p>
                      {tool.description && (
                        <p className="mt-1 text-sm text-gray-600">{tool.description}</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleStartEdit(tool)}
                        className="rounded border px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleRemove(tool._id)}
                        className="rounded border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function PublicListingsSection() {
  const publicListings = useQuery(api.tools.listPublic, {});

  return (
    <section className="mt-8 rounded-lg border bg-white p-6 shadow-sm">
      <h2 className="text-xl font-bold mb-2">Public Catalog (Available Listings)</h2>
      <p className="text-xs text-gray-500 mb-4">
        Accessible without authentication. Exposes only tool name and category.
      </p>

      {publicListings === undefined ? (
        <p className="text-sm text-gray-500">Loading catalog...</p>
      ) : publicListings.length === 0 ? (
        <p className="text-sm text-gray-500">No public active listings found.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {publicListings.map((tool, idx) => (
            <div key={`${tool.name}-${idx}`} className="rounded border p-3 bg-gray-50">
              <h4 className="font-semibold text-gray-900">{tool.name}</h4>
              <span className="inline-block mt-1 rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                {tool.category}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl p-6 sm:p-10 space-y-6">
      <header className="border-b pb-4">
        <h1 className="text-3xl font-bold text-gray-900">LendLoop</h1>
        <p className="text-gray-600 mt-1">
          Borrow what you need. Lend what you don&apos;t.
        </p>
      </header>

      <AuthLoading>
        <div className="rounded-lg border bg-white p-6 text-center text-gray-600">
          Checking authentication status...
        </div>
      </AuthLoading>

      <Unauthenticated>
        <div className="rounded-lg border bg-white p-8 text-center space-y-4">
          <p className="text-gray-700">
            Sign in to manage your profile and borrow or lend neighborhood tools.
          </p>
          <div className="flex justify-center gap-4">
            <SignInButton mode="modal">
              <button className="rounded bg-black px-5 py-2 text-sm font-medium text-white hover:bg-gray-800">
                Sign in
              </button>
            </SignInButton>

            <SignUpButton mode="modal">
              <button className="rounded border px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                Sign up
              </button>
            </SignUpButton>
          </div>
        </div>
      </Unauthenticated>

      <Authenticated>
        <UserProfileAndTools />
      </Authenticated>

      {/* Public listings visible to all visitors */}
      <PublicListingsSection />
    </main>
  );
}
