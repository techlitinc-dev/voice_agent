# 04 — Omnichannel Messaging

> **What**: Unify voice, WhatsApp, SMS, and web chat into a single "conversation"
> view. The AI agent can respond on any channel with the same brain.

---

## 1. Schema

```prisma
enum ChannelType {
  VOICE
  WHATSAPP
  SMS
  WEBCHAT
  EMAIL
}

model Conversation {
  id            String       @id @default(cuid())
  workspaceId   String
  contactId     String?
  channel       ChannelType
  status        String       @default("OPEN") // OPEN | PENDING_AI | RESOLVED | ARCHIVED
  assignedAgentId String?    // the AI agent handling this conversation
  aiEnabled     Boolean      @default(true) // whether AI auto-responds

  // For WhatsApp/SMS: the phone number. For webchat: a session ID
  externalId    String?      // WhatsApp message ID, SMS ID, etc.

  lastMessageAt DateTime?
  unreadCount   Int          @default(0)
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt

  messages      Message[]
  workspace     Workspace    @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  contact       Contact?     @relation(fields: [contactId], references: [id], onDelete: SetNull)

  @@index([workspaceId, status, lastMessageAt])
  @@index([workspaceId, channel])
}

model Message {
  id              String       @id @default(cuid())
  conversationId  String
  channel         ChannelType
  direction       String       // "inbound" | "outbound"
  senderType      String       // "contact" | "agent" | "ai" | "system"
  body            String
  attachments     Json?        // [{ type: "image", url: "..." }]
  status          String       @default("SENT") // PENDING | SENT | DELIVERED | READ | FAILED
  externalId      String?      // WhatsApp/SMS message ID
  createdAt       DateTime     @default(now())

  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@index([conversationId, createdAt])
}
```

---

## 2. Unified Inbox UI

### 2.1 Layout

```
┌────────────────┬──────────────────────────────┬────────────────┐
│ CONVERSATIONS  │  CHAT                        │  CONTACT PANEL │
│                │                              │                │
│ 🔵 Ramesh      │  Ramesh: Hi, I need info on  │  Ramesh Kumar  │
│    WhatsApp    │  home loans                  │  +91 98XXX     │
│    2 min ago   │                              │  Pune           │
│                │  Agent: I can help! What     │                │
│ 🟢 Priya       │  loan amount?                │  Grade: A (92) │
│    Web Chat    │                              │  Deals: 1 open │
│    5 min ago   │  Ramesh: 25 lakhs            │  Tasks: 2      │
│                │                              │                │
│ ⚪ Acme Corp   │  [Type a message...]    [▶]  │  [Call] [Email]│
│    SMS         │                              │                │
│    1 hour ago  │                              │                │
└────────────────┴──────────────────────────────┴────────────────┘
```

### 2.2 Conversation list

```tsx
// src/app/(app)/inbox/page.tsx
export default async function InboxPage({ searchParams }) {
  const filter = searchParams.channel || "all";
  const conversations = await prisma.conversation.findMany({
    where: { workspaceId: ctx.workspaceId, ...(filter !== "all" && { channel: filter }) },
    include: { contact: true, messages: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { lastMessageAt: "desc" },
    take: 50,
  });

  return (
    <div className="flex h-screen">
      <ConversationList conversations={conversations} />
      <ChatPanel conversationId={searchParams.id} />
      <ContactPanel contactId={/* from selected */} />
    </div>
  );
}
```

---

## 3. Channel Integrations

### 3.1 WhatsApp (existing WhatsApp webhook)

Extend the existing WhatsApp webhook handler to create a `Conversation` + `Message`:

```ts
// src/app/api/webhooks/whatsapp/route.ts (extend)
async function handleIncomingWhatsApp(payload: WhatsAppWebhook) {
  const phone = payload.from;
  const text = payload.message.text.body;

  // Find or create contact
  const contact = await findOrCreateContact(workspaceId, phone);

  // Find or create conversation
  let conversation = await prisma.conversation.findFirst({
    where: { workspaceId, contactId: contact.id, channel: "WHATSAPP", status: "OPEN" },
  });
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { workspaceId, contactId: contact.id, channel: "WHATSAPP", status: "OPEN", aiEnabled: true },
    });
  }

  // Store inbound message
  await prisma.message.create({
    data: { conversationId: conversation.id, channel: "WHATSAPP", direction: "inbound", senderType: "contact", body: text, externalId: payload.id },
  });

  // If AI enabled, generate response
  if (conversation.aiEnabled && conversation.assignedAgentId) {
    await enqueueAiReply(conversation.id);
  }
}
```

### 3.2 SMS (existing Vobiz)

```ts
// Inbound SMS webhook
async function handleInboundSMS(from: string, body: string) {
  // Same pattern as WhatsApp
}
```

### 3.3 Web Chat (widget)

A JavaScript widget embeddable on customer websites:

```tsx
// src/app/widget/[workspaceSlug]/page.tsx (public)
// A lightweight chat widget that posts to /api/widget/message
```

```html
<!-- Customer website embeds: -->
<script src="https://app.vaani.ai/widget.js" data-workspace="acme-clinic"></script>
```

---

## 4. AI Auto-Reply

The same AI brain handles any channel:

```ts
// src/worker/chat-reply.ts (new)
async function generateAiReply(conversationId: string) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { messages: { orderBy: { createdAt: "asc" }, take: 20 }, contact: true, assignedAgent: true },
  });

  // Build LLM context from conversation history
  const history = conversation.messages.map((m) => ({
    role: m.senderType === "contact" ? "user" : "assistant",
    content: m.body,
  }));

  // Add agent system prompt + knowledge
  const systemPrompt = conversation.assignedAgent.systemPrompt;
  const context = await buildKnowledgeContext(conversation.assignedAgent);

  // Generate reply via OpenRouter
  const reply = await callLLM({
    system: systemPrompt + "\n\n" + context,
    messages: history,
  });

  // Send via the appropriate channel
  if (conversation.channel === "WHATSAPP") {
    await sendWhatsApp(conversation.contact.phone, reply);
  } else if (conversation.channel === "SMS") {
    await sendSMS(conversation.contact.phone, reply);
  } else if (conversation.channel === "WEBCHAT") {
    // Push via SSE to widget
  }

  // Store outbound message
  await prisma.message.create({
    data: { conversationId, channel: conversation.channel, direction: "outbound", senderType: "ai", body: reply },
  });
}
```

---

## 5. Human Handoff

When the AI detects it can't handle the query:

```ts
// In AI reply logic
if (replyNeedsHuman) {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { status: "PENDING_HUMAN", aiEnabled: false },
  });
  await notifyHumanAgents(workspaceId, conversationId);
}
```

The human picks up in the same inbox UI, types a reply, and can re-enable AI when done.

---

## 6. Voice + Messaging Linkage

A conversation can **start as voice** and **continue as WhatsApp**:

- Call ends → if the caller needs follow-up, create a WhatsApp conversation linked
  to the same `contact`.
- The contact detail page shows the unified timeline across all channels.

---

← Back to [New Features](../README.md#new-features) | [Manual Testing →](../manual-testing/00-test-strategy.md)