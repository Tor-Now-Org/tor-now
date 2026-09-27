import { asId, instant, type Notice } from "@tor-now/domain";
import type { NoticeRepository } from "../../ports/repositories.ts";
import type { Store } from "./in-memory-store.ts";

/**
 * The notice table held in memory, with its one rule: a key already kept for a
 * Business keeps nothing more. Kept newest last, as inserted, so ties in the
 * clock still list in the order things happened.
 */
export const inMemoryNotices = (store: Store): NoticeRepository => {
  const replace = (updated: Notice) => {
    store.notices = store.notices.map((entry) =>
      entry.notice.id === updated.id ? { ...entry, notice: updated } : entry,
    );
  };

  return {
    async post({ businessId, facts, key }) {
      if (key !== null && store.notices.some((entry) => entry.notice.businessId === businessId && entry.key === key)) {
        return null;
      }
      const notice: Notice = {
        id: asId(store.nextId("notice")),
        businessId,
        facts,
        createdAt: instant(Date.now()),
        readAt: null,
        clearedAt: null,
      };
      store.notices = [...store.notices, { notice, key }];
      return notice;
    },

    async listForBusiness(businessId, limit) {
      return store.notices
        .map((entry) => entry.notice)
        .filter((notice) => notice.businessId === businessId)
        .reverse()
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
    },

    async clear(businessId, kinds, at) {
      for (const { notice } of store.notices) {
        if (notice.businessId === businessId && kinds.includes(notice.facts.kind) && notice.clearedAt === null) {
          replace({ ...notice, clearedAt: at });
        }
      }
    },

    async acknowledge(businessId, id, at) {
      const found = store.notices.find((entry) => entry.notice.id === id && entry.notice.businessId === businessId);
      if (found === undefined) return null;
      const updated = { ...found.notice, clearedAt: found.notice.clearedAt ?? at, readAt: found.notice.readAt ?? at };
      replace(updated);
      return updated;
    },

    async markAllRead(businessId, at) {
      for (const { notice } of store.notices) {
        if (notice.businessId === businessId && notice.readAt === null) replace({ ...notice, readAt: at });
      }
    },
  };
};
