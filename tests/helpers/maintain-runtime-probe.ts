import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const modulePath = process.env.MAINTENANCE_MODULE_PATH;
const mode = process.argv[2];
const operation = process.argv[3] === "remove" ? "remove" : "update";
if (modulePath === undefined || mode === undefined) throw new Error("Missing maintenance probe configuration");

const maintenance = await import(pathToFileURL(resolve(modulePath)).href) as typeof import("../../src/lifecycle/maintain.js");

if (process.env.MAINTENANCE_PROBE_NOW !== undefined) {
  const timestamp = Date.parse(process.env.MAINTENANCE_PROBE_NOW);
  if (!Number.isFinite(timestamp)) throw new Error("Invalid probe clock");
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...args: [] | [string | number | Date]) {
      if (args.length === 0) super(timestamp);
      else super(args[0]);
    }
    static override now(): number {
      return timestamp;
    }
  }
  globalThis.Date = FixedDate as DateConstructor;
}

if (mode === "plan") {
  const state = await maintenance.loadMaintenanceState(operation);
  process.stdout.write(`${JSON.stringify(maintenance.planMaintenance({ state }))}\n`);
} else if (mode === "safe") {
  process.stdout.write(`${JSON.stringify(await maintenance.safelyPlanMaintenance(operation))}\n`);
} else if (mode === "approval") {
  const first = maintenance.planMaintenance({ state: await maintenance.loadMaintenanceState(operation) });
  const second = maintenance.planMaintenance({ state: await maintenance.loadMaintenanceState(operation) });
  process.stdout.write(`${JSON.stringify({
    first,
    second,
    firstAfterReload: maintenance.consumeMaintenanceApproval(first, first.approvalBinding ?? ""),
    secondFirstConsume: maintenance.consumeMaintenanceApproval(second, second.approvalBinding ?? ""),
    secondReplay: maintenance.consumeMaintenanceApproval(second, second.approvalBinding ?? "")
  })}\n`);
} else if (mode === "expiry") {
  const plan = maintenance.planMaintenance({ state: await maintenance.loadMaintenanceState(operation) });
  const expiresAt = plan.preview?.approval.expiresAt;
  if (expiresAt === undefined) throw new Error("Expected a removal preview");
  const future = Date.parse(expiresAt) + 1;
  const RealDate = Date;
  class ExpiredDate extends RealDate {
    constructor(...args: [] | [string | number | Date]) {
      if (args.length === 0) super(future);
      else super(args[0]);
    }
    static override now(): number {
      return future;
    }
  }
  globalThis.Date = ExpiredDate as DateConstructor;
  process.stdout.write(`${JSON.stringify(maintenance.consumeMaintenanceApproval(plan, plan.approvalBinding ?? ""))}\n`);
} else {
  throw new Error(`Unknown maintenance probe mode ${mode}`);
}
