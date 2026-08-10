/**
 * Pins what the side region's tenant is handed: the working copy and history
 * standing right now, the editor's own objects, and nothing at all where no
 * editor stands one.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { BrainServices } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { AddPageCommand, BrainCommandHistory, BrainDef } from "@mindcraft-lang/core/brain/model";
import { renderToStaticMarkup } from "react-dom/server";
import { type EditedBrain, EditedBrainProvider, useEditedBrain } from "./EditedBrainContext";

let services: BrainServices;

before(() => {
  services = __test__createBrainServices();
});

/** Render a probe under `value` and hand back what the probe read. */
function readThrough(value: EditedBrain | undefined): EditedBrain | undefined {
  let read: EditedBrain | undefined;
  function Probe() {
    read = useEditedBrain();
    return null;
  }
  renderToStaticMarkup(
    <EditedBrainProvider value={value}>
      <Probe />
    </EditedBrainProvider>
  );
  return read;
}

describe("the brain a tenant is handed", () => {
  test("is the working copy and the history it was stood with", () => {
    const edited: EditedBrain = { brainDef: BrainDef.emptyBrainDef(services), history: new BrainCommandHistory() };

    const read = readThrough(edited);

    assert.equal(read?.brainDef, edited.brainDef);
    assert.equal(read?.history, edited.history);
  });

  test("names the brain being edited by the working copy's id", () => {
    const source = BrainDef.emptyBrainDef(services);

    const read = readThrough({ brainDef: source.workingCopy(), history: new BrainCommandHistory() });

    assert.equal(read?.brainDef.id(), source.id());
  });

  test("takes an edit run through it, which the history takes back", () => {
    const edited: EditedBrain = { brainDef: BrainDef.emptyBrainDef(services), history: new BrainCommandHistory() };
    const read = readThrough(edited);
    const pagesBefore = edited.brainDef.pages().size();

    read?.history.executeCommand(new AddPageCommand(read.brainDef));
    assert.equal(edited.brainDef.pages().size(), pagesBefore + 1);
    read?.history.undo();

    assert.equal(edited.brainDef.pages().size(), pagesBefore);
  });

  test("is nothing while the editor holds no working copy", () => {
    assert.equal(readThrough(undefined), undefined);
  });

  test("is nothing outside an editor", () => {
    let read: EditedBrain | undefined;
    function Loose() {
      read = useEditedBrain();
      return null;
    }

    renderToStaticMarkup(<Loose />);

    assert.equal(read, undefined);
  });
});
