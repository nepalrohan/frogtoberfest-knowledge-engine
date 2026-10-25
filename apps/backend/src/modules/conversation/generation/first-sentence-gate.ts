/* A sentence end, or a line break, in the text held so far */
const SENTENCE_END = /[.!?](\s|$)|\n/;
/* Stop holding back after this much text even without a sentence end */
const MAX_HOLD_CHARS = 200;

/*
 * Holds back the start of a streamed answer until its first sentence shows whether the model is refusing.
 * A refusal is then never shown as a half-answer; anything else streams on unchanged.
 */
export class FirstSentenceGate {
  private held = '';
  private state: 'holding' | 'streaming' | 'suppressed' = 'holding';

  constructor(
    private readonly emit: (delta: string) => void,
    private readonly isRefusal: (text: string) => boolean,
  ) {}

  push(delta: string): void {
    if (this.state === 'streaming') {
      this.emit(delta);
      return;
    }
    if (this.state === 'suppressed') return;
    this.held += delta;
    if (SENTENCE_END.test(this.held) || this.held.length >= MAX_HOLD_CHARS) {
      this.decide();
    }
  }

  /* Releases a short answer that ended before its first sentence did */
  end(): void {
    if (this.state === 'holding') this.decide();
  }

  /* True when nothing of the answer reached the client */
  get suppressed(): boolean {
    return this.state === 'suppressed';
  }

  private decide(): void {
    if (this.isRefusal(this.held)) {
      this.state = 'suppressed';
    } else {
      this.state = 'streaming';
      if (this.held) this.emit(this.held);
    }
    this.held = '';
  }
}
