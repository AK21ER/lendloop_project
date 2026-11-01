import type { QueryCtx, MutationCtx } from "../convex/_generated/server";

export interface MockIdentity {
  subject: string;
  name?: string;
  nickname?: string;
  givenName?: string;
  familyName?: string;
  email?: string;
  tokenIdentifier?: string;
}

export type GenericDocument = Record<string, unknown> & {
  _id: string;
  _creationTime: number;
};

export class MockConvexDb {
  tables: Map<string, Map<string, GenericDocument>> = new Map();
  private idCounter = 1;
  private txMutex: Promise<void> = Promise.resolve();

  constructor() {
    this.tables.set("users", new Map());
    this.tables.set("tools", new Map());
  }

  async runTransaction<T>(fn: () => Promise<T>): Promise<T> {
    let release: () => void;
    const nextLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    const currentLock = this.txMutex;
    this.txMutex = currentLock.then(() => nextLock);

    await currentLock;
    try {
      return await fn();
    } finally {
      release!();
    }
  }

  async insert(table: string, doc: Record<string, unknown>): Promise<string> {
    const id = `${table}_${this.idCounter++}`;
    const fullDoc: GenericDocument = {
      ...doc,
      _id: id,
      _creationTime: Date.now(),
    };
    this.tables.get(table)!.set(id, fullDoc);
    return id;
  }

  async get(id: string): Promise<GenericDocument | null> {
    for (const tableMap of this.tables.values()) {
      if (tableMap.has(id)) {
        return { ...tableMap.get(id)! };
      }
    }
    return null;
  }

  async patch(id: string, patch: Record<string, unknown>): Promise<void> {
    for (const tableMap of this.tables.values()) {
      if (tableMap.has(id)) {
        const current = tableMap.get(id)!;
        const updated = { ...current, ...patch };
        tableMap.set(id, updated);
        return;
      }
    }
    throw new Error(`Document ${id} not found`);
  }

  query(table: string) {
    const getDocs = () =>
      Array.from(this.tables.get(table)?.values() || []).map((d) => ({
        ...d,
      }));

    return {
      withIndex(
        indexName: string,
        indexRangeBuilder?: (q: {
          eq: (field: string, value: unknown) => unknown;
        }) => unknown
      ) {
        let filtered = getDocs();

        if (indexRangeBuilder) {
          const conditions: Array<{ field: string; value: unknown }> = [];
          const q = {
            eq(field: string, value: unknown) {
              conditions.push({ field, value });
              return q;
            },
          };
          indexRangeBuilder(q);

          filtered = filtered.filter((doc) => {
            return conditions.every((c) => doc[c.field] === c.value);
          });
        }

        return {
          async unique() {
            if (filtered.length > 1) {
              throw new Error(
                `Multiple documents found when unique was expected for index ${indexName}`
              );
            }
            return filtered[0] ?? null;
          },
          async first() {
            return filtered[0] ?? null;
          },
          async collect() {
            return [...filtered];
          },
          async take(n: number) {
            return filtered.slice(0, n);
          },
        };
      },
      async collect() {
        return getDocs();
      },
      async take(n: number) {
        return getDocs().slice(0, n);
      },
      async unique() {
        const docs = getDocs();
        if (docs.length > 1) {
          throw new Error("Multiple documents found when unique was expected");
        }
        return docs[0] ?? null;
      },
    };
  }
}

export interface MockContext {
  db: MockConvexDb;
  auth: {
    getUserIdentity: () => Promise<MockIdentity | null>;
  };
}

export function createMockContext(
  db: MockConvexDb,
  identity: MockIdentity | null
): MockContext {
  return {
    db,
    auth: {
      async getUserIdentity() {
        return identity
          ? {
              ...identity,
              tokenIdentifier:
                identity.tokenIdentifier ?? `token_${identity.subject}`,
            }
          : null;
      },
    },
  };
}

export async function callMutation<TArgs = Record<string, unknown>, TReturn = unknown>(
  mutationFn: unknown,
  ctx: MockContext,
  args?: TArgs
): Promise<TReturn> {
  const handler = (
    mutationFn as {
      _handler?: (ctx: MutationCtx, args: TArgs) => Promise<TReturn>;
    }
  )._handler;
  if (!handler) {
    throw new Error("Mutation handler not found");
  }
  return await ctx.db.runTransaction(async () => {
    return await handler(ctx as unknown as MutationCtx, args as TArgs);
  });
}

export async function callQuery<TArgs = Record<string, unknown>, TReturn = unknown>(
  queryFn: unknown,
  ctx: MockContext,
  args?: TArgs
): Promise<TReturn> {
  const handler = (
    queryFn as {
      _handler?: (ctx: QueryCtx, args: TArgs) => Promise<TReturn>;
    }
  )._handler;
  if (!handler) {
    throw new Error("Query handler not found");
  }
  return await handler(ctx as unknown as QueryCtx, args as TArgs);
}
