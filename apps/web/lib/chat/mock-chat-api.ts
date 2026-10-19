import type {
  ChatApi,
  ChatMessage,
  ChatSource,
  ChatStreamEvent,
  Conversation,
  ConversationSummary,
  PipelineStage,
  RefusalReason,
  RunDetails,
  StageTiming,
} from "@repo/api-client";

/* In-browser stand-in for the chat backend so the UI can be built before the query pipeline exists. */

interface KnowledgeTopic {
  keywords: string[];
  answer: string;
  sources: Omit<ChatSource, "index" | "cited">[];
}

const TOPICS: KnowledgeTopic[] = [
  {
    keywords: ["incident", "escalat", "sev", "outage", "page"],
    answer:
      "Incidents are classified by customer impact. A **SEV1** (full outage or data loss) pages the on-call engineer immediately and requires an incident commander within 15 minutes [Source 1].\n\nEscalation path:\n- On-call engineer acknowledges within 5 minutes [Source 1]\n- If unresolved after 30 minutes, escalate to the team lead and open a war-room channel [Source 2]\n- Customer-facing status updates go out every 30 minutes until resolved [Source 2]\n\nA blameless postmortem is due within 5 business days of any SEV1 or SEV2 [Source 3].",
    sources: [
      {
        chunkId: "chk-inc-01",
        documentId: "doc-incident-runbook",
        documentVersion: 4,
        documentTitle: "Incident Response Runbook",
        sourceType: "notion",
        sourceUrl: "https://www.notion.so/incident-response-runbook",
        sectionHeaders: ["Incident Response Runbook", "Severity Levels"],
        snippet:
          "SEV1: complete outage or confirmed data loss. Page the on-call engineer immediately; an incident commander must be assigned within 15 minutes. On-call acknowledges within 5 minutes.",
        score: 0.89,
      },
      {
        chunkId: "chk-inc-02",
        documentId: "doc-incident-runbook",
        documentVersion: 4,
        documentTitle: "Incident Response Runbook",
        sourceType: "notion",
        sourceUrl: "https://www.notion.so/incident-response-runbook",
        sectionHeaders: ["Incident Response Runbook", "Escalation"],
        snippet:
          "If the incident is not mitigated within 30 minutes, escalate to the team lead and open a dedicated war-room channel. Post customer status updates every 30 minutes.",
        score: 0.84,
      },
      {
        chunkId: "chk-pm-01",
        documentId: "doc-postmortem-policy",
        documentVersion: 2,
        documentTitle: "Postmortem Policy",
        sourceType: "upload",
        sectionHeaders: ["Postmortem Policy", "Deadlines"],
        snippet:
          "A blameless postmortem document is required for every SEV1 and SEV2 incident and must be published within 5 business days.",
        score: 0.71,
      },
    ],
  },
  {
    keywords: ["rollback", "roll back", "deploy", "release", "revert"],
    answer:
      "Roll back by redeploying the previous release tag through the deploy pipeline rather than reverting commits on main [Source 1]. Database migrations must be backward compatible for one release so a rollback never needs a down-migration [Source 2].\n\nIf the rollback itself fails, freeze deploys and follow the incident process [Source 1].",
    sources: [
      {
        chunkId: "chk-dep-01",
        documentId: "doc-deploy-guide",
        documentVersion: 7,
        documentTitle: "Deployment Guide",
        sourceType: "confluence",
        sourceUrl: "https://confluence.example.com/deploy-guide",
        sectionHeaders: ["Deployment Guide", "Rollbacks"],
        snippet:
          "To roll back, trigger the deploy pipeline with the previous release tag. Do not revert commits on main to roll back production. If a rollback fails, freeze deploys and open an incident.",
        score: 0.87,
      },
      {
        chunkId: "chk-adr-07",
        documentId: "doc-adr-007",
        documentVersion: 1,
        documentTitle: "ADR-007: Expand/Contract Migrations",
        sourceType: "text",
        sectionHeaders: ["ADR-007", "Decision"],
        snippet:
          "All schema changes follow expand/contract. Each migration must stay compatible with the previous application release so rollbacks never require down-migrations.",
        score: 0.76,
      },
    ],
  },
  {
    keywords: ["vector", "pgvector", "database", "postgres", "adr", "embedding"],
    answer:
      "We chose **PostgreSQL with pgvector** over a dedicated vector database so documents, chunks, and embeddings live in one ACID store and can be replaced in a single transaction [Source 1]. A dedicated store was rejected because it adds another system to operate for a corpus that fits comfortably in Postgres [Source 1].\n\nEmbeddings come from a local model by default, and the provider is swappable [Source 2].",
    sources: [
      {
        chunkId: "chk-adr-03",
        documentId: "doc-adr-003",
        documentVersion: 3,
        documentTitle: "ADR-003: Vector Storage",
        sourceType: "text",
        sectionHeaders: ["ADR-003", "Decision"],
        snippet:
          "Use PostgreSQL 16 with pgvector. Chunks and embeddings are replaced atomically with the document version. A dedicated vector database was rejected: extra operational cost for a corpus well under 10M vectors.",
        score: 0.91,
      },
      {
        chunkId: "chk-emb-01",
        documentId: "doc-architecture",
        documentVersion: 5,
        documentTitle: "Knowledge Engine Architecture",
        sourceType: "upload",
        sectionHeaders: ["Architecture", "Embedding Providers"],
        snippet:
          "Embeddings default to a local Ollama model (nomic-embed-text, 768 dimensions). Providers implement a common interface so a remote GPU or hosted API can be swapped in.",
        score: 0.73,
      },
    ],
  },
  {
    keywords: ["leave", "pto", "vacation", "holiday", "on-call", "oncall"],
    answer:
      "Engineers on the on-call rotation must arrange a swap at least one week before planned leave and record it in the rotation calendar [Source 1]. PTO requests longer than 5 days need manager approval two weeks in advance [Source 2].",
    sources: [
      {
        chunkId: "chk-oc-01",
        documentId: "doc-oncall-policy",
        documentVersion: 2,
        documentTitle: "On-call Policy",
        sourceType: "notion",
        sourceUrl: "https://www.notion.so/on-call-policy",
        sectionHeaders: ["On-call Policy", "Swaps"],
        snippet:
          "Rotation swaps for planned leave must be agreed at least one week in advance and recorded in the shared rotation calendar.",
        score: 0.82,
      },
      {
        chunkId: "chk-pto-01",
        documentId: "doc-pto-policy",
        documentVersion: 1,
        documentTitle: "Time Off Policy",
        sourceType: "upload",
        sectionHeaders: ["Time Off Policy", "Approval"],
        snippet:
          "Requests longer than 5 consecutive working days require manager approval at least two weeks before the first day of leave.",
        score: 0.69,
      },
    ],
  },
];

