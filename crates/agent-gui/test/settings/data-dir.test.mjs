import assert from "node:assert/strict";
import test from "node:test";

import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { dataDirTargetFor } = loader.loadModule("src/lib/system/dataDir.ts");

test("data dir target creates a openAgent folder inside the picked directory", () => {
  assert.equal(dataDirTargetFor("/Volumes/Data", "/Users/a/.openagent"), "/Volumes/Data/openAgent");
  assert.equal(dataDirTargetFor("D:\\", "C:\\Users\\a\\.openagent"), "D:\\openAgent");
  assert.equal(dataDirTargetFor("D:\\Apps\\", "C:\\Users\\a\\.openagent"), "D:\\Apps\\openAgent");
});

test("picking an existing openAgent folder uses it directly", () => {
  assert.equal(
    dataDirTargetFor("/Volumes/Data/openAgent/", "/Users/a/.openagent"),
    "/Volumes/Data/openAgent",
  );
});
