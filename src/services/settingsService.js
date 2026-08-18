import { api } from "./api";

export const settingsService = {
  updateOrganisation: (id, data) => api.patch(`organisations/${id}/`, data),
  members: () => api.get("organisation-members/"),
  updateMember: (id, data) => api.patch(`organisation-members/${id}/`, data),
  aiSettings: () => api.get("ai/settings/"),
  updateAISettings: (data) => api.post("ai/settings/", data),
};
