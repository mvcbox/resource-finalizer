import { createDisposableStack, Destructible, AsyncDestructible, Destructor } from '..';

class A implements Destructible {
  public [Destructor.disposableStack] = createDisposableStack();

  public constructor() {
    console.log('A.constructor()');
  }

  public [Symbol.dispose]() {
    this[Destructor.disposableStack].dispose();
    console.log('A.destructor()');
  }
}

class B extends A implements Destructible {
  public [Destructor.disposableStack] = createDisposableStack();

  public constructor() {
    super();
    console.log('B.constructor()');
  }

  public [Symbol.dispose]() {
    this[Destructor.disposableStack].dispose();
    console.log('B.destructor()');
    super[Symbol.dispose]();
  }
}

class C extends B implements Destructible {
  public [Destructor.disposableStack] = createDisposableStack();

  public constructor() {
    super();
    console.log('C.constructor()');
  }

  public [Symbol.dispose]() {
    this[Destructor.disposableStack].dispose();
    console.log('C.destructor()');
    super[Symbol.dispose]();
  }
}

{ // ...
  // using instanceA = new A();
  // using instanceB = new B();
  using instanceC = new C();
  console.log('Scope done');
}