const OUT_OF_SCOPE = ["weather", "recipe", "joke", "poem", "stock price", "football"];

const REFUSAL_TEXT: Record<RefusalReason, string> = {
  insufficient_evidence:
    "I couldn't find enough evidence in the knowledge base to answer this. Try rephrasing, or check that the relevant document has been ingested.",
  out_of_scope:
    "That question is outside what this assistant covers. I can only answer questions about internal engineering docs, incidents, and company policies.",
  unverifiable_citations:
    "I drafted an answer but couldn't verify its citations against the retrieved documents, so I'm not showing it.",
};

const STAGE_DURATIONS: Record<PipelineStage, number> = {
  rewrite: 180,
  embed: 120,
  retrieve: 260,
  rerank: 140,
  select: 60,
  generate: 0,
  verify: 90,
};

const conversations = new Map<string, Conversation>();
let idCounter = 0;

function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

/* Resolves after `ms`, or rejects with AbortError as soon as the signal fires. */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function findTopic(question: string): KnowledgeTopic | undefined {
  const q = question.toLowerCase();
  return TOPICS.find((topic) => topic.keywords.some((k) => q.includes(k)));
}

function toSources(topic: KnowledgeTopic): ChatSource[] {
  return topic.sources.map((s, i) => ({ ...s, index: i + 1, cited: true }));
}

function citedIndexes(text: string): number[] {
  return [...new Set([...text.matchAll(/\[Source (\d+)\]/g)].map((m) => Number(m[1])))];
}

function summarize(conversation: Conversation): ConversationSummary {
  const last = conversation.messages[conversation.messages.length - 1];
  return {
    id: conversation.id,
    title: conversation.title,
    lastMessagePreview: last ? last.content.replace(/\s+/g, " ").slice(0, 90) : "",
    messageCount: conversation.messages.length,
    updatedAt: conversation.updatedAt,
  };
}

function buildRun(traceId: string, stages: StageTiming[], sources: ChatSource[], answer: string): RunDetails {
  const contextTokens = sources.reduce((sum, s) => sum + Math.ceil(s.snippet.length / 4), 0);
  return {
    traceId,
    model: "llama3.1:8b",
    embeddingModel: "nomic-embed-text",
    candidatesRetrieved: sources.length > 0 ? 24 : 0,
    contextTokens,
    promptTokens: contextTokens + 420,
    completionTokens: Math.ceil(answer.length / 4),
    totalLatencyMs: stages.reduce((sum, s) => sum + s.durationMs, 0),
    stages,
  };
}

