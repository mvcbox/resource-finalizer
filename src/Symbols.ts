export class Symbols {
  static readonly destructor: unique symbol = Symbol('Symbols.destructor');
  static readonly asyncDestructor: unique symbol = Symbol('Symbols.asyncDestructor');
  static readonly disposableStack: unique symbol = Symbol('Symbols.disposableStack');
  static readonly asyncDisposableStack: unique symbol = Symbol('Symbols.asyncDisposableStack');
  static readonly callDestructorsChain: unique symbol = Symbol('Symbols.callDestructorsChain');
  static readonly asyncCallDestructorsChain: unique symbol = Symbol('Symbols.asyncCallDestructorsChain');

  private constructor() {}
}
