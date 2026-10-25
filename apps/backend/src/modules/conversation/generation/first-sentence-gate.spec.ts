import { FirstSentenceGate } from './first-sentence-gate';
import { declaresNoEvidence } from './citation-verifier';

describe('FirstSentenceGate', () => {
  let emitted: string[];
  let gate: FirstSentenceGate;

  beforeEach(() => {
    emitted = [];
    gate = new FirstSentenceGate((d) => emitted.push(d), declaresNoEvidence);
  });

  it('holds tokens until the first sentence ends, then streams the rest as it arrives', () => {
    for (const d of ['Redeploy ', 'the tag', '. ', 'Then ', 'verify.']) gate.push(d);
    expect(emitted).toEqual(['Redeploy the tag. ', 'Then ', 'verify.']);
    expect(gate.suppressed).toBe(false);
  });

  it('never streams an answer whose first sentence is a refusal', () => {
    const refusal =
      'I do not have sufficient information in the indexed documentation to answer this question. ';
    for (const word of refusal.split(/(?<= )/)) gate.push(word);
    gate.push('But maybe try X.');
    gate.end();
    expect(emitted).toEqual([]);
    expect(gate.suppressed).toBe(true);
  });

  it('releases a short answer without a sentence end when generation finishes', () => {
    gate.push('Yes [Source 1]');
    expect(emitted).toEqual([]);
    gate.end();
    expect(emitted).toEqual(['Yes [Source 1]']);
  });

  it('stops holding after 200 characters without a sentence end', () => {
    gate.push('a'.repeat(199));
    expect(emitted).toEqual([]);
    gate.push('a');
    expect(emitted).toEqual(['a'.repeat(200)]);
  });
});
