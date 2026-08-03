import { safelyPlanMaintenance, type MaintenanceOperation } from "../lifecycle/maintain.js";

const operation = process.argv[2];
if (operation !== "update" && operation !== "remove") {
  throw new Error("Usage: maintain-fixture-loader update|remove");
}

process.stdout.write(`${JSON.stringify(await safelyPlanMaintenance(operation as MaintenanceOperation))}\n`);
