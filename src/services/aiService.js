// Send questions and controlled proposals without letting generated text post accounting directly.

import { api } from "./api";
export const aiService={chat:(question,conversation_id,parameters={})=>api.post("ai/chat/",{question,conversation_id,parameters}),conversations:()=>api.get("ai/conversations/"),conversation:(id)=>api.get(`ai/conversations/${id}/`),updateConversation:(id,data)=>api.patch(`ai/conversations/${id}/`,data),insights:()=>api.get("ai/insights/"),anomalies:()=>api.get("ai/anomalies/"),detect:()=>api.post("ai/anomalies/detect/",{}),review:(id,status)=>api.post(`ai/anomalies/${id}/review/`,{status}),actions:()=>api.get("ai/actions/"),proposeJournal:(payload)=>api.post("ai/actions/propose-journal/",payload),execute:(id)=>api.post(`ai/actions/${id}/execute/`,{})};
