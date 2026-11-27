import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

// 审查回归:Gateway 同步给 WebUI 的审批标记是合成参数,只供审批栏读取,
// 不能进入工具调用的参数展示(toolCallArgsForDisplay 负责剔除 __ 合成键)。
// 本次新增的三个标记(allowSession/sessionScope/sessionWide)要和既有三个一样被剔除。
const loader = createTsModuleLoader();
const { buildGatewayToolCallPreviewArguments } = loader.loadModule(
  "src/pages/chat/turns/gatewayToolPreview.ts",
);
const { requestToolApproval, answerToolApproval } = loader.loadModule("src/lib/tools/toolApproval.ts");
const uiMessages = loader.loadModule("@liveagent/ui/lib/chat/uiMessages.ts");
const toolApprovalArgs = loader.loadModule("@liveagent/ui/lib/chat/toolApprovalArgs.ts");


const computerCall = {
  type: "toolCall",
  id: "computer-1",
  name: "computer_exec",
  arguments: { action: "call", tool: "click", args: { x: 10, y: 20 } },
};

async function withPendingApproval(approval, run) {
  const settled = requestToolApproval({
    toolCallId: computerCall.id,
    toolName: computerCall.name,
    conversationId: "review-display",
    ...approval,
  });
  try {
    return await run();
  } finally {
    answerToolApproval(computerCall.id, "approve");
    await settled;
  }
}

test("K-brain 会话级审批的三个新标记不得进入工具参数展示", async () => {
  await withPendingApproval(
    { summary: '{"action":"call","tool":"click"}', sessionScope: "call:click", sessionWide: true },
    () => {
      const synced = buildGatewayToolCallPreviewArguments(computerCall);
      // 生产者确实写入了新标记(否则下面的断言无意义)。
      assert.equal(synced[toolApprovalArgs.TOOL_APPROVAL_PENDING_ARG], true);
      assert.equal(synced[toolApprovalArgs.TOOL_APPROVAL_SESSION_WIDE_ARG], true);
      assert.equal(synced[toolApprovalArgs.TOOL_APPROVAL_SESSION_SCOPE_ARG], "call:click");
      assert.equal(synced[toolApprovalArgs.TOOL_APPROVAL_ALLOW_SESSION_ARG], false);

      const display = uiMessages.toolCallArgsForDisplay({ ...computerCall, arguments: synced });
      assert.deepEqual(
        Object.keys(display).filter((key) => key.startsWith("__toolApproval")),
        [],
        `合成审批标记泄漏进参数展示: ${JSON.stringify(display)}`,
      );
      assert.deepEqual(display, computerCall.arguments);
    },
  );
});


test("Gateway 同步标记的摘要沿用审批摘要上限(2000 字符)", async () => {
  // 旧实现经 summarizeToolCallForApproval 生成摘要,末尾统一截断到 2000 字符,
  // 注释写明目的是"防止同步标记载荷过大";改为优先使用登记摘要后要保持同一上限。
  // K-brain 的 AI 审查路径把完整工具参数 JSON 放进 command,写文件时可达数十 KB。
  const hugeSummary = `{"path":"notes.md","content":"${"x".repeat(50_000)}"}`;
  await withPendingApproval({ summary: hugeSummary, sessionScope: "call:click" }, () => {
    const synced = buildGatewayToolCallPreviewArguments(computerCall);
    const summary = synced[toolApprovalArgs.TOOL_APPROVAL_SUMMARY_ARG];
    assert.equal(typeof summary, "string");
    assert.ok(
      summary.length <= 2000,
      `同步摘要 ${summary.length} 字符,超过审批摘要上限 2000;每次重推都会把它推给 Gateway`,
    );
  });
});
