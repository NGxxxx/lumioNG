// `js-beautify` has no `exports` map, so importing its JS-only subpath (skipping the bundled
// CSS/HTML beautifiers pulled in by the package root) has no matching type declaration upstream.
declare module "js-beautify/js/lib/beautify.js" {
  import type jsBeautify from "js-beautify";
  export const js_beautify: typeof jsBeautify.js_beautify;
}
