import { Symbols } from './Symbols';
import { AsyncDestructor } from './AsyncDestructor';

type Finalizer = () => Promise<void>;

export class AsyncScopeGuard extends AsyncDestructor {
  protected readonly finalizer: Finalizer;

  public constructor(finalizer: Finalizer) {
    super();
    this.finalizer = finalizer;
  }

  public async [Symbols.asyncDestructor]() {
    await this.finalizer();
  }
}
