import { CLI, Shim } from "clime";
import * as path from "path";

const commandsPath = path.join(__dirname, "commands");

const cli = new CLI("npm run", commandsPath);

const shim = new Shim(cli);
shim.execute(process.argv);

console.log("UBQ Contribution CLI is running...");
