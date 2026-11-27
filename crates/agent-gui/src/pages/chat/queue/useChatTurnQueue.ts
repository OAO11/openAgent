import { invoke } from "@liveagent/app/shims/tauriCore";
import type {
  MentionComposerDraft,
  MentionComposerHandle,
} from "@liveagent/ui/components/chat/MentionComposer";
import { normalizeConversationMentionReferences } from "@liveagent/ui/lib/chat/mentionReferences";
import type { PendingUploadedFile } from "@liveagent/ui/lib/chat/uploadedFiles";
import type { ChatQueueTurnPreview } from "@liveagent/ui/pages/chat/ChatComposerBar";
import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import type { LiveTranscriptStore } from "../../../lib/chat/conversation/liveTranscriptStore";
import {
  type AppSettings,
  type ChatRuntimeControls,
  type CommandSafetyMode,
  type ExecutionMode,
  isAgentExecutionMode,
  normalizeChatRuntimeControls,
} from "../../../lib/settings";
import { createTextComposerDraft } from "../composer/composerDraftText";
import {
  type ConversationQueueStore,
  createConversationQueueStore,
} from "../conversations/conversationQueueStore";
import type { ActiveGatewayBridgeRequest, SendChatAction } from "../gateway/gatewayBridgeTypes";
import {
  type GatewayChatClaimedRequest,
  gatewayComposerTurnCommand,
  normalizeGatewayCommandSafetyMode,
  normalizeGatewayExecutionMode,
  normalizeGatewayWorkdir,
} from "../gateway/gatewayBridgeTypes";
import type { ConversationRuntimeEntry } from "../runtime/chatPageRuntime";
import type {
  ManualCompactionRequest,
  ManualCompactionResult,
} from "../runtime/useManualCompaction";
import {
  appendQueuedChatTurn,
  buildQueuedChatTurnPreview,
  createQueuedChatTurn,
  gatewayRequestAfterQueuedEdit,
  getQueuedConversationIds,
  insertQueuedChatTurnAtSlot,
  moveQueuedChatTurn,
  promoteQueuedChatTurn,
  type QueuedChatTurn,
  type QueuedChatTurnEditSlot,
  queuedChatTurnHasContent,
  removeQueuedChatTurn,
  resolveQueuedChatTurnSlotIndex,
  takeNextQueuedChatTurn,
} from "./chatTurnQueue";

// 比发送侧等待后端终止事件的上限（10 秒）稍长。
const PREVIOUS_RUN_SETTLE_WAIT_MS = 15_000;
const PREVIOUS_RUN_SETTLE_POLL_MS = 100;

type UseChatTurnQueueParams = {
  settings: AppSettings;
  currentConversationId: string;
  queueStore?: ConversationQueueStore;
  currentConversationIdRef: MutableRefObject<string>;
  conversationRuntimeCacheRef: MutableRefObject<Map<string, ConversationRuntimeEntry>>;
  buildRuntimeEntryFromVisibleState: () => ConversationRuntimeEntry;
  isConversationRunning: (conversationId: string) => boolean;
  runningConversationIds: ReadonlySet<string>;
  getConversationAbortController: (conversationId: string) => AbortController | null;
  setConversationAbortController: (
    conversationId: string,
    controller: AbortController | null,
  ) => void;
  setConversationSendingState: (conversationId: string, value: boolean) => void;
  requestConversationStop: (conversationId: string) => boolean;
  getConversationStopRequestVersion: (conversationId: string) => number;
  isConversationStopRequested: (conversationId: string) => boolean;
  consumeConversationStop: (conversationId: string, expectedVersion?: number) => boolean;
  /** 这一轮是否还在收尾：强制停止释放界面后，被停的一轮仍持有停止处理器直到结束。 */
  hasConversationStopHandler: (conversationId: string) => boolean;
  requestActiveConversationStop: (conversationId: string, options: { force: boolean }) => boolean;
  getConversationLiveTranscriptStore: (conversationId: string) => LiveTranscriptStore;
  captureAbortSnapshot: (store: LiveTranscriptStore) => void;
  updateToolStatus: (status: string | null, store: LiveTranscriptStore) => void;
  composerRef: MutableRefObject<MentionComposerHandle | null>;
  pendingUploadedFiles: PendingUploadedFile[];
  setPendingUploadsForConversation: (
    conversationId: string,
    uploads: PendingUploadedFile[],
  ) => void;
  clearCachedComposerDraft: (conversationId?: string) => void;
  displayedConversationWorkdir: string;
  sendActionRef: MutableRefObject<SendChatAction>;
  /** WebUI compact_now 中继：调 ChatPage 的手动压缩入口（与本地用量环同一代码）。 */
  manualCompactActionRef: MutableRefObject<
    (request?: ManualCompactionRequest) => Promise<ManualCompactionResult>
  >;
};