/* Seeds two finished conversations so the history list and resume flow have something to show. */
function seed(): void {
  const seeds = [
    { question: "What is our incident escalation process for a SEV1?", hoursAgo: 2 },
    { question: "Why did we choose pgvector instead of a vector database?", hoursAgo: 30 },
  ];

  for (const { question, hoursAgo } of seeds) {
    const topic = findTopic(question)!;
    const sources = toSources(topic);
    const at = new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
    const traceId = newId("trace");
    const stages = (Object.keys(STAGE_DURATIONS) as PipelineStage[]).map((stage) => ({
      stage,
      durationMs: stage === "generate" ? 1840 : STAGE_DURATIONS[stage],
    }));
    const id = newId("conv");
    conversations.set(id, {
      id,
      title: question.slice(0, 60),
      createdAt: at,
      updatedAt: at,
      messages: [
        { id: newId("msg"), role: "user", content: question, createdAt: at },
        {
          id: newId("msg"),
          role: "assistant",
          content: topic.answer,
          createdAt: at,
          outcome: "answered",
          sources,
          run: buildRun(traceId, stages, sources, topic.answer),
        },
      ],
    });
  }
}

seed();

export const mockChatApi: ChatApi = {
  async listConversations() {
    await wait(250);
    return [...conversations.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(summarize);
  },

  async getConversation(id) {
    await wait(200);
    const conversation = conversations.get(id);
    if (!conversation) {
      throw new Error("Conversation not found");
    }
    return structuredClone(conversation);
  },

  async deleteConversation(id) {
    await wait(150);
    conversations.delete(id);
  },

  /* Simulates the pipeline: "fail" triggers an error, off-topic words refuse, unknown topics lack evidence. */
  async sendMessage(conversationId, { message }, { signal, onEvent }) {
    const now = new Date().toISOString();
    const existing = conversationId ? conversations.get(conversationId) : undefined;
    const conversation: Conversation = existing ?? {
      id: newId("conv"),
      title: message.slice(0, 60),
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    conversations.set(conversation.id, conversation);

    const userMessage: ChatMessage = { id: newId("msg"), role: "user", content: message, createdAt: now };
    conversation.messages.push(userMessage);
    conversation.updatedAt = now;

    const traceId = newId("trace");
    const assistantId = newId("msg");
    const emit = (event: ChatStreamEvent) => onEvent(event);
    emit({
      type: "meta",
      conversationId: conversation.id,
      userMessageId: userMessage.id,
      assistantMessageId: assistantId,
      traceId,
      conversationTitle: conversation.title,
    });

    const stages: StageTiming[] = [];
    const runStage = async (stage: PipelineStage, durationMs = STAGE_DURATIONS[stage]) => {
      emit({ type: "stage", stage, status: "started" });
      await wait(durationMs, signal);
      stages.push({ stage, durationMs });
      emit({ type: "stage", stage, status: "completed", durationMs });
    };

    const finish = (content: string, sources: ChatSource[], refusalReason?: RefusalReason) => {
      /* Refusals are delivered as tokens too, so every outcome renders through the same path */
      if (refusalReason) {
        emit({ type: "token", delta: content });
      }
      const run = buildRun(traceId, stages, sources, content);
      conversation.messages.push({
        id: assistantId,
        role: "assistant",
        content,
        createdAt: new Date().toISOString(),
        outcome: refusalReason ? "refused" : "answered",
        refusalReason,
        sources,
        run,
      });
      conversation.updatedAt = new Date().toISOString();
      emit({
        type: "done",
        outcome: refusalReason ? "refused" : "answered",
        refusalReason,
        citedIndexes: citedIndexes(content),
        run,
      });
    };

    const lower = message.toLowerCase();
    if (OUT_OF_SCOPE.some((word) => lower.includes(word))) {
      await runStage("rewrite");
      finish(REFUSAL_TEXT.out_of_scope, [], "out_of_scope");
      return;
    }

    if (conversation.messages.length > 1) {
      await runStage("rewrite");
    }
    await runStage("embed");
    await runStage("retrieve");

    const topic = findTopic(message);
    if (!topic) {
      finish(REFUSAL_TEXT.insufficient_evidence, [], "insufficient_evidence");
      return;
    }

    await runStage("rerank");
    await runStage("select");
    const sources = toSources(topic);
    emit({ type: "sources", sources });

    emit({ type: "stage", stage: "generate", status: "started" });
    if (lower.includes("fail")) {
      await wait(600, signal);
      conversation.messages.pop();
      emit({
        type: "error",
        code: "LLM_UNAVAILABLE",
        message: "The language model did not respond in time. This is usually temporary.",
        retryable: true,
      });
      return;
    }

    const started = Date.now();
    const tokens = topic.answer.match(/\S+\s*/g) ?? [];
    for (const token of tokens) {
      await wait(28, signal);
      emit({ type: "token", delta: token });
    }
    stages.push({ stage: "generate", durationMs: Date.now() - started });
    emit({ type: "stage", stage: "generate", status: "completed", durationMs: Date.now() - started });

    await runStage("verify");
    finish(topic.answer, sources);
  },
};
