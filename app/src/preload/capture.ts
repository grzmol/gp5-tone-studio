import type { CaptureApi } from "@shared/host/capture";
import { invoke } from "./invoke";

export const captureApi: CaptureApi = {
  importFile: (path) => invoke("capture:importFile", path),
  importText: (fileName, text) => invoke("capture:importText", fileName, text),
  open: (ref, modelId) => invoke("capture:open", ref, modelId ?? null),
  saveVersion: (key, input) => invoke("capture:saveVersion", key, input),
  deleteVersion: (key, n) => invoke("capture:deleteVersion", key, n),
  saveDraft: (key, draft) => invoke("capture:saveDraft", key, draft),
  showFiles: (key) => invoke("capture:showFiles", key),
  exportFile: (suggestedName, text) => invoke("capture:exportFile", suggestedName, text),
};
