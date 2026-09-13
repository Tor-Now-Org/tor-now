"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * Whether anything is covering the screen.
 *
 * A floating button has to get out of the way of a sheet, and it cannot be the
 * button's job to know which sheets exist: every sheet added since has had to
 * be wired into a growing list of flags, and each time one was forgotten the +
 * sat on top of a dialog again. So a sheet says it is open, once, where it
 * opens — and anything that has to yield asks this rather than being told.
 *
 * Deliberately not React context: a provider would have to sit above both the
 * sheet and whatever yields to it, which for a fixed-position button spanning
 * the whole app means the root — a lot of ceremony for one boolean.
 */

let open = 0;
let listeners: (() => void)[] = [];

const announce = () => listeners.forEach((listener) => listener());

const subscribe = (listener: () => void): (() => void) => {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((candidate) => candidate !== listener);
  };
};

const anyOpen = () => open > 0;

/** Nothing is open on the server, and the first paint should agree. */
const noneOpen = () => false;

/** Registers a sheet for as long as it is on screen. */
export const useSheetPresence = (showing: boolean): void => {
  useEffect(() => {
    if (!showing) return;
    open += 1;
    announce();
    return () => {
      open -= 1;
      announce();
    };
  }, [showing]);
};

export const useAnySheetOpen = (): boolean =>
  useSyncExternalStore(subscribe, anyOpen, noneOpen);
