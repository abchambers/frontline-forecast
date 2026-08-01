# Production verification

Run these checks against the production Supabase project after a schema or
access-control deployment. They are read-only and do not expose secrets.

## Row-level security coverage

```sql
select n.nspname as schema_name, c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r'
  and n.nspname = 'public'
order by c.relname;
```

Every public table must show `rls_enabled = true`.

## Anonymous public content boundary

```sql
select policyname, roles, cmd, qual
from pg_policies
where schemaname = 'public'
  and tablename = 'site_content'
order by policyname;
```

The public read policy must constrain access to `is_public = true`. Drafts,
private HQ settings, and school records must not have an anonymous read policy.

## Intended licensing RPC grants

```sql
select
  p.proname,
  has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'create_classroom_join_code',
    'redeem_classroom_join_code',
    'redeem_organization_license'
  )
order by p.proname;
```

Each row must show `anon_can_execute = false` and
`authenticated_can_execute = true`.

## School allocation behavior

Use a disposable test school, class, and test accounts. Confirm that:

1. An active coordinator or instructor membership does not consume a learner seat.
2. A learner enrollment consumes exactly one school seat and one classroom seat.
3. A learner enrollment is rejected when either allocation is exhausted.
4. A suspended license rejects new learner and staff access.
5. Re-opening an existing active membership does not increment a code redemption twice.

Archive test records after review, and record the result in HQ activity history.

## Public application smoke checks

```bash
curl --fail --silent --show-error https://frontline-forecast.com/api/weather > /dev/null
curl --fail --silent --show-error https://frontline-forecast.com/api/alerts > /dev/null
curl --fail --silent --show-error https://frontline-forecast.com/api/radar/frames > /dev/null
curl --head --fail --silent --show-error https://hq.frontline-forecast.com/login
```

The public endpoints should return successful JSON responses. The HQ endpoint
should remain an authenticated private workflow.
