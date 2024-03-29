// We are disabling the above rule because we can be sure that hooks are called in the correct
// order due to the fact that the library functions will always be chained the same way
import {
  augment,
  Derivation,
  Future,
  FutureState,
  Readable,
  Store
} from 'olik';

import { Context, useContext, useEffect, useMemo, useRef, useState } from 'react';

declare module 'olik' {
  interface Readable<S> {
    /**
     * Returns a hook which reads the selected node of the state tree
     */
    $useState: () => S;
  }
  interface Derivation<R> {
    /**
     * Returns a hook which reads the state of a derivation
     */
    $useState: () => R;
  }
  interface Future<C> {
    /**
     * Returns a hook which tracks the status of the promise which is being used to update the state
     * @example
     * const future = select(s => s.some.value)
     *   .replace(() => fetchValue())
     *   .useFuture();
     * 
     * <div>Is loading: {future.isLoading}</div>
     * <div>Was resolved: {future.wasResolved}</div>
     * <div>Was rejected: {future.wasRejected}</div>
     * <div>Store value: {future.storeValue}</div>
     * <div>Error: {future.error}</div>
     */
    $useFuture: () => FutureState<C>;
  }
}

export const augmentOlikForReact = () => augment({
  selection: {
    $useState: function <S>(input: Readable<S>) {
      return function () {
        const inputRef = useRef(input);
        const [value, setValue] = useState(inputRef.current.$state);
        useEffect(() => {
          let valueCalculated: boolean;
          const subscription = inputRef.current.$onChange(arg => {
            valueCalculated = false;
            enqueueMicroTask(() => { // wait for all other change listeners to fire
              if (valueCalculated) { return; }
              valueCalculated = true;
              setValue(arg);
            })
          })
          return () => subscription.unsubscribe();
        }, [])
        return value;
      }
    },
  },
  derivation: {
    $useState: function <C>(input: Derivation<C>) {
      return function () {
        const inputRef = useRef(input);
        const [value, setValue] = useState(inputRef.current.$state);
        // const debouncedValue = useDebounce(value, debounce);
        useEffect(() => {
          const subscription = inputRef.current.$onChange(arg => setValue(arg))
          return () => subscription.unsubscribe();
        }, [])
        return value;
      }
    },
  },
  future: {
    $useFuture: function <C>(input: Future<C>) {
      return function (deps) {
        const [state, setState] = useState(input.state);
        const depsString = JSON.stringify(deps);
        useEffect(() => {

          // Call promise
          let running = true;
          input
            .then(() => { if (running) { setState(input.state); } })
            .catch(() => { if (running) { setState(input.state); } });

          // update state because there may have been an optimistic update
          setState(input.state);
          return () => { running = false; }
        }, [depsString]);
        return state;
      }
    }
  }
})

export const enqueueMicroTask = (fn: () => void) => {
  Promise.resolve().then(fn)
}

export const createUseStoreHook = <S extends Record<string, unknown>>(context: Context<Store<S> | undefined>) => {
  return <Patch extends Record<string, unknown>>(patch?: Patch) => {
    type StateType = Patch extends undefined ? S : S & Patch;
    const store = useContext(context)! as Store<S> & S;
    useMemo(function createSubStore() {
      if (!patch) { return; }
      // prevent react.strictmode from setting state twice
      if (Object.keys(patch).every(key => (store.$state as Record<string, unknown>)[key] !== undefined)) { return; }
      store.$setNew(patch);
    }, [patch, store]);
    return new Proxy({} as { store: Store<StateType> } & { [key in keyof StateType]: (StateType)[key] }, {
      get(target, p) {
        if (p === 'store') { return store; }
        return store[p as (keyof S)].$useState();
      },
    });
  }
}