/**
 * The chat turn queue: local queued turns (enqueue while a run is active,
 * FIFO drain on run end, in-composer editing with slot restore), the WebUI
 * remote queue protocol (gateway:chat-queue-request actions incl. remote
 * edit sessions and AskUserQuestion answers), and queue snapshot publishing
 * back to the gateway.
 */
export function useChatTurnQueue(params: UseChatTurnQueueParams) {
  const {
    settings,
    currentConversationId,
    queueStore: providedQueueStore,
    currentConversationIdRef,
    conversationRuntimeCacheRef,
    buildRuntimeEntryFromVisibleState,
    isConversationRunning,
    runningConversationIds,
    getConversationAbortController,
    setConversationAbortController,
    setConversationSendingState,
    requestConversationStop,
    getConversationStopRequestVersion,
    isConversationStopRequested,
    consumeConversationStop,
    hasConversationStopHandler,
    requestActiveConversationStop,
    getConversationLiveTranscriptStore,
    captureAbortSnapshot,
    updateToolStatus,
    composerRef,
    pendingUploadedFiles,
    setPendingUploadsForConversation,
    clearCachedComposerDraft,
    displayedConversationWorkdir,
    sendActionRef,
  } = params;
  const fallbackQueueStoreRef = useRef<ConversationQueueStore | null>(null);
  if (!fallbackQueueStoreRef.current) {
    fallbackQueueStoreRef.current = createConversationQueueStore();
  }
  const queueStore = providedQueueStore ?? fallbackQueueStoreRef.current;

  const queuedChatTurnsRef = useRef<QueuedChatTurn[]>(queueStore.getAllSnapshot());
  const subscribeQueuedChatTurns = useCallback(
    (listener: () => void) =>
      queueStore.subscribeAll(() => {
        queuedChatTurnsRef.current = queueStore.getAllSnapshot();
        listener();
      }),
    [queueStore],
  );
  const getQueuedChatTurnsSnapshot = useCallback(() => queueStore.getAllSnapshot(), [queueStore]);
  const queuedChatTurns = useSyncExternalStore(
    subscribeQueuedChatTurns,
    getQueuedChatTurnsSnapshot,
    getQueuedChatTurnsSnapshot,
  );
  const queuedChatProcessingConversationIdsRef = useRef(new Set<string>());
  const queuedChatStopVersionsRef = useRef(new Map<string, number>());
  // 打断并执行的恢复意图：conversationId → 触发打断那一刻的 stop-request 版本号。
  // stopConversation 会打上 stop-requested 标记，而 drain effect 对该标记一律
  // "消费后跳过"（普通停止不允许自动放行队列）。登记版本号让 drain effect 能
  // 识别出"这次停止是打断并执行"，消费标记后继续自动发送；若用户随后又按了
  // 普通停止，版本号被 bump，登记的意图自动失效，队列保持挂起。
  const queuedChatInterruptResumeVersionsRef = useRef(new Map<string, number>());
  const queuedChatProcessingStatesRef = useRef(
    new Map<
      string,
      {
        stopVersion: number;
        stopRequestVersion: number | null;
        inFlightTurn: QueuedChatTurn | null;
      }
    >(),
  );
  const queuedChatTurnEditSlotRef = useRef<
    | (QueuedChatTurnEditSlot & {
        originalId: string;
        createdAt: number;
        executionMode: ExecutionMode;
        workdir: string;
        commandSafetyMode: CommandSafetyMode;
        runtimeControls: ChatRuntimeControls;
        gatewayRequest?: QueuedChatTurn["gatewayRequest"];
        /** 进入编辑时的正文；保存时据此判断 WebUI 指令语义是否还成立。 */
        originalText: string;
      })
    | null
  >(null);
  const chatQueueRevisionRef = useRef(0);
  const chatQueueKnownConversationIdsRef = useRef(new Set<string>());
  const previousRunningConversationIdsRef = useRef<ReadonlySet<string>>(new Set());

  function rememberChatQueueConversationId(conversationId: string) {
    const key = conversationId.trim();
    if (key) {
      chatQueueKnownConversationIdsRef.current.add(key);
    }
    return key;
  }

  function collectChatQueueSnapshotConversationIds(
    queue: readonly QueuedChatTurn[] = queuedChatTurnsRef.current,
    extraConversationIds: readonly string[] = [],
  ) {
    const conversationIds = new Set(chatQueueKnownConversationIdsRef.current);
    for (const item of queue) {
      const key = rememberChatQueueConversationId(item.conversationId);
      if (key) conversationIds.add(key);
    }
    for (const conversationId of extraConversationIds) {
      const key = rememberChatQueueConversationId(conversationId);
      if (key) conversationIds.add(key);
    }
    return conversationIds;
  }

  function cancelGatewayQueuedTurnRequest(item: QueuedChatTurn | null | undefined) {
    const gatewayRequest = item?.gatewayRequest;
    if (!item || !gatewayRequest) return;
    void invoke("gateway_chat_cancel_request", {
      request_id: gatewayRequest.requestId,
      conversation_id: item.conversationId,
      worker_id: gatewayRequest.workerId ?? "gui-queue",
    }).catch((error) => {
      console.warn("gateway_chat_cancel_request failed", error);
    });
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: Queue publication and the active conversation are read through stable stores/refs; queueStore is the callback ownership boundary.
  const setQueuedChatTurnsState = useCallback(
    (updater: (current: QueuedChatTurn[]) => QueuedChatTurn[]) => {
      const next = queueStore.update(updater);
      queuedChatTurnsRef.current = next;
      chatQueueRevisionRef.current += 1;
      return next;
    },
    [queueStore],
  );

  const queuedChatTurnsForCurrentConversation = useMemo<ChatQueueTurnPreview[]>(
    () =>
      queuedChatTurns
        .filter((item) => item.conversationId === currentConversationId)
        .map((item) => ({
          id: item.id,
          previewText: buildQueuedChatTurnPreview(item.draft),
          fileCount: item.uploadedFiles.length,
        })),
    [currentConversationId, queuedChatTurns],
  );

  function resolveStopConversationId() {
    // Stop only ever targets the conversation the user is looking at (or the
    // one the composer references). Never fall back to "any running
    // conversation" — that silently kills an unrelated background run when
    // the visible sending state and the running set are briefly out of sync.
    const visibleConversationId = currentConversationId.trim();
    if (visibleConversationId && runningConversationIds.has(visibleConversationId)) {
      return visibleConversationId;
    }
    const referencedConversationId = currentConversationIdRef.current.trim();
    if (referencedConversationId && runningConversationIds.has(referencedConversationId)) {
      return referencedConversationId;
    }
    return visibleConversationId || referencedConversationId;
  }

  function stopConversation(conversationId: string) {
    const targetConversationId = conversationId.trim();
    if (!targetConversationId) return false;
    const force = requestConversationStop(targetConversationId);
    const stopRequestVersion = getConversationStopRequestVersion(targetConversationId);
    const nextStopVersion = (queuedChatStopVersionsRef.current.get(targetConversationId) ?? 0) + 1;
    queuedChatStopVersionsRef.current.set(targetConversationId, nextStopVersion);
    const processingState = queuedChatProcessingStatesRef.current.get(targetConversationId);
    if (processingState) {
      processingState.stopRequestVersion = stopRequestVersion;
      cancelGatewayQueuedTurnRequest(processingState.inFlightTurn);
    }
    const controller = getConversationAbortController(targetConversationId);
    const transcriptStore = getConversationLiveTranscriptStore(targetConversationId);
    if (controller) {
      captureAbortSnapshot(transcriptStore);
      updateToolStatus("正在停止当前任务...", transcriptStore);
      controller.abort();
    }
    const handled = requestActiveConversationStop(targetConversationId, { force });
    if (force) {
      queuedChatProcessingConversationIdsRef.current.delete(targetConversationId);
      setConversationAbortController(targetConversationId, null);
      setConversationSendingState(targetConversationId, false);
      updateToolStatus(null, transcriptStore);
    }
    return handled || Boolean(controller);
  }

  function stopSending() {
    const conversationId = resolveStopConversationId();
    if (!conversationId) return;
    const nextQueuedTurn = queuedChatTurnsRef.current.find(
      (item) => item.conversationId === conversationId,
    );
    if (nextQueuedTurn) {
      // Composer Stop is stop-and-continue when this conversation already
      // has queued work; runQueuedTurnNow records the resume intent before
      // aborting the current run.
      runQueuedTurnNow(nextQueuedTurn.id);
      return;
    }
    stopConversation(conversationId);
  }

  function clearCurrentComposerDraftForQueuedTurn(conversationId: string) {
    const targetConversationId = conversationId.trim();
    if (!targetConversationId || currentConversationIdRef.current !== targetConversationId) {
      return;
    }
    composerRef.current?.clear();
    setPendingUploadsForConversation(targetConversationId, []);
    clearCachedComposerDraft(targetConversationId);
  }

  function enqueueCurrentComposerTurn(position: "end" | "edit") {
    const conversationId = currentConversationIdRef.current.trim();
    const draft = composerRef.current?.getDraft() ?? null;
    const uploadedFiles = pendingUploadedFiles.slice();
    if (!conversationId || !queuedChatTurnHasContent(draft, uploadedFiles)) {
      return false;
    }

    const runtimeEntry =
      conversationRuntimeCacheRef.current.get(conversationId) ??
      buildRuntimeEntryFromVisibleState();
    const editSlot =
      position === "edit" && queuedChatTurnEditSlotRef.current?.conversationId === conversationId
        ? queuedChatTurnEditSlotRef.current
        : null;
    const executionMode = editSlot?.executionMode ?? settings.system.executionMode;
    const commandSafetyMode = editSlot?.commandSafetyMode ?? settings.system.commandSafetyMode;
    const workdirForTurn = isAgentExecutionMode(executionMode)
      ? (
          editSlot?.workdir ??
          runtimeEntry.workdir ??
          displayedConversationWorkdir ??
          settings.system.workdir
        ).trim()
      : "";
    const queuedTurn = createQueuedChatTurn({
      id: editSlot?.originalId,
      conversationId,
      draft,
      uploadedFiles,
      executionMode,
      workdir: workdirForTurn,
      commandSafetyMode,
      runtimeControls: editSlot?.runtimeControls ?? settings.chatRuntimeControls,
      createdAt: editSlot?.createdAt,
      gatewayRequest: editSlot
        ? gatewayRequestAfterQueuedEdit(
            editSlot.gatewayRequest,
            editSlot.originalText,
            draft?.text ?? "",
          )
        : undefined,
    });

    setQueuedChatTurnsState((current) => {
      if (editSlot) {
        return insertQueuedChatTurnAtSlot(current, queuedTurn, editSlot);
      }
      return appendQueuedChatTurn(current, queuedTurn);
    });
    if (editSlot) {
      queuedChatTurnEditSlotRef.current = null;
    }
    clearCurrentComposerDraftForQueuedTurn(conversationId);
    return true;
  }

  /**
   * Enqueue a composer turn for an explicit conversation (workbench panes
   * sending into a busy background conversation). Unlike the current-composer
   * path it never touches the page composer or edit slots; the caller owns
   * clearing its own composer. The turn's workdir comes from the target
   * conversation's runtime entry, never from the visible conversation.
   */
  function enqueueComposerTurnForConversation(input: {
    conversationId: string;
    draft: MentionComposerDraft | null;
    uploadedFiles: PendingUploadedFile[];
    /** 覆盖入队 turn 的运行时控制;缺省取当前 settings 快照。计划批准的续轮
     * 用它显式带 planModeEnabled:false——不能依赖 setSettings 后的闭包新鲜度。 */
    runtimeControls?: ChatRuntimeControls;
  }) {
    const conversationId = input.conversationId.trim();
    const uploadedFiles = input.uploadedFiles.slice();
    if (!conversationId || !queuedChatTurnHasContent(input.draft, uploadedFiles)) {
      return false;
    }
    const runtimeEntry =
      conversationRuntimeCacheRef.current.get(conversationId) ??
      (conversationId === currentConversationIdRef.current
        ? buildRuntimeEntryFromVisibleState()
        : null);
    const executionMode = settings.system.executionMode;
    const workdirForTurn = isAgentExecutionMode(executionMode)
      ? (
          runtimeEntry?.workdir ??
          (conversationId === currentConversationIdRef.current
            ? displayedConversationWorkdir
            : settings.system.workdir)
        ).trim()
      : "";
    const queuedTurn = createQueuedChatTurn({
      conversationId,
      draft: input.draft,
      uploadedFiles,
      executionMode,
      workdir: workdirForTurn,
      commandSafetyMode: settings.system.commandSafetyMode,
      runtimeControls: input.runtimeControls ?? settings.chatRuntimeControls,
    });
    setQueuedChatTurnsState((current) => appendQueuedChatTurn(current, queuedTurn));
    setPendingUploadsForConversation(conversationId, []);
    clearCachedComposerDraft(conversationId);
    return true;
  }

  function isQueuedChatTurnEditBlockingProcessing(conversationId: string) {
    const slot = queuedChatTurnEditSlotRef.current;
    if (!slot || slot.conversationId !== conversationId.trim()) return false;
    const queue = queuedChatTurnsRef.current;
    const firstQueuedIndex = queue.findIndex((item) => item.conversationId === slot.conversationId);
    if (firstQueuedIndex < 0) return false;
    return resolveQueuedChatTurnSlotIndex(queue, slot) <= firstQueuedIndex;
  }

  /**
   * 强制停止会先释放界面，被停的那一轮仍在收尾（等后端终止事件、回写历史），
   * 它和下一轮共用同一份实时转写。等它真正结束再发下一条；用户再次停止或已有
   * 新一轮开始时放弃，返回 false。超时后照常发送，后端仍忙时由发送侧重试。
   */
  async function waitForPreviousRunToFinish(conversationId: string, stopped: () => boolean) {
    const deadline = Date.now() + PREVIOUS_RUN_SETTLE_WAIT_MS;
    while (hasConversationStopHandler(conversationId) && Date.now() < deadline) {
      if (stopped() || isConversationRunning(conversationId)) return false;
      await new Promise((resolve) => setTimeout(resolve, PREVIOUS_RUN_SETTLE_POLL_MS));
    }
    return !stopped() && !isConversationRunning(conversationId);
  }

  function requestQueuedChatTurnProcessing(conversationId: string) {
    const targetConversationId = conversationId.trim();
    if (!targetConversationId) return;
    if (isConversationStopRequested(targetConversationId)) {
      queuedChatProcessingConversationIdsRef.current.delete(targetConversationId);
      const stopRequestVersion = getConversationStopRequestVersion(targetConversationId);
      consumeConversationStop(targetConversationId, stopRequestVersion);
      return;
    }
    if (queuedChatProcessingConversationIdsRef.current.has(targetConversationId)) return;
    if (isConversationRunning(targetConversationId)) return;
    if (isQueuedChatTurnEditBlockingProcessing(targetConversationId)) return;
    if (!queuedChatTurnsRef.current.some((item) => item.conversationId === targetConversationId)) {
      return;
    }

    queuedChatProcessingConversationIdsRef.current.add(targetConversationId);
    const processingState = {
      stopVersion: queuedChatStopVersionsRef.current.get(targetConversationId) ?? 0,
      stopRequestVersion: null as number | null,
      inFlightTurn: null as QueuedChatTurn | null,
    };
    queuedChatProcessingStatesRef.current.set(targetConversationId, processingState);
    const wasStoppedDuringProcessing = () =>
      (queuedChatStopVersionsRef.current.get(targetConversationId) ?? 0) !==
      processingState.stopVersion;
    const releaseProcessingState = () => {
      if (queuedChatProcessingStatesRef.current.get(targetConversationId) !== processingState) {
        return;
      }
      queuedChatProcessingStatesRef.current.delete(targetConversationId);
      queuedChatProcessingConversationIdsRef.current.delete(targetConversationId);
    };
    let inFlightQueuedTurn: QueuedChatTurn | null = null;
    void Promise.resolve()
      .then(async () => {
        if (isConversationStopRequested(targetConversationId)) return false;
        if (isConversationRunning(targetConversationId)) return;
        if (!(await waitForPreviousRunToFinish(targetConversationId, wasStoppedDuringProcessing))) {
          return false;
        }
        if (isConversationStopRequested(targetConversationId)) return false;
        // 等待期间用户可能打开了队首的编辑；和进入处理时一样挡住，提交编辑时会重新触发。
        if (isQueuedChatTurnEditBlockingProcessing(targetConversationId)) return false;
        const taken = takeNextQueuedChatTurn(queuedChatTurnsRef.current, targetConversationId);
        if (!taken.item) return false;
        const queuedTurn = taken.item;
        inFlightQueuedTurn = queuedTurn;
        processingState.inFlightTurn = queuedTurn;
        setQueuedChatTurnsState(() => taken.queue);
        const gatewayRequest = queuedTurn.gatewayRequest;
        const gatewayWorkerId = gatewayRequest?.workerId?.trim() || "gui-queue";
        const gatewayBridgeRequest: ActiveGatewayBridgeRequest | null = gatewayRequest
          ? {
              requestId: gatewayRequest.requestId,
              conversationId: targetConversationId,
              clientRequestId: gatewayRequest.clientRequestId,
              workerId: gatewayWorkerId,
              startedAt: Date.now(),
              selectedModelOverride: gatewayRequest.selectedModel,
              runtimeControlsOverride: gatewayRequest.runtimeControls
                ? normalizeChatRuntimeControls(gatewayRequest.runtimeControls)
                : queuedTurn.runtimeControls,
              executionModeOverride: queuedTurn.executionMode,
              workdirOverride: queuedTurn.workdir,
              commandSafetyModeOverride: queuedTurn.commandSafetyMode,
            }
          : null;
        const markGatewayStarted =
          gatewayRequest && gatewayBridgeRequest
            ? async () => {
                await invoke("gateway_chat_mark_started", {
                  request_id: gatewayRequest.requestId,
                  conversation_id: targetConversationId,
                  worker_id: gatewayWorkerId,
                });
              }
            : undefined;
        const accepted = await sendActionRef.current({
          composerDraftOverride: queuedTurn.draft,
          uploadedFilesOverride: queuedTurn.uploadedFiles,
          conversationIdOverride: targetConversationId,
          executionModeOverride: queuedTurn.executionMode,
          workdirOverride: queuedTurn.workdir,
          commandSafetyModeOverride: queuedTurn.commandSafetyMode,
          runtimeControlsOverride: queuedTurn.runtimeControls,
          ...(gatewayRequest?.composerCommand
            ? { composerCommand: gatewayRequest.composerCommand }
            : {}),
          gatewayBridgeRequestOverride: gatewayBridgeRequest,
          preserveComposerOnStart: true,
          beforeRuntimeStart: markGatewayStarted,
          afterInitialHistoryPersist: markGatewayStarted,
        });
        const stopped = wasStoppedDuringProcessing();
        if (!accepted) {
          if (stopped && gatewayRequest) {
            cancelGatewayQueuedTurnRequest(queuedTurn);
          } else {
            setQueuedChatTurnsState((current) =>
              promoteQueuedChatTurn(appendQueuedChatTurn(current, queuedTurn), queuedTurn.id),
            );
          }
          inFlightQueuedTurn = null;
        } else if (gatewayRequest) {
          if (stopped) {
            cancelGatewayQueuedTurnRequest(queuedTurn);
          } else {
            void invoke("gateway_chat_complete", {
              request_id: gatewayRequest.requestId,
              conversation_id: targetConversationId,
              worker_id: gatewayWorkerId,
            }).catch((error) => {
              console.warn("gateway_chat_complete failed", error);
            });
          }
        }
        processingState.inFlightTurn = null;
        return accepted;
      })
      .then((accepted) => {
        releaseProcessingState();
        if (wasStoppedDuringProcessing() || isConversationStopRequested(targetConversationId)) {
          if (processingState.stopRequestVersion !== null) {
            consumeConversationStop(targetConversationId, processingState.stopRequestVersion);
          }
          return;
        }
        if (
          accepted &&
          !isConversationRunning(targetConversationId) &&
          queuedChatTurnsRef.current.some((item) => item.conversationId === targetConversationId)
        ) {
          requestQueuedChatTurnProcessing(targetConversationId);
        }
      })
      .catch(() => {
        const failedQueuedTurn = inFlightQueuedTurn;
        if (failedQueuedTurn) {
          if (wasStoppedDuringProcessing() && failedQueuedTurn.gatewayRequest) {
            cancelGatewayQueuedTurnRequest(failedQueuedTurn);
          } else {
            setQueuedChatTurnsState((current) =>
              promoteQueuedChatTurn(
                appendQueuedChatTurn(current, failedQueuedTurn),
                failedQueuedTurn.id,
              ),
            );
          }
          inFlightQueuedTurn = null;
        }
        processingState.inFlightTurn = null;
        releaseProcessingState();
        if (isConversationStopRequested(targetConversationId)) {
          if (processingState.stopRequestVersion !== null) {
            consumeConversationStop(targetConversationId, processingState.stopRequestVersion);
          }
        }
      });
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: Running-set transitions are the only trigger; the queue is sampled from its ref and helpers are evaluated from this render.
  useEffect(() => {
    const previousRunningConversationIds = previousRunningConversationIdsRef.current;
    previousRunningConversationIdsRef.current = runningConversationIds;
    for (const conversationId of getQueuedConversationIds(queuedChatTurnsRef.current)) {
      if (
        !previousRunningConversationIds.has(conversationId) ||
        runningConversationIds.has(conversationId)
      ) {
        continue;
      }
      const interruptResumeVersion =
        queuedChatInterruptResumeVersionsRef.current.get(conversationId);
      queuedChatInterruptResumeVersionsRef.current.delete(conversationId);
      if (isConversationStopRequested(conversationId)) {
        queuedChatProcessingConversationIdsRef.current.delete(conversationId);
        const stopRequestVersion = getConversationStopRequestVersion(conversationId);
        consumeConversationStop(conversationId, stopRequestVersion);
        // 打断并执行：这次停止就是为了立刻放行队首轮次，消费掉 stop 标记后
        // 继续向下触发处理；版本号不匹配说明打断之后用户又请求过停止，尊重
        // 最新意图，保持队列挂起。
        if (interruptResumeVersion !== stopRequestVersion) {
          continue;
        }
      }
      requestQueuedChatTurnProcessing(conversationId);
    }
  }, [runningConversationIds, queuedChatTurns]);

  function runQueuedTurnNow(id: string) {
    const queuedTurn = queuedChatTurnsRef.current.find((item) => item.id === id.trim());
    if (!queuedTurn) return;
    setQueuedChatTurnsState((current) => promoteQueuedChatTurn(current, queuedTurn.id));
    if (isConversationRunning(queuedTurn.conversationId)) {
      stopConversation(queuedTurn.conversationId);
      // 登记恢复意图（须在 stopConversation bump 版本号之后取值），运行结束后
      // drain effect 据此消费 stop 标记并自动发送刚置顶的轮次。
      queuedChatInterruptResumeVersionsRef.current.set(
        queuedTurn.conversationId,
        getConversationStopRequestVersion(queuedTurn.conversationId),
      );
      return;
    }
    requestQueuedChatTurnProcessing(queuedTurn.conversationId);
  }

  function moveQueuedTurnUp(id: string) {
    setQueuedChatTurnsState((current) => moveQueuedChatTurn(current, id, "up"));
  }

  function editQueuedTurn(id: string) {
    const key = id.trim();
    const queuedTurnIndex = queuedChatTurnsRef.current.findIndex((item) => item.id === key);
    const queuedTurn = queuedTurnIndex >= 0 ? queuedChatTurnsRef.current[queuedTurnIndex] : null;
    if (!queuedTurn) return;
    const targetConversationId = queuedTurn.conversationId.trim();
    if (!targetConversationId || currentConversationIdRef.current.trim() !== targetConversationId) {
      return;
    }

    const currentDraft = composerRef.current?.getDraft() ?? null;
    const currentUploads = pendingUploadedFiles.slice();
    if (queuedChatTurnHasContent(currentDraft, currentUploads)) {
      enqueueCurrentComposerTurn(queuedChatTurnEditSlotRef.current ? "edit" : "end");
    }

    const sameConversationQueue = queuedChatTurnsRef.current.filter(
      (item) => item.conversationId === targetConversationId,
    );
    const sameConversationIndex = sameConversationQueue.findIndex((item) => item.id === key);
    const previousId =
      sameConversationIndex > 0
        ? (sameConversationQueue[sameConversationIndex - 1]?.id ?? null)
        : null;
    const nextId =
      sameConversationIndex >= 0
        ? (sameConversationQueue[sameConversationIndex + 1]?.id ?? null)
        : null;
    queuedChatTurnEditSlotRef.current = {
      conversationId: targetConversationId,
      previousId,
      nextId,
      index: sameConversationIndex >= 0 ? sameConversationIndex : undefined,
      originalId: queuedTurn.id,
      createdAt: queuedTurn.createdAt,
      executionMode: queuedTurn.executionMode,
      workdir: queuedTurn.workdir,
      commandSafetyMode: queuedTurn.commandSafetyMode,
      runtimeControls: { ...queuedTurn.runtimeControls },
      gatewayRequest: queuedTurn.gatewayRequest ? { ...queuedTurn.gatewayRequest } : undefined,
      originalText: queuedTurn.draft.text,
    };
    setQueuedChatTurnsState((current) => removeQueuedChatTurn(current, key));
    composerRef.current?.setDraft(queuedTurn.draft);
    setPendingUploadsForConversation(targetConversationId, queuedTurn.uploadedFiles);
    clearCachedComposerDraft(targetConversationId);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  function removeQueuedTurn(id: string) {
    const queuedTurn = queuedChatTurnsRef.current.find((item) => item.id === id.trim());
    setQueuedChatTurnsState((current) => removeQueuedChatTurn(current, id));
    cancelGatewayQueuedTurnRequest(queuedTurn);
  }

  function shouldQueueGatewayChatRequest(
    conversationId: string,
    queuePolicy: "auto" | "append" | "interrupt",
  ) {
    const key = conversationId.trim();
    if (!key) return false;
    return (
      queuePolicy === "append" ||
      queuePolicy === "interrupt" ||
      queuedChatTurnsRef.current.some((item) => item.conversationId === key) ||
      isQueuedChatTurnEditBlockingProcessing(key)
    );
  }

  async function enqueueGatewayChatRequest(
    claimed: GatewayChatClaimedRequest,
    conversationId: string,
  ) {
    const payload = claimed.request;
    const requestId = payload.requestId.trim();
    const targetConversationId = conversationId.trim();
    const message = payload.message ?? "";
    const uploadedFiles = Array.isArray(payload.uploadedFiles) ? payload.uploadedFiles : [];
    if (!requestId || !targetConversationId || (!message.trim() && uploadedFiles.length === 0)) {
      return false;
    }

    const executionMode =
      normalizeGatewayExecutionMode(payload.executionMode) ?? settings.system.executionMode;
    const commandSafetyMode =
      normalizeGatewayCommandSafetyMode(payload.commandSafetyMode) ??
      settings.system.commandSafetyMode;
    const workdir =
      normalizeGatewayWorkdir(payload.workdir) ??
      conversationRuntimeCacheRef.current.get(targetConversationId)?.workdir ??
      displayedConversationWorkdir ??
      settings.system.workdir;
    const runtimeControls = payload.runtimeControls
      ? normalizeChatRuntimeControls(payload.runtimeControls)
      : settings.chatRuntimeControls;
    // 排队的 WebUI 轮次同样要带上“/”指令语义（goal set/resume、提示词指令）。
    const composerCommand = gatewayComposerTurnCommand(payload);
    if (composerCommand === null) return false;
    const queuedTurn = createQueuedChatTurn({
      id: `gateway-${requestId}`,
      conversationId: targetConversationId,
      draft: createTextComposerDraft(
        message,
        normalizeConversationMentionReferences(
          payload.referencedConversations,
          targetConversationId,
        ),
      ),
      uploadedFiles,
      executionMode,
      workdir: isAgentExecutionMode(executionMode) ? workdir : "",
      commandSafetyMode,
      runtimeControls,
      gatewayRequest: {
        requestId,
        clientRequestId:
          payload.clientRequestId?.trim() || claimed.clientRequestId?.trim() || undefined,
        workerId: "gui-queue",
        queuePolicy:
          payload.queuePolicy === "append" || payload.queuePolicy === "interrupt"
            ? payload.queuePolicy
            : "auto",
        selectedModel: payload.selectedModel,
        runtimeControls: payload.runtimeControls,
        ...(composerCommand ? { composerCommand } : {}),
      },
    });

    setQueuedChatTurnsState((current) => appendQueuedChatTurn(current, queuedTurn));
    if (payload.queuePolicy === "interrupt") {
      // 与本地"打断并执行"共用同一路径：置顶 + 运行中则打断并登记恢复意图；
      // 空闲则直接触发队列处理（此前空闲时也会打 stop 标记且无人消费，
      // 导致该轮次永远挂起）。
      runQueuedTurnNow(queuedTurn.id);
    }
    return true;
  }

  return {
    queuedChatTurnsRef,
    queuedChatTurnEditSlotRef,
    setQueuedChatTurnsState,
    queuedChatTurnsForCurrentConversation,
    collectChatQueueSnapshotConversationIds,
    stopConversation,
    stopSending,
    enqueueCurrentComposerTurn,
    enqueueComposerTurnForConversation,
    requestQueuedChatTurnProcessing,
    runQueuedTurnNow,
    moveQueuedTurnUp,
    editQueuedTurn,
    removeQueuedTurn,
    shouldQueueGatewayChatRequest,
    enqueueGatewayChatRequest,
  };
}
