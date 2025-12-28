export class Destructor {
  static readonly disposableStack: unique symbol = Symbol('Destructor.disposableStack');
  static readonly asyncDisposableStack: unique symbol = Symbol('Destructor.asyncDisposableStack');
}
