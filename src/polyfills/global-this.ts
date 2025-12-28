(() => {
  if (typeof (globalThis as any) !== "undefined") return;

  const getGlobal = (): any => {
    if (Function('typeof global !== "undefined"')()) {
      return Function('return global')();
    }

    if (Function('typeof window !== "undefined"')()) {
      return Function('return window')();
    }

    if (Function('typeof self !== "undefined"')()) {
      return Function('return self')();
    }

    return Function('return this')();
  };

  const g = getGlobal();

  if (typeof g.globalThis === "undefined") {
    try {
      Object.defineProperty(g, "globalThis", {
        value: g,
        configurable: true,
        writable: true,
      });
    } catch {
      g.globalThis = g;
    }
  }
})();
