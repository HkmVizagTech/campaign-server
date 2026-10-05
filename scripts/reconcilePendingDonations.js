// Checks every pending online donation against Razorpay.
//
//   npm run reconcile:pending                 # report only, changes nothing
//   npm run reconcile:pending -- --apply      # settle the clear cases
//
// Options: --limit <n> (per batch, default 100), --min-age <minutes>
// (skip newer donations, default 30), --once (one batch only),
// --include-failed (also re-check failed donations; one is only ever moved
// to success, when Razorpay shows it was paid after all).
//
// Captured payments become success through the normal capture flow
// (receipt + WhatsApp + DCC). Donations whose every attempt failed are
// marked failed with nothing sent. Everything else is left pending and
// listed in the report for a person to check.
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";

dotenv.config();

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const apply = flag("--apply");
const once = flag("--once");
const limit = Number(option("--limit", 100));
const minAgeMinutes = Number(option("--min-age", 30));
const includeFailed = flag("--include-failed");

const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

const main = async () => {
  for (const key of ["DB_URL", "RAZORPAY_API_KEY", "RAZORPAY_KEY_SECRET"]) {
    if (!process.env[key]) throw new Error(`${key} must be set (see .env.example)`);
  }

  const { connectToDB } = await import("../config/DBConnection.js");
  await import("../models/seva.model.js");
  await import("../models/campaign.model.js");
  await import("../models/campaigner.model.js");
  await import("../models/templeDevote.model.js");
  const { reconcilePendingDonations, OUTCOMES } = await import(
    "../services/reconcile.service.js"
  );

  await connectToDB();
  console.log(
    apply
      ? "APPLY mode: captured -> success (receipt sent), all-failed -> failed."
      : "REPORT mode: nothing will be changed. Re-run with --apply to settle.",
  );

  const rows = [];
  const totals = Object.fromEntries(Object.values(OUTCOMES).map((o) => [o, 0]));
  let before;

  do {
    const result = await reconcilePendingDonations({
      apply,
      before,
      limit,
      minAgeMinutes,
      includeFailed,
    });
    rows.push(...result.rows);
    for (const [outcome, count] of Object.entries(result.counts)) totals[outcome] += count;
    for (const row of result.rows) {
      console.log(
        `${row.donationId}  ₹${row.amount}  ${row.outcome}${row.applied ? " (applied)" : ""}  ${row.result || row.reason}`,
      );
    }
    before = result.nextBefore;
  } while (before && !once);

  const dir = path.join(process.cwd(), "tmp");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(
    dir,
    `reconcile-pending-${apply ? "applied" : "report"}-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`,
  );
  const header = ["donationId", "createdAt", "donorName", "donorPhone", "amount", "outcome", "applied", "paymentId", "reason", "result", "attempts"];
  fs.writeFileSync(
    file,
    [header.join(",")]
      .concat(
        rows.map((r) =>
          [
            r.donationId,
            new Date(r.createdAt).toISOString(),
            r.donorName,
            r.donorPhone,
            r.amount,
            r.outcome,
            r.applied,
            r.paymentId,
            r.reason,
            r.result,
            (r.attempts || []).map((a) => `${a.id}:${a.status}:${a.amount}`).join(" "),
          ]
            .map(csvCell)
            .join(","),
        ),
      )
      .join("\n"),
  );

  console.log("\nTotals:", totals);
  console.log(`Report: ${file}`);
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
