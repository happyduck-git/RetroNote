# db/ — schema, RLS, migrations

Schema lives in `migrations/*.sql`. `0001_baseline.sql` is the operational snapshot (a full bootstrap for an empty `public` schema — **never run against prod**); later files are incremental and applied in order. The integration test harness replays every file in sequence, so each migration's applicability is itself part of what gets tested.

## Tables

- `messages` — `id` (uuid PK), `room_code`, `sender_uid` (defaults to `auth.uid()`, FK to `auth.users`), `sender_client_id`, `sender_nickname`, `text`, `ts` (bigint). Indexed on `(room_code, ts)`.
- `room_memberships` — PK `(room_code, user_id)`, `first_joined_at` (bigint). Later migrations add `nickname` and `alias` columns.

## RLS (read this before changing policies)

RLS is enabled on both tables; all table grants go to anon/authenticated/service_role, so **access control is entirely in the policies**.

- `messages` INSERT: allowed only when `sender_uid = auth.uid()`.
- `messages` SELECT: gated on having a `room_memberships` row for that room with `first_joined_at <= messages.ts`. This is *why* late joiners see no history before they joined — it is intentional, not a bug.
- `room_memberships`: own rows are read/write via `user_id = auth.uid()`.

**`42P17` recursion trap:** a policy on `room_memberships` that queries `room_memberships` (e.g. "let me see co-members in my rooms") can self-reference and trigger Postgres `42P17` infinite recursion, which silently breaks room entry. This has happened before. When a membership policy must reference the table, isolate the lookup (e.g. a `security definer` helper) so the policy does not recurse, and **add/extend an integration scenario** to guard it — unit tests cannot catch this.
