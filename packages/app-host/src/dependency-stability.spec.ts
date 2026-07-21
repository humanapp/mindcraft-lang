import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectUnstableDependencies, UnstableDependencyCode } from "@mindcraft-lang/app-host";

describe("collectUnstableDependencies", () => {
  it("flags branch references without consulting the probe", async () => {
    let probed = 0;
    const unstable = await collectUnstableDependencies({ "org/steering": "gh:org/steering#main" }, async () => {
      probed++;
      return true;
    });

    assert.equal(probed, 0);
    assert.equal(unstable.length, 1);
    assert.equal(unstable[0].coordinate, "org/steering");
    assert.equal(unstable[0].reference, "gh:org/steering#main");
    assert.equal(unstable[0].code, UnstableDependencyCode.BRANCH_REFERENCE);
  });

  it("flags a pin the fetch source does not serve and passes a served pin", async () => {
    const unstable = await collectUnstableDependencies(
      {
        "org/published": "gh:org/published@v1.0.0",
        "org/unpublished": "gh:org/unpublished@v2.0.0",
      },
      async (_owner, repo) => repo === "published"
    );

    assert.equal(unstable.length, 1);
    assert.equal(unstable[0].coordinate, "org/unpublished");
    assert.equal(unstable[0].code, UnstableDependencyCode.VERSION_UNPUBLISHED);
  });

  it("treats embedded references as stable", async () => {
    const unstable = await collectUnstableDependencies({ "org/stdlib": "embedded:org/stdlib" }, async () => false);
    assert.deepStrictEqual(unstable, []);
  });
});
