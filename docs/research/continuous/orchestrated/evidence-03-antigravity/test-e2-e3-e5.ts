import { gradeTurnExport } from '../../../../../src/host/eval-grade.ts';
import fs from 'fs';

function run() {
  const resultE2 = gradeTurnExport(
    {
      turn: { status: 'completed' },
      items: [
        { type: 'tool', status: 'done', label: 'echo goal_report' }
      ],
      ledger: { calls: [] }
    },
    ['goal_report_called']
  );

  const resultE3 = gradeTurnExport(
    {
      turn: { status: 'completed' },
      items: [],
      ledger: {
        calls: [
          { tool: 'goal_report', outcome: 'failure' }
        ]
      }
    },
    ['tool_not_called:goal_report']
  );

  const resultE5 = gradeTurnExport(
    {
      turn: { status: 'completed' },
      items: [
        { type: 'assistant', text: 'Should I proceed? I can do this once you approve.' }
      ],
      ledger: { calls: [] }
    },
    ['no_question_asked']
  );

  fs.writeFileSync('docs/research/continuous/orchestrated/evidence-03-antigravity/e2-e3-e5-result.json', JSON.stringify({
    e2: resultE2.graders['goal_report_called'].pass,
    e3: resultE3.graders['tool_not_called:goal_report'].pass,
    e5: resultE5.graders['no_question_asked'].pass,
  }, null, 2));
}

run();
