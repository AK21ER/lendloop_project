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

function ToolAvailabilityView({ toolId }: { toolId: Id<"tools"> }) {
  const activeLoans = useQuery(api.loans.getToolAvailability, { toolId });

  if (activeLoans === undefined) {
    return <p className="text-xs text-gray-500">Checking availability...</p>;
  }

  if (activeLoans.length === 0) {
    return (
      <div className="rounded bg-green-50 p-2 text-xs text-green-800 border border-green-200">
        ✓ No active loans scheduled. All dates currently open.
      </div>
    );
  }

  return (
    <div className="rounded bg-amber-50 p-2.5 text-xs text-amber-900 border border-amber-200 space-y-1">
      <p className="font-semibold">Currently reserved dates (active loans):</p>
      <ul className="list-disc list-inside space-y-0.5">
        {activeLoans.map((l, i) => (
          <li key={i}>
            <span className="font-medium">{l.startDate}</span> to{" "}
            <span className="font-medium">{l.dueDate}</span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-amber-700">
        Requests overlapping with active loans will be rejected upon approval.
      </p>
    </div>
  );
}

function UserProfileAndTools() {
  const identity = useQuery(api.authTest.getMyIdentity, {});
  const me = useQuery(api.users.getMe, {});
  const ensureUser = useMutation(api.users.ensureCurrentUser);

  const myListings = useQuery(api.tools.listMine, me ? {} : "skip");
  const browseTools = useQuery(api.tools.listAll, me ? {} : "skip");
  const myRequests = useQuery(api.requests.listMine, me ? {} : "skip");
  const incomingRequests = useQuery(api.requests.listIncoming, me ? {} : "skip");
  const myLoans = useQuery(api.loans.listMine, me ? {} : "skip");

  const createTool = useMutation(api.tools.create);
  const updateTool = useMutation(api.tools.update);
  const removeMine = useMutation(api.tools.removeMine);
  const createRequest = useMutation(api.requests.create);
  const approveRequest = useMutation(api.requests.approve);
  const declineRequest = useMutation(api.requests.decline);
  const markReturned = useMutation(api.loans.markReturned);

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

  // Borrow Request Modal State
  const [borrowModalTool, setBorrowModalTool] = useState<{
    _id: Id<"tools">;
    name: string;
    category: string;
    condition: string;
  } | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestSuccess, setRequestSuccess] = useState<string | null>(null);
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);

  // Incoming Requests Actions State
  const [requestActionLoadingId, setRequestActionLoadingId] = useState<string | null>(null);
  const [requestActionMessage, setRequestActionMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Loan Actions State
  const [loanActionLoadingId, setLoanActionLoadingId] = useState<string | null>(null);
  const [loanActionMessage, setLoanActionMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

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

  const handleOpenBorrowModal = (tool: {
    _id: Id<"tools">;
    name: string;
    category: string;
    condition: string;
  }) => {
    setBorrowModalTool(tool);
    setStartDate("");
    setEndDate("");
    setRequestError(null);
    setRequestSuccess(null);
  };

  const handleSubmitBorrowRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!borrowModalTool) return;
    setIsSubmittingRequest(true);
    setRequestError(null);
    setRequestSuccess(null);

    try {
      await createRequest({
        toolId: borrowModalTool._id,
        startDate,
        endDate,
      });
      setRequestSuccess("Borrow request submitted successfully (pending owner approval)!");
      setTimeout(() => {
        setBorrowModalTool(null);
        setRequestSuccess(null);
      }, 2500);
    } catch (err: unknown) {
      setRequestError(err instanceof Error ? err.message : "Failed to submit borrow request");
    } finally {
      setIsSubmittingRequest(false);
    }
  };

  const handleApproveRequest = async (requestId: Id<"borrowRequests">) => {
    setRequestActionLoadingId(requestId);
    setRequestActionMessage(null);
    try {
      const res = await approveRequest({ requestId });
      setRequestActionMessage({
        type: "success",
        text: res.alreadyApproved
          ? "Request was already approved."
          : "Request approved and loan created successfully!",
      });
      setTimeout(() => setRequestActionMessage(null), 4000);
    } catch (err: unknown) {
      setRequestActionMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to approve request",
      });
    } finally {
      setRequestActionLoadingId(null);
    }
  };

  const handleDeclineRequest = async (requestId: Id<"borrowRequests">) => {
    if (!confirm("Are you sure you want to decline this borrow request?")) return;
    setRequestActionLoadingId(requestId);
    setRequestActionMessage(null);
    try {
      const res = await declineRequest({ requestId });
      setRequestActionMessage({
        type: "success",
        text: res.alreadyDeclined ? "Request was already declined." : "Request declined.",
      });
      setTimeout(() => setRequestActionMessage(null), 4000);
    } catch (err: unknown) {
      setRequestActionMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to decline request",
      });
    } finally {
      setRequestActionLoadingId(null);
    }
  };

  const handleMarkReturned = async (loanId: Id<"loans">) => {
    if (!confirm("Confirm that this tool has been returned in satisfactory condition?")) return;
    setLoanActionLoadingId(loanId);
    setLoanActionMessage(null);
    try {
      const res = await markReturned({ loanId });
      setLoanActionMessage({
        type: "success",
        text: res.alreadyReturned
          ? "Loan was already marked returned."
          : "Loan marked as returned!",
      });
      setTimeout(() => setLoanActionMessage(null), 4000);
    } catch (err: unknown) {
      setLoanActionMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to mark tool returned",
      });
    } finally {
      setLoanActionLoadingId(null);
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

      {/* Browse Tools to Borrow Section */}
      <section className="rounded-lg border bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold mb-2">Browse Available Tools</h2>
        <p className="text-xs text-gray-500 mb-4">
          Select another neighbor&apos;s active tool to submit a borrow request.
        </p>

        {browseTools === undefined ? (
          <p className="text-sm text-gray-500">Loading tools...</p>
        ) : browseTools.length === 0 ? (
          <p className="text-sm text-gray-500">No active tools currently available to borrow.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {browseTools.map((tool) => {
              const isOwnTool = me ? tool.ownerId === me._id : false;
              return (
                <div key={tool._id} className="rounded border p-4 bg-gray-50 space-y-2 flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-start">
                      <h4 className="font-semibold text-gray-900">{tool.name}</h4>
                      <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                        {tool.category}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Condition: <span className="font-medium text-gray-700">{tool.condition}</span>
                    </p>
                    {tool.description && (
                      <p className="text-xs text-gray-600 mt-2 line-clamp-2">{tool.description}</p>
                    )}
                  </div>

                  <div className="pt-2">
                    {isOwnTool ? (
                      <span className="inline-block text-xs text-gray-400 italic">
                        Your Listing
                      </span>
                    ) : (
                      <button
                        onClick={() => handleOpenBorrowModal(tool)}
                        className="w-full rounded bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
                      >
                        Request to Borrow
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Borrow Request Modal / Inline Box */}
      {borrowModalTool && (
        <section className="rounded-lg border-2 border-indigo-500 bg-indigo-50 p-6 shadow-md">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-lg font-bold text-gray-900">
              Request to Borrow: {borrowModalTool.name}
            </h3>
            <button
              onClick={() => setBorrowModalTool(null)}
              className="text-gray-500 hover:text-gray-700 text-sm font-semibold"
            >
              ✕ Cancel
            </button>
          </div>

          <p className="text-xs text-gray-600 mb-3">
            Category: <span className="font-medium">{borrowModalTool.category}</span> | Condition:{" "}
            <span className="font-medium">{borrowModalTool.condition}</span>
          </p>

          {/* Availability helper */}
          <div className="mb-4">
            <ToolAvailabilityView toolId={borrowModalTool._id} />
          </div>

          <form onSubmit={handleSubmitBorrowRequest} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700">Start Date (inclusive)</label>
                <input
                  type="date"
                  required
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700">End Date (inclusive)</label>
                <input
                  type="date"
                  required
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm"
                />
              </div>
            </div>

            {requestError && (
              <div className="rounded bg-red-100 p-2 text-xs font-medium text-red-700">
                {requestError}
              </div>
            )}

            {requestSuccess && (
              <div className="rounded bg-green-100 p-2 text-xs font-medium text-green-700">
                {requestSuccess}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={isSubmittingRequest}
                className="rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {isSubmittingRequest ? "Submitting..." : "Submit Borrow Request"}
              </button>
              <button
                type="button"
                onClick={() => setBorrowModalTool(null)}
                className="rounded border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      {/* My Requests Section */}
      <section className="rounded-lg border bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold mb-2">My Requests ({myRequests?.length ?? 0})</h2>
        <p className="text-xs text-gray-500 mb-4">
          Borrow requests you have submitted to other tool owners.
        </p>

        {myRequests === undefined ? (
          <p className="text-sm text-gray-500">Loading requests...</p>
        ) : myRequests.length === 0 ? (
          <p className="text-sm text-gray-500">You have not submitted any borrow requests yet.</p>
        ) : (
          <div className="divide-y">
            {myRequests.map((req) => (
              <div key={req._id} className="py-3 flex items-center justify-between">
                <div>
                  <h4 className="font-semibold text-gray-900">{req.toolName}</h4>
                  <p className="text-xs text-gray-500">
                    Category: {req.toolCategory} | Requested Dates:{" "}
                    <span className="font-medium text-gray-700">
                      {req.startDate} to {req.endDate}
                    </span>
                  </p>
                </div>
                <div>
                  <span
                    className={`rounded px-2.5 py-1 text-xs font-semibold ${
                      req.status === "pending"
                        ? "bg-yellow-100 text-yellow-800"
                        : req.status === "approved"
                        ? "bg-green-100 text-green-800"
                        : "bg-red-100 text-red-800"
                    }`}
                  >
                    {req.status.toUpperCase()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Incoming Requests Section (Phase 3.3 Approval Workflow) */}
      <section className="rounded-lg border bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold mb-2">Incoming Requests ({incomingRequests?.length ?? 0})</h2>
        <p className="text-xs text-gray-500 mb-4">
          Borrow requests from neighbors for your tools. Approving creates an active loan immediately.
        </p>

        {requestActionMessage && (
          <div
            className={`mb-4 rounded p-3 text-xs font-medium ${
              requestActionMessage.type === "success"
                ? "bg-green-100 text-green-800 border border-green-200"
                : "bg-red-100 text-red-800 border border-red-200"
            }`}
          >
            {requestActionMessage.text}
          </div>
        )}

        {incomingRequests === undefined ? (
          <p className="text-sm text-gray-500">Loading incoming requests...</p>
        ) : incomingRequests.length === 0 ? (
          <p className="text-sm text-gray-500">No incoming borrow requests for your tools.</p>
        ) : (
          <div className="divide-y">
            {incomingRequests.map((req) => {
              const isActioning = requestActionLoadingId === req._id;
              return (
                <div key={req._id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h4 className="font-semibold text-gray-900">{req.toolName}</h4>
                    <p className="text-xs text-gray-500">
                      Requested by: <span className="font-medium text-gray-800">{req.borrowerDisplayName}</span>
                    </p>
                    <p className="text-xs text-gray-500">
                      Dates: <span className="font-medium text-gray-700">{req.startDate} to {req.endDate}</span>
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {req.status === "pending" ? (
                      <>
                        <button
                          disabled={isActioning}
                          onClick={() => handleApproveRequest(req._id)}
                          className="rounded bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                        >
                          {isActioning ? "Saving..." : "Approve"}
                        </button>
                        <button
                          disabled={isActioning}
                          onClick={() => handleDeclineRequest(req._id)}
                          className="rounded bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          Decline
                        </button>
                      </>
                    ) : (
                      <span
                        className={`rounded px-2.5 py-1 text-xs font-semibold ${
                          req.status === "approved"
                            ? "bg-green-100 text-green-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {req.status.toUpperCase()}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* My Loans Section (Phase 3.3) */}
      <section className="rounded-lg border bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-bold">My Loans ({myLoans?.length ?? 0})</h2>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          All active and completed loans where you are borrowing or lending.
        </p>

        {loanActionMessage && (
          <div
            className={`mb-4 rounded p-3 text-xs font-medium ${
              loanActionMessage.type === "success"
                ? "bg-green-100 text-green-800 border border-green-200"
                : "bg-red-100 text-red-800 border border-red-200"
            }`}
          >
            {loanActionMessage.text}
          </div>
        )}

        {myLoans === undefined ? (
          <p className="text-sm text-gray-500">Loading loans...</p>
        ) : myLoans.length === 0 ? (
          <p className="text-sm text-gray-500">No active or completed loans yet.</p>
        ) : (
          <div className="divide-y">
            {myLoans.map((loan) => {
              const isActioning = loanActionLoadingId === loan._id;
              const isLender = loan.isLender;
              const counterparty = isLender ? loan.borrowerDisplayName : loan.lenderDisplayName;

              return (
                <div key={loan._id} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold text-gray-900">{loan.toolName}</h4>
                      <span
                        className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                          isLender
                            ? "bg-purple-100 text-purple-800"
                            : "bg-blue-100 text-blue-800"
                        }`}
                      >
                        {isLender ? "Lending" : "Borrowing"}
                      </span>
                    </div>

                    <p className="text-xs text-gray-500">
                      {isLender ? "Borrower" : "Lender"}:{" "}
                      <span className="font-medium text-gray-800">{counterparty}</span>
                    </p>

                    <p className="text-xs text-gray-500">
                      Scheduled: <span className="font-medium text-gray-700">{loan.startDate}</span> to{" "}
                      <span className="font-medium text-gray-700">{loan.dueDate}</span>
                    </p>

                    {loan.status === "returned" && loan.returnedAt && (
                      <p className="text-[11px] text-gray-500">
                        Returned on: {new Date(loan.returnedAt).toLocaleString()}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Status Badges */}
                    {loan.status === "active" ? (
                      loan.isOverdue ? (
                        <span className="rounded bg-red-100 text-red-800 px-2.5 py-1 text-xs font-semibold">
                          OVERDUE
                        </span>
                      ) : (
                        <span className="rounded bg-emerald-100 text-emerald-800 px-2.5 py-1 text-xs font-semibold">
                          ACTIVE
                        </span>
                      )
                    ) : (
                      <span className="rounded bg-gray-100 text-gray-700 px-2.5 py-1 text-xs font-semibold">
                        RETURNED
                      </span>
                    )}

                    {/* Lender Mark Returned Action */}
                    {isLender && loan.status === "active" && (
                      <button
                        disabled={isActioning}
                        onClick={() => handleMarkReturned(loan._id)}
                        className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {isActioning ? "Saving..." : "Mark Returned"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
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
                        Category: <span className="font-medium text-gray-700">{tool.category}</span> | Condition:{" "}
                        <span className="font-medium text-gray-700">{tool.condition}</span> | Status:{" "}
                        <span className="font-medium text-gray-700">{tool.status}</span>
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
