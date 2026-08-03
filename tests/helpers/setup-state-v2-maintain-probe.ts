import { safelyPlanMaintenance } from "../../src/lifecycle/maintain.js";

const pluginName = process.argv[2];
if (pluginName === undefined) throw new Error("A managed plugin selection is required");
process.stdout.write(`${JSON.stringify(await safelyPlanMaintenance("update", pluginName))}\n`);
