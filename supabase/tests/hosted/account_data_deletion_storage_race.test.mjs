import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef = process.env.SUPABASE_PROJECT_REF;
const hostedTest = accessToken && projectRef ? test : test.skip;

const queryEndpoint = `https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/database/query`;

async function runSql(query) {
  const response = await fetch(queryEndpoint, {
    body: JSON.stringify({ query }),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    method: "POST",
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json();
  assert.equal(response.status, 201, "hosted SQL request must succeed");
  return body;
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function waitUntilUploaderReachedHold(signalKey) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const rows = await runSql(`
      select case
        when pg_try_advisory_lock(${signalKey}) then
          not pg_advisory_unlock(${signalKey})
        else true
      end as uploader_holding;
    `);
    if (rows.some((row) => row.uploader_holding === true)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("The uncommitted Storage transaction did not reach its hold point.");
}

hostedTest("account deletion cannot finalize before an in-flight Storage INSERT transaction ends", async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const ownerId = `h3_storage_race_${suffix}`;
  const momentId = randomUUID();
  const generationId = randomUUID();
  const imagePath = `${ownerId}/${momentId}/${generationId}`;
  const signalKey = Number.parseInt(suffix.slice(0, 7), 16);

  await runSql(`
    insert into public.moments (
      id, owner_id, title, description, mood, moment_date
    ) values (
      ${sqlLiteral(momentId)}::uuid,
      ${sqlLiteral(ownerId)},
      'Storage race fixture',
      'Temporary hosted concurrency verification.',
      'calm',
      '2026-09-05'
    );
    insert into public.moment_image_cleanup_authorizations (
      image_path, owner_id, moment_id
    ) values (
      ${sqlLiteral(imagePath)},
      ${sqlLiteral(ownerId)},
      ${sqlLiteral(momentId)}::uuid
    );
  `);

  try {
    const uploader = runSql(`
      begin;
      set local role authenticated;
      set local "request.jwt.claims" =
        ${sqlLiteral(JSON.stringify({ sub: ownerId, role: "authenticated" }))};
      insert into storage.objects (bucket_id, name, owner_id)
      values ('moment-images', ${sqlLiteral(imagePath)}, ${sqlLiteral(ownerId)});
      select pg_advisory_lock(${signalKey});
      select pg_sleep(4);
      select pg_advisory_unlock(${signalKey});
      rollback;
    `);

    await waitUntilUploaderReachedHold(signalKey);

    const deletionRows = await runSql(`
      begin;
      create temporary table deletion_operation (operation_id uuid) on commit drop;
      grant insert, select on table deletion_operation to authenticated;
      set local role authenticated;
      set local "request.jwt.claims" =
        ${sqlLiteral(JSON.stringify({ sub: ownerId, role: "authenticated", fva: [0, -1] }))};
      insert into deletion_operation (operation_id)
      select operation_id from public.begin_account_data_deletion();
      select * from public.complete_moment_image_cleanup(${sqlLiteral(imagePath)});
      select
        verification.outcome,
        verification.remaining_moments,
        verification.remaining_storage_objects,
        verification.remaining_cleanup_authorizations,
        verification.remaining_deletion_jobs
      from deletion_operation
      cross join lateral public.verify_and_finish_account_data_deletion(
        deletion_operation.operation_id
      ) as verification;
      commit;
    `);

    const lockState = await runSql(`
      select case
        when pg_try_advisory_lock(${signalKey}) then
          pg_advisory_unlock(${signalKey})
        else false
      end as uploader_transaction_ended;
    `);
    assert.equal(
      lockState.at(-1)?.uploader_transaction_ended,
      true,
      "deletion finalization must not return while the Storage transaction can still commit",
    );
    await uploader;

    const verification = deletionRows.find(
      (row) => row.outcome === "complete",
    );
    assert.deepEqual(verification, {
      outcome: "complete",
      remaining_cleanup_authorizations: 0,
      remaining_deletion_jobs: 0,
      remaining_moments: 0,
      remaining_storage_objects: 0,
    });

    const finalRows = await runSql(`
      select
        (select count(*)::integer from public.moments where owner_id = ${sqlLiteral(ownerId)}) as moments,
        (select count(*)::integer from storage.objects where bucket_id = 'moment-images' and name = ${sqlLiteral(imagePath)}) as objects,
        (select count(*)::integer from public.moment_image_cleanup_authorizations where owner_id = ${sqlLiteral(ownerId)}) as cleanup_authorizations,
        (select count(*)::integer from public.account_data_deletion_jobs where owner_id = ${sqlLiteral(ownerId)}) as deletion_jobs;
    `);
    assert.deepEqual(finalRows.at(-1), {
      cleanup_authorizations: 0,
      deletion_jobs: 0,
      moments: 0,
      objects: 0,
    });
  } finally {
    await runSql(`
      delete from public.moment_image_cleanup_authorizations
      where owner_id = ${sqlLiteral(ownerId)};
      delete from public.account_data_deletion_jobs
      where owner_id = ${sqlLiteral(ownerId)};
      delete from public.moments
      where owner_id = ${sqlLiteral(ownerId)};
    `);
  }
});
