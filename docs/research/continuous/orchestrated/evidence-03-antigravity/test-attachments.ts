import { buildHandoff } from '../../../../../src/host/handoff.ts';
import fs from 'fs';

function turnWithAttachment(provider: any, userText: string, replyText: string, attachmentId: string) {
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
        attachments: [{ 
            id: attachmentId, 
            kind: 'file', 
            name: `file-${attachmentId}.pdf`, 
            format: 'pdf', 
            mimeType: 'application/pdf', 
            size: 1024, 
            chars: 1000 
        }]
      },
      { type: 'assistant', id: `a-${attachmentId}`, turnId: `t-${attachmentId}`, text: replyText, streaming: false }
    ]
  };
}

const turns = Array.from({ length: 100 }, (_, index) => 
  turnWithAttachment('codex', `question ${index} ${'q'.repeat(1000)}`, `answer ${index} ${'a'.repeat(1000)}`, `att-${index}`)
);

const handoff = buildHandoff(turns, 10000);
console.log("Turns submitted:", turns.length);
console.log("Handoff returned turns count:", handoff?.turns);
console.log("Attachments in returned handoff object:", handoff?.attachments ? handoff.attachments.length : 0);
console.log("Dropped turns according to script logic:", turns.length - (handoff?.turns || 0));

const out = {
  submittedTurns: turns.length,
  handoffTurnsIncluded: handoff?.turns || 0,
  attachmentsReturned: handoff?.attachments ? handoff.attachments.length : 0
};

fs.writeFileSync('docs/research/continuous/orchestrated/evidence-03-antigravity/result.json', JSON.stringify(out, null, 2));
