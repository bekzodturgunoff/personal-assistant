export type {KvStore} from "./store.js";
export {
  setConversationsKv,
  setTasksKv,
  setLongTermKv,
  setModelCooldownKv,
  getConversationsKv,
  getTasksKv,
  getLongTermKv,
  getModelCooldownKv,
} from "./store.js";

export type {UserMeta} from "./user-meta.js";
export {
  META_DEFAULTS,
  getUserMeta,
  setUserMeta,
  updateUserMeta,
  getPendingQuestions,
  getLowConfCount,
  incrementLowConfCount,
  resetLowConfCount,
  getRelationshipStage,
  setRelationshipStage,
  getFirstContactDate,
  setFirstContactDate,
} from "./user-meta.js";

export type {WeeklyAccumulator} from "./analytics.js";
export {
  getDefaultAccumulator,
  getWeeklyAccumulator,
  saveWeeklyAccumulator,
  touchDailyEntry,
  resetWeeklyAccumulator,
} from "./analytics.js";

export {
  setPausedUntil,
  getPausedUntil,
  clearPausedUntil,
} from "./pause.js";

export {
  deleteLongTermKey,
  deleteConversationsKey,
} from "./delete-helpers.js";
