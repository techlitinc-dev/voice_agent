# 03 — Voice Cloning & Brand Voices

> **What**: Let enterprises create custom branded voices by cloning a reference
> voice sample, so all their AI agents share a consistent audio identity.

---

## 1. Schema

```prisma
model CustomVoice {
  id            String   @id @default(cuid())
  workspaceId   String
  name          String   // "Brand Voice - Hindi Female"
  provider      String   @default("elevenlabs") // "elevenlabs" | "playht" | "sarvam"
  language      String   @default("hi")

  sampleKey     String?  // MinIO key of uploaded sample audio (30s+)
  previewKey    String?  // MinIO key of generated preview

  // Provider-side reference
  clonedVoiceId String?  // provider's voice ID (e.g. ElevenLabs voice_id)

  status        String   @default("PENDING") // PENDING | TRAINING | READY | FAILED
  error         String?

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, name])
  @@index([workspaceId])
}
```

Add relation to `Workspace.customVoices CustomVoice[]` and to `Agent.customVoiceId String?`.

---

## 2. Provider Integration

### 2.1 ElevenLabs (recommended for quality)

```ts
// src/lib/voice-cloning.ts (new)
import FormData from "form-data";

export async function cloneVoiceElevenLabs(sampleBuffer: Buffer, name: string): Promise<string> {
  const form = new FormData();
  form.append("name", name);
  form.append("files", sampleBuffer, { filename: "sample.mp3", contentType: "audio/mpeg" });
  form.append("description", `Cloned voice for ${name}`);

  const res = await fetch("https://api.elevenlabs.io/v1/voices/add", {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, ...form.getHeaders() },
    body: form,
  });

  const data = await res.json();
  return data.voice_id; // store as CustomVoice.clonedVoiceId
}
```

### 2.2 PlayHT (alternative)

```ts
export async function cloneVoicePlayHT(sampleUrl: string, name: string): Promise<string> {
  const res = await fetch("https://api.play.ht/api/v2/cloned-voices", {
    method: "POST",
    headers: {
      "X-USER-ID": process.env.PLAYHT_USER_ID!,
      "Authorization": `Bearer ${process.env.PLAYHT_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ voice_name: name, sample_url: sampleUrl }),
  });
  return (await res.json()).id;
}
```

### 2.3 TTS routing

When synthesizing speech, route to the cloned voice:

```ts
// src/lib/voices.ts (extend)
export async function synthesize(text: string, agent: Agent): Promise<Buffer> {
  if (agent.customVoiceId) {
    const voice = await prisma.customVoice.findFirstOrThrow({
      where: { id: agent.customVoiceId, workspaceId: agent.workspaceId, status: "READY" },
    });
    return synthesizeWithClone(text, voice);
  }
  return synthesizeWithSarvam(text, agent.voiceId); // existing path
}
```

---

## 3. UI

### 3.1 Upload sample

```tsx
// src/app/(app)/settings/voices/page.tsx
<Dropzone
  accept={{ "audio/mpeg": [".mp3"], "audio/wav": [".wav"] }}
  maxSize={25 * 1024 * 1024}
  onUpload={handleSampleUpload}
/>
```

### 3.2 Voice management

List custom voices with preview playback and status:

```
┌─────────────────────────────────────────────────────────┐
│  CUSTOM VOICES                          [+ Clone Voice] │
├─────────────────────────────────────────────────────────┤
│  ▶ Brand Voice - Hindi Female    READY    [Assign]      │
│  ▶ CEO Voice - English Male      READY    [Assign]      │
│  ⏳ Support Voice - Tamil         TRAINING...           │
└─────────────────────────────────────────────────────────┘
```

### 3.3 Agent voice selector

In agent builder, add "Custom Voice" option:

```tsx
<RadioGroup value={voiceMode} onValueChange={setVoiceMode}>
  <div className="flex items-center space-x-2">
    <RadioGroupItem value="stock" id="stock" />
    <Label htmlFor="stock">Stock voice (Sarvam)</Label>
  </div>
  <div className="flex items-center space-x-2">
    <RadioGroupItem value="custom" id="custom" />
    <Label htmlFor="custom">Custom cloned voice</Label>
  </div>
</RadioGroup>

{voiceMode === "custom" && (
  <Select value={customVoiceId} onValueChange={setCustomVoiceId}>
    <SelectTrigger><SelectValue placeholder="Select a cloned voice..." /></SelectTrigger>
    <SelectContent>
      {customVoices.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
    </SelectContent>
  </Select>
)}
```

---

## 4. Pricing & Gating

- Gate behind Enterprise plan + `premiumVoices` flag (existing field on Plan).
- Charge per cloned voice: ₹5,000/month per voice (covers provider costs).
- Limit: 5 cloned voices per workspace.

---

## Next

→ [04 — Omnichannel Messaging](04-omnichannel-messaging.md)