#!/usr/bin/env node
import { run } from "spotikit-kit/lib/cli.mjs";

run(["create", ...process.argv.slice(2)]);
