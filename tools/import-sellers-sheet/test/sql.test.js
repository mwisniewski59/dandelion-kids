'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseCsv } = require('../lib/csv');
const { buildPlan } = require('../lib/plan');
const { buildSql, buildRollbackSql, buildJson, lit } = require('../lib/sql');

const ROOT = path.join(__dirname, '..');
const REPO = path.join(ROOT, '..', '..');
const FIXTURE = path.join(ROOT, 'fixtures', 'form-responses-5.sample.csv');
const TENANT = '95ba216b-2f0a-470b-accd-c4b8c08b333e';
const plan = buildPlan(parseCsv(fs.readFileSync(FIXTURE, 'utf8')));

test('lit() escapes single quotes and maps types', () => {
  assert.equal(lit("O'Brien"), "'O''Brien'");
  assert.equal(lit(null), 'null');
  assert.equal(lit(12.5), '12.5');
  assert.equal(lit(true), 'true');
});

test('SQL script: preflight, transaction, batch, insert-only on real tables', () => {
  const sql = buildSql(plan, { tenantId: TENANT });
  assert.match(sql, /^-- Sellers' Sheet/);
  assert.match(sql, /\nbegin;\n/);
  assert.match(sql, /\ncommit;\n$/);
  assert.match(sql, /apply supabase\/migrations\/0004_awaiting_pickup\.sql/);
  assert.ok(sql.includes(plan.batchId));
  // Never deletes or truncates anything in the import script.
  assert.doesNotMatch(sql, /\bdelete\s+from\b|\btruncate\b|\bdrop\s+(table|schema|column|constraint|policy)\b/i);
  // Every real-table write is an insert or a narrowly-scoped update.
  const realWrites = sql.match(/^(insert into|update) public\.\w+/gm);
  assert.deepEqual([...new Set(realWrites)].sort(), [
    'insert into public.activity_log', 'insert into public.customers', 'insert into public.dropoffs',
    'update public.customers',
  ]);
  assert.throws(() => buildSql(plan, { tenantId: 'nope' }), /tenantId/);
  assert.doesNotMatch(buildSql(plan, { tenantId: TENANT, transaction: false }), /\nbegin;\n/);
});

test('rollback + JSON payload', () => {
  const rb = buildRollbackSql(plan, { tenantId: TENANT });
  assert.ok(rb.includes(`details->>'batch' = '${plan.batchId}'`));
  const j = buildJson(plan, { tenantId: TENANT });
  assert.equal(j.dropoffs.length, 139);
  assert.equal(j.customers.length, 78);
});

// Optional end-to-end run against a LOCAL throwaway Postgres.
// Enable with: IMPORT_TEST_PG="-h /path/to/socket -p 5432 -U postgres" npm test
const PG = process.env.IMPORT_TEST_PG;
test('end-to-end on local Postgres: import, re-import (idempotent), rollback', { skip: !PG && 'set IMPORT_TEST_PG to run' }, () => {
  const base = PG.split(/\s+/).filter(Boolean);
  const db = `import_test_${process.pid}`;
  const psql = (args, input) => execFileSync('psql', [...base, '-v', 'ON_ERROR_STOP=1', '-q', '-At', ...args],
    { input, encoding: 'utf8' });
  psql(['-d', 'postgres', '-c', `create database ${db}`]);
  try {
    const run = (sqlText) => psql(['-d', db, '-f', '-'], sqlText);
    run(fs.readFileSync(path.join(REPO, 'supabase', 'tests', 'local_supabase_stub.sql'), 'utf8'));
    for (const f of fs.readdirSync(path.join(REPO, 'supabase', 'migrations')).sort()) {
      run(fs.readFileSync(path.join(REPO, 'supabase', 'migrations', f), 'utf8')
        .split('\n').filter(l => !/create extension if not exists pg_net/.test(l)).join('\n'));
    }
    run(`insert into public.tenants (id, name, slug) values ('${TENANT}', 'Dandelion Kids (TEST)', 'dandelion-kids');`);
    const sql = buildSql(plan, { tenantId: TENANT });
    const r1 = JSON.parse(run(sql).trim().split('\n').pop());
    assert.equal(r1.dropoffs_inserted, 139);
    assert.equal(r1.customers_created, 78);
    assert.equal(Number(r1.inserted_venmo_total), 2627.5);
    const r2 = JSON.parse(run(sql).trim().split('\n').pop());
    assert.equal(r2.dropoffs_inserted, 0);
    assert.equal(r2.dropoffs_skipped_already_present, 139);
    assert.equal(r2.customers_created, 0);
    assert.equal(run('select count(*) from public.dropoffs').trim(), '139');
    assert.equal(run('select sum(total_drops) from public.customers').trim(), '139');
    run(buildRollbackSql(plan, { tenantId: TENANT }));
    assert.equal(run('select count(*) from public.dropoffs').trim(), '0');
    assert.equal(run('select count(*) from public.customers').trim(), '0');
  } finally {
    psql(['-d', 'postgres', '-c', `drop database if exists ${db}`]);
  }
});
