// 元に戻す / やり直し。entry = { label, undo(), redo() }
const LIMIT = 60;

export class History {
  constructor() {
    this.undoStack = [];
    this.redoStack = [];
    this.onChange = null;
  }

  push(entry) {
    this.undoStack.push(entry);
    if (this.undoStack.length > LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
    this.onChange?.('push', entry);
  }

  undo() {
    const e = this.undoStack.pop();
    if (!e) return;
    e.undo();
    this.redoStack.push(e);
    this.onChange?.('undo', e);
  }

  redo() {
    const e = this.redoStack.pop();
    if (!e) return;
    e.redo();
    this.undoStack.push(e);
    this.onChange?.('redo', e);
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.onChange?.('clear');
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
}
