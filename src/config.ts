import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const packageVersion = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
).version;

export const parseArguments = () => {
  return yargs(hideBin(process.argv))
    .option("endpoint", {
      alias: "e",
      description: "Default GraphQL endpoint URL",
      type: "string",
      default: process.env.ENDPOINT ?? "http://localhost:4000/graphql",
    })
    .option("headers", {
      alias: "H",
      description: "Default headers for all requests (as JSON string)",
      type: "string",
    })
    .option("timeout", {
      alias: "t",
      description: "Default request timeout in milliseconds",
      type: "number",
      default: Number(process.env.TIMEOUT) ?? 30000,
    })
    .option("maxComplexity", {
      alias: "m",
      description: "Maximum allowed query complexity",
      type: "number",
      default: Number(process.env.MAX_DEPTH) ?? 100,
    })
    .help()
    .alias("help", "h")
    .version(packageVersion)
    .alias("version", "v")
    .parseSync();
};

export class Config {
  readonly endpoint: string;
  readonly maxQueryComplexity: number;
  readonly timeout: number;
  readonly headers: Record<string, string>;
  readonly version: string;

  constructor() {
    const argv = parseArguments();

    this.endpoint = argv.endpoint;
    this.maxQueryComplexity = argv.maxComplexity;
    this.timeout = argv.timeout;
    this.version = packageVersion;

    // Parse default headers
    this.headers = {};
    if (argv.headers) {
      try {
        Object.assign(this.headers, JSON.parse(argv.headers));
      } catch (e) {
        console.error("Error parsing default headers:", e);
        console.error("Headers should be a valid JSON object string");
      }
    }
  }
}

export const config = new Config();
