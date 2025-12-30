import { Symbols } from './Symbols';
import { Destructor } from './Destructor';

type Finalizer = () => void;

export class ScopeGuard extends Destructor {
  protected readonly finalizer: Finalizer;

  public constructor(finalizer: Finalizer) {
    super();
    this.finalizer = finalizer;
  }

  public [Symbols.destructor]() {
    this.finalizer();
  }
}
