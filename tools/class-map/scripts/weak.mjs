import { readFileSync, writeFileSync, existsSync } from "node:fs";
const root = (
  process.env.CLASSMAP_WORK ||
  decodeURIComponent(new URL("../work/", import.meta.url).pathname).replace(/^\/(\w:)/, "$1")
).replace(/[\\/]?$/, "/");
const curatedPath = decodeURIComponent(new URL("../curated-names.json", import.meta.url).pathname).replace(
  /^\/(\w:)/,
  "$1"
);
const names = JSON.parse(readFileSync(root + "names2.json", "utf8")).names;
const curated = existsSync(curatedPath) ? JSON.parse(readFileSync(curatedPath, "utf8")) : {};
const BARE =
  /^(container|wrapper|title|image|content|button|icon|text|header|row|item|list|root|inner|label|link|section|body|main|box|grid|column|footer|subtitle|description|info|details|avatar|name|heading|overlay|background|placeholder|skeleton|card|cards|tag|chip|input|form|logo|cover|artwork|thumbnail|metadata|meta|progress|bar|track|dot|bullet|panel|pill|tooltip|close|menu|badge|media|actions|action|separator|divider|spacer|cell|page|view|layout|area|region|shelf|carousel|modal|dialog|popover|svg|path|figure|group|section|contents|trigger|anchor|target|dropdown|option|tabs|tab|switch|toggle|checkbox|radio|slider|uri|url|data|type|state|on|off|active|selected|hidden|visible|disabled|children|child)$/;
const weak = (n) =>
  /-\d+$/.test(n) ||
  /(^|-)(box|element|state)(-|$)/.test(n) ||
  /--on(-\d+)?$/.test(n) ||
  BARE.test(n) ||
  /--(includes|length|shape|index-of|type|spec)(-\d+)?$/.test(n);
const list = Object.entries(names)
  .filter(([c, v]) => !c.startsWith("e-") && !curated[c] && weak(v.stable))
  .map(([c]) => c);
const all = Object.keys(names).filter((c) => !c.startsWith("e-") && !curated[c]).length;
console.log("not curated", all, "weak", list.length, "fine", all - list.length);
if (process.argv[2] === "list") writeFileSync(root + "weak.json", JSON.stringify(list));
if (process.argv[2] === "sample") {
  const fine = Object.entries(names).filter(([c, v]) => !c.startsWith("e-") && !curated[c] && !weak(v.stable));
  for (let i = 0; i < fine.length; i += Math.floor(fine.length / 80))
    console.log(fine[i][1].stable.padEnd(50), fine[i][1].why);
}
