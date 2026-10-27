#!/usr/bin/env node
'use strict';
// Sellers' Sheet 2026 "Form Responses 5" CSV -> BST Flow import.
// Offline only: reads a local CSV, writes a report and SQL/JSON files.
// It never connects to the database, Google, email or anything else.

const fs = require('fs');
const path = require('path');
const { parseCsv } = require('./lib/csv');
const { buildPlan, DEFAULT_CUTOFF } = require('./lib/plan');
const { formatReport, summarize } = require('./lib/report');
const { buildSql, buildRollbackSql, buildJson } = require('./lib/sql');

const DANDELION_TENANT = '95ba216b-2f0a-470b-accd-c4b8c08b333e';

const USAGE = `Usage:
  node import.js --input <export.csv> [--dry-run] [options]

Options:
  --input <file>        CSV exported from the "Form Responses 5" tab (required)
  --dry-run             Print the report only; write nothing (default if no --out-* given)
  --out-sql <file>      Write the idempotent import SQL script
  --out-rollback <file> Write a rollback SQL script for this batch
  --out-json <file>     Write the plan as a JSON payload
  --existing <file>     JSON of keys already in the database (see README) to
                        report exact add/skip counts offline
  --cutoff YYYY-MM-DD   Only rows with Timestamp on/after this date (default ${DEFAULT_CUTOFF})
  --tenant <uuid>       Tenant id (default: Dandelion Kids ${DANDELION_TENANT})
  --tz <IANA zone>      Time zone of the sheet timestamps (default America/New_York)
  --summary-json        Print the summary as JSON instead of text
  --verbose             List every flagged / skipped row number
  --no-transaction      Omit BEGIN/COMMIT in the SQL (when the runner wraps it)
`;

function parseArgs(argv) {
  const a = { dryRun: false, verbose: false, transaction: true, summaryJson: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => { const v = argv[++i]; if (v == null) throw new Error(`${k} needs a value`); return v; };
    switch (k) {
      case '--input': a.input = next(); break;
      case '--dry-run': a.dryRun = true; break;
      case '--out-sql': a.outSql = next(); break;
      case '--out-rollback': a.outRollback = next(); break;
      case '--out-json': a.outJson = next(); break;
      case '--existing': a.existing = next(); break;
      case '--cutoff': a.cutoff = next(); break;
      case '--tenant': a.tenant = next(); break;
      case '--tz': a.tz = next(); break;
      case '--verbose': a.verbose = true; break;
      case '--summary-json': a.summaryJson = true; break;
      case '--no-transaction': a.transaction = false; break;
      case '-h': case '--help': a.help = true; break;
      default: throw new Error(`unknown option ${k}`);
    }
  }
  return a;
}

function main(argv) {
  let args;
  try { args = parseArgs(argv); } catch (e) { process.stderr.write(e.message + '\n\n' + USAGE); return 2; }
  if (args.help || !args.input) { process.stdout.write(USAGE); return args.help ? 0 : 2; }
  if (args.cutoff && !/^\d{4}-\d{2}-\d{2}$/.test(args.cutoff)) { process.stderr.write('--cutoff must be YYYY-MM-DD\n'); return 2; }

  const tenantId = args.tenant || DANDELION_TENANT;
  const csvText = fs.readFileSync(args.input, 'utf8');
  const rows = parseCsv(csvText);
  const existing = args.existing ? JSON.parse(fs.readFileSync(args.existing, 'utf8')) : null;
  const plan = buildPlan(rows, { cutoff: args.cutoff, tz: args.tz, tenantId, existing });

  if (args.summaryJson) process.stdout.write(JSON.stringify(summarize(plan), null, 2) + '\n');
  else process.stdout.write(formatReport(plan, { verbose: args.verbose }) + '\n');

  const writing = !args.dryRun && (args.outSql || args.outJson || args.outRollback);
  if (args.dryRun && (args.outSql || args.outJson || args.outRollback)) {
    process.stderr.write('\n--dry-run given: not writing any output files.\n');
  }
  if (writing) {
    const write = (file, content) => {
      fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
      fs.writeFileSync(file, content);
      process.stderr.write(`wrote ${file}\n`);
    };
    if (args.outSql) write(args.outSql, buildSql(plan, { tenantId, transaction: args.transaction }));
    if (args.outRollback) write(args.outRollback, buildRollbackSql(plan, { tenantId }));
    if (args.outJson) write(args.outJson, JSON.stringify(buildJson(plan, { tenantId }), null, 2) + '\n');
  }
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { main, parseArgs };
