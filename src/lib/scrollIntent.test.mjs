import assert from "node:assert/strict";
import test from "node:test";

import { isPageReadBack } from "./scrollIntent.js";

const page = { height: 5_000, previousHeight: 5_000, viewportHeight: 852 };

test("an upward scroll inside the page is reading back", () => {
  assert.equal(isPageReadBack({ ...page, previousY: 3_000, y: 2_600 }), true);
  assert.equal(isPageReadBack({ ...page, previousY: 3_000, y: 2_999 }), false, "a sub-pixel jitter is not a gesture");
  assert.equal(isPageReadBack({ ...page, previousY: 2_600, y: 3_000 }), false, "following only moves down");
});

test("iOS rubber-banding past either end is not reading back", () => {
  const end = page.height - page.viewportHeight;
  assert.equal(isPageReadBack({ ...page, previousY: end + 60, y: end + 20 }), false, "settling back from past the end");
  assert.equal(isPageReadBack({ ...page, previousY: end + 40, y: end }), false, "landing on the end after a bounce");
  assert.equal(isPageReadBack({ ...page, previousY: 0, y: -30 }), false, "pulling past the top");
});

test("content above shrinking is not reading back", () => {
  assert.equal(isPageReadBack({ ...page, previousHeight: 5_400, previousY: 3_000, y: 2_700 }), false);
});
