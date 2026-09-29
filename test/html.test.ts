import { test } from "node:test";
import assert from "node:assert/strict";
import { html, raw } from "../src/html.ts";

test("escapes interpolated values", () => {
  const out = html`<p title="${`"a" & 'b'`}">${"<script>"}</p>`;
  assert.equal(out.value, `<p title="&quot;a&quot; &amp; &#39;b&#39;">&lt;script&gt;</p>`);
});

test("nested html calls and raw() are not re-escaped", () => {
  const inner = html`<b>${"&"}</b>`;
  assert.equal(html`<div>${inner}${raw("<hr>")}</div>`.value, "<div><b>&amp;</b><hr></div>");
});

test("arrays are joined and null/undefined render as empty", () => {
  const items = ["<a>", html`<i>x</i>`];
  assert.equal(html`${items}|${null}|${undefined}|${0}`.value, "&lt;a&gt;<i>x</i>|||0");
});
