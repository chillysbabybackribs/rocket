import { buildHandoff } from '../../../../../src/host/handoff.ts';
import fs from 'fs';

function turnWithAttachment(provider, userText, replyText, attachmentId) {
  return {
    provider,
    model: 'm1',
    status: 'completed',
    items: [
      { 
        type: 'user', 
        id: `u-${attachmentId}`, 
        turnId: `t-${attachmentId}`, 
        text: userText,
        attachments: [{ id: attachmentId, kind: 'image', name: `file-${attachmentId}.png` }]
      },
      { type: 'assistant', id: `a-${attachmentId}`, turnId: `t-${attachmentId}`, text: replyText, streaming: false }
    ]
  };
}

// Create 100 turns, each with an attachment, huge text to force dropping
const turns = Array.from({ length: 100 }, (_, index) => 
  turnWithAttachment('codex', `question ${index} ${'q'.repeat(1000)}`, `answer ${index} ${'a'.repeat(1000)}`, `att-${index}`)
);

const handoff = buildHandoff(turns, 10000); // Small budget to force drops
console.log("Turns submitted:", turns.length);
console.log("Attachments in returned handoff object:", handoff.attachments ? handoff.attachments.length : 0);
console.log("Dropped turns (Total submitted - handoff.turns):", turns.length - handoff.turns);
console.log("Is attachment array complete?", handoff.attachments?.length === turns.length);

const out = {
  submittedTurns: turns.length,
  handoffTurnsIncluded: handoff.turns,
  attachmentsReturned: handoff.attachments ? handoff.attachments.length : 0
};

fs.writeFileSync('result.json', JSON.stringify(out, null, 2));